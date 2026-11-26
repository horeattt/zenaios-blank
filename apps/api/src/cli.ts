import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { openSnapshot, restoreSnapshot } from "./backup.js";
import { openPglite, openPostgres, type Db } from "./db.js";
import { migrate } from "./migrate.js";
import { runLogicalBackup, runPgDumpBackup } from "./ops.js";
import { provisionHospital } from "./provision.js";

const command = process.argv[2];
const databaseUrl = process.env.DATABASE_URL;
if (process.env.NODE_ENV === "production" && !databaseUrl) {
  console.error("DATABASE_URL este obligatoriu în producție.");
  process.exit(1);
}

const db = databaseUrl ? openPostgres(databaseUrl) : await openPglite(resolve(process.env.DATA_DIR ?? "./data/pglite"));
await migrate(db);

if (command === "setup") {
  const name = process.argv[3];
  const username = process.argv[4];
  const displayName = process.argv[5] ?? username;
  if (!name || !username) {
    console.error("Folosire: npm run setup -- \"Nume spital\" admin \"Nume administrator\"");
    process.exit(1);
  }
  const existing = await db.query<{ n: number }>("SELECT count(*)::int AS n FROM hospitals");
  if (Number(existing[0]?.n) > 0) {
    console.error("Există deja un spital în această bază. Pentru alt spital folosește o instalare nouă.");
    process.exit(1);
  }
  const created = await provisionHospital(db, { name, adminUsername: username, adminDisplayName: displayName });
  console.log(`Spital: ${created.hospitalId}`);
  console.log(`Utilizator: ${created.username}`);
  console.log(`Parolă unică (se afișează o singură dată): ${created.password}`);
} else if (command === "backup" || command === "backup-schedule") {
  const key = Buffer.from(process.env.AI_DATA_KEY ?? "", "base64");
  if (key.length !== 32) {
    console.error("AI_DATA_KEY de 32 de octeți este necesară pentru copia criptată.");
    process.exit(1);
  }
  const result = await runLogicalBackup(db, key, { keep: Number(process.env.BACKUP_KEEP ?? 14) });
  console.log(JSON.stringify({ ...result, scheduled: command === "backup-schedule" }));
  if (process.env.DATABASE_URL && process.env.BACKUP_PG_DUMP === "1") {
    try {
      const dump = await runPgDumpBackup(db, { databaseUrl: process.env.DATABASE_URL });
      console.log(JSON.stringify(dump));
    } catch (error) {
      console.error(error instanceof Error ? error.message : "pg_dump eșuat");
      process.exitCode = 1;
    }
  }
} else if (command === "restore") {
  const key = Buffer.from(process.env.AI_DATA_KEY ?? "", "base64");
  if (key.length !== 32) {
    console.error("AI_DATA_KEY de 32 de octeți este necesară pentru copia criptată.");
    process.exit(1);
  }
  const file = process.argv[3];
  if (!file) {
    console.error("Folosire: npm run restore -- cale.zenbackup");
    process.exit(1);
  }
  await restoreSnapshot(db, openSnapshot(await readFile(file, "utf8"), key));
  console.log("Restaurare aplicată.");
} else {
  console.error("Comenzi: setup, backup, backup-schedule, restore");
  process.exit(1);
}

await db.close();
