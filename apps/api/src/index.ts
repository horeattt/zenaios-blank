import { readFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { buildApp } from "./app.js";
import { openPglite, openPostgres, type Db } from "./db.js";
import { migrate } from "./migrate.js";
import { readTlsOptions } from "./ops.js";
import { ensureAppDirs, persistAppPaths, resolveAppDirs } from "./paths.js";

const databaseUrl = process.env.DATABASE_URL;
if (process.env.NODE_ENV === "production" && !databaseUrl) {
  console.error("DATABASE_URL este obligatoriu în producție.");
  process.exit(1);
}

const dirs = await ensureAppDirs(resolveAppDirs());
const db = await openDatabase();
await migrate(db);
await persistAppPaths(db, dirs).catch(() => undefined);
const aiDataKey = readKey(process.env.AI_DATA_KEY);
const cookieSecure = process.env.COOKIE_SECURE === "1" || process.env.NODE_ENV === "production";
const tls = readTlsOptions();
let https: { key: Buffer; cert: Buffer } | undefined;
if (tls.enabled && tls.certPath && tls.keyPath) {
  https = { key: await readFile(tls.keyPath), cert: await readFile(tls.certPath) };
} else if (process.env.NODE_ENV === "production" && process.env.ALLOW_INSECURE_HTTP !== "1") {
  console.error("Producție fără TLS_CERT_PATH/TLS_KEY_PATH. Setează certificatele sau ALLOW_INSECURE_HTTP=1 în spatele unui proxy TLS.");
  process.exit(1);
}

const openAccess = process.env.NODE_ENV !== "production" && process.env.OPEN_ACCESS !== "0";
const app = await buildApp(db, {
  aiDataKey,
  provisionToken: process.env.PROVISION_TOKEN ?? "",
  cookieSecure,
  logs: [],
  https,
  openAccess,
  dirs
});
const port = Number(process.env.PORT ?? 3000);
await app.listen({ port, host: "0.0.0.0" });
console.log(`ZenAIOS pe portul ${port}. TLS: ${https ? "on" : "off"}. Acces deschis: ${openAccess ? "on" : "off"}. Cookie secure: ${cookieSecure}. AI: ${aiDataKey ? "cheie prezentă" : "oprit"}. Disc: ${dirs.root}`);

async function openDatabase(): Promise<Db> {
  if (databaseUrl) return openPostgres(databaseUrl);
  const dir = resolve(process.env.DATA_DIR ?? dirs.data);
  await mkdir(dir, { recursive: true });
  return openPglite(dir);
}

function readKey(value: string | undefined): Buffer | null {
  if (!value) return null;
  const key = Buffer.from(value, "base64");
  if (key.length !== 32) {
    console.error("AI_DATA_KEY nu are 32 de octeți. Furnizorii AI rămân opriți.");
    return null;
  }
  return key;
}
