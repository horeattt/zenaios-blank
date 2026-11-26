import type { Db } from "./db.js";

export async function migrate(db: Db): Promise<string[]> {
  const { readdir, readFile } = await import("node:fs/promises");
  const { dirname, join } = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");
  const files = (await readdir(migrationsDir)).filter((name) => name.endsWith(".sql")).sort();
  const applied: string[] = [];
  for (const file of files) {
    const version = file.replace(/\.sql$/, "");
    const exists = await db.query<{ name: string | null }>("SELECT to_regclass('public.schema_migrations') AS name");
    if (exists[0]?.name) {
      const rows = await db.query<{ version: string }>("SELECT version FROM schema_migrations WHERE version = $1", [version]);
      if (rows.length) continue;
    }
    const script = await readFile(join(migrationsDir, file), "utf8");
    await db.tx(async (q) => {
      await q.exec(script);
      await q.query("INSERT INTO schema_migrations (version) VALUES ($1)", [version]);
    });
    applied.push(version);
  }
  return applied;
}
