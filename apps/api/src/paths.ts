import { mkdir } from "node:fs/promises";
import { resolve, join } from "node:path";
import type { Db } from "./db.js";

export type AppDirs = {
  root: string;
  data: string;
  backups: string;
  files: string;
  exports: string;
  patients: string;
};

export function resolveAppDirs(env: NodeJS.ProcessEnv = process.env): AppDirs {
  const root = resolve(env.ZENAIOS_ROOT ?? env.DATA_ROOT ?? process.cwd());
  const data = resolve(env.DATA_DIR ?? join(root, "data", "pglite"));
  const backups = resolve(env.BACKUP_DIR ?? join(root, "data", "backups"));
  const files = resolve(env.FILES_DIR ?? join(root, "data", "files"));
  const exports = resolve(env.EXPORTS_DIR ?? join(root, "data", "exports"));
  const patients = join(files, "patients");
  return { root, data, backups, files, exports, patients };
}

export async function ensureAppDirs(dirs: AppDirs): Promise<AppDirs> {
  for (const path of [dirs.root, dirs.data, dirs.backups, dirs.files, dirs.exports, dirs.patients]) {
    await mkdir(path, { recursive: true });
  }
  return dirs;
}

export async function persistAppPaths(db: Db, dirs: AppDirs): Promise<void> {
  await db.query(
    `INSERT INTO app_paths (id, data_root, backup_dir, files_dir, exports_dir, updated_at)
     VALUES ('default', $1, $2, $3, $4, now())
     ON CONFLICT (id) DO UPDATE SET
       data_root = EXCLUDED.data_root,
       backup_dir = EXCLUDED.backup_dir,
       files_dir = EXCLUDED.files_dir,
       exports_dir = EXCLUDED.exports_dir,
       updated_at = now()`,
    [dirs.root, dirs.backups, dirs.files, dirs.exports]
  );
}
