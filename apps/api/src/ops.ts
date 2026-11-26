import { mkdir, writeFile, readdir, stat, unlink } from "node:fs/promises";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { newId } from "./audit.js";
import { exportSnapshot, sealSnapshot } from "./backup.js";
import type { Db } from "./db.js";

export type TlsOptions = {
  enabled: boolean;
  certPath?: string;
  keyPath?: string;
};

export function readTlsOptions(env: NodeJS.ProcessEnv = process.env): TlsOptions {
  const certPath = env.TLS_CERT_PATH;
  const keyPath = env.TLS_KEY_PATH;
  if (certPath && keyPath) return { enabled: true, certPath, keyPath };
  return { enabled: false };
}

export async function runLogicalBackup(
  db: Db,
  key: Buffer,
  opts: { dir?: string; hospitalId?: string | null; keep?: number } = {}
): Promise<{ id: string; path: string; bytes: number }> {
  const dir = resolve(opts.dir ?? process.env.BACKUP_DIR ?? "./backups");
  await mkdir(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const path = join(dir, `zenaios-${stamp}.zenbackup`);
  const payload = sealSnapshot(await exportSnapshot(db), key);
  await writeFile(path, payload, "utf8");
  const bytes = Buffer.byteLength(payload, "utf8");
  const id = newId();
  await db.query(
    `INSERT INTO backup_runs (id, hospital_id, kind, status, path, bytes, detail)
     VALUES ($1, $2, 'logical', 'ok', $3, $4, $5)`,
    [id, opts.hospitalId ?? null, path, bytes, "Copie logică criptată."]
  );
  await pruneBackups(dir, opts.keep ?? Number(process.env.BACKUP_KEEP ?? 14));
  return { id, path, bytes };
}

export async function runPgDumpBackup(
  db: Db,
  opts: { databaseUrl: string; dir?: string; hospitalId?: string | null } 
): Promise<{ id: string; path: string; bytes: number; detail: string }> {
  const dir = resolve(opts.dir ?? process.env.BACKUP_DIR ?? "./backups");
  await mkdir(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const path = join(dir, `zenaios-${stamp}.sql`);
  const id = newId();
  try {
    await execFile("pg_dump", ["--no-owner", "--format=plain", "--file", path, opts.databaseUrl]);
    const info = await stat(path);
    await db.query(
      `INSERT INTO backup_runs (id, hospital_id, kind, status, path, bytes, detail)
       VALUES ($1, $2, 'pg_dump', 'ok', $3, $4, $5)`,
      [id, opts.hospitalId ?? null, path, info.size, "pg_dump reușit."]
    );
    return { id, path, bytes: info.size, detail: "pg_dump reușit." };
  } catch (error) {
    const detail = error instanceof Error ? error.message : "pg_dump eșuat";
    await db.query(
      `INSERT INTO backup_runs (id, hospital_id, kind, status, path, bytes, detail)
       VALUES ($1, $2, 'pg_dump', 'failed', $3, 0, $4)`,
      [id, opts.hospitalId ?? null, path, detail.slice(0, 500)]
    );
    throw Object.assign(new Error(`pg_dump indisponibil: ${detail}`), { statusCode: 503 });
  }
}

async function pruneBackups(dir: string, keep: number): Promise<void> {
  if (keep < 1) return;
  const files = (await readdir(dir))
    .filter((name) => name.endsWith(".zenbackup") || name.endsWith(".sql"))
    .sort()
    .reverse();
  for (const name of files.slice(keep)) {
    await unlink(join(dir, name)).catch(() => undefined);
  }
}

function execFile(command: string, args: string[]): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr += String(chunk); });
    child.on("error", (error) => reject(error));
    child.on("close", (code) => {
      if (code === 0) resolvePromise();
      else reject(new Error(stderr.trim() || `${command} exit ${code}`));
    });
  });
}
