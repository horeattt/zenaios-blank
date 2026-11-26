import type { Db, Queryable } from "./db.js";
import { decryptString, encryptString } from "./security.js";

const TABLES = [
  "hospitals",
  "buildings",
  "departments",
  "wards",
  "rooms",
  "beds",
  "users",
  "collection_workspaces",
  "roles",
  "role_permissions",
  "user_roles",
  "sessions",
  "practitioners",
  "employees",
  "patients",
  "patient_identifiers",
  "encounters",
  "admissions",
  "transfers",
  "diagnoses",
  "allergies",
  "clinical_notes",
  "service_requests",
  "specimens",
  "observations",
  "critical_notifications",
  "diagnostic_reports",
  "medication_orders",
  "medication_administrations",
  "documents",
  "consents",
  "shifts",
  "leave_requests",
  "inventory_items",
  "ai_provider_configs",
  "zena_requests",
  "change_proposals",
  "extension_versions",
  "integration_outbox",
  "report_exports",
  "user_ward_scopes",
  "care_team",
  "emergency_access_events",
  "lis_messages",
  "backup_runs"
] as const;

const RESTORE_ORDER = TABLES;

export async function exportSnapshot(db: Db): Promise<Record<string, unknown[]>> {
  const snapshot: Record<string, unknown[]> = {};
  for (const table of TABLES) {
    snapshot[table] = await db.query(`SELECT * FROM ${table}`);
  }
  return snapshot;
}

export function sealSnapshot(snapshot: Record<string, unknown[]>, key: Buffer): string {
  return `ZENBACKUP1.${encryptString(JSON.stringify(snapshot), key)}`;
}

export function openSnapshot(payload: string, key: Buffer): Record<string, unknown[]> {
  if (!payload.startsWith("ZENBACKUP1.")) throw new Error("Formatul copiei nu este recunoscut.");
  return JSON.parse(decryptString(payload.slice("ZENBACKUP1.".length), key)) as Record<string, unknown[]>;
}

export async function restoreSnapshot(db: Db, snapshot: Record<string, unknown[]>): Promise<void> {
  await db.tx(async (q) => {
    await q.exec(`TRUNCATE TABLE ${TABLES.join(", ")} RESTART IDENTITY CASCADE`);
    for (const table of RESTORE_ORDER) {
      const rows = snapshot[table] ?? [];
      for (const row of rows) await insertRow(q, table, row as Record<string, unknown>);
    }
  });
}

async function insertRow(q: Queryable, table: string, row: Record<string, unknown>): Promise<void> {
  const entries = Object.entries(row).filter(([, value]) => value !== undefined);
  if (!entries.length) return;
  const columns = entries.map(([key]) => key);
  if (columns.some((column) => !/^[a-z_]+$/.test(column))) throw new Error("Coloană neașteptată în copie.");
  const params = entries.map(([, value]) => normalize(value));
  const placeholders = params.map((_, index) => `$${index + 1}`).join(", ");
  await q.query(
    `INSERT INTO ${table} (${columns.join(", ")}) VALUES (${placeholders})`,
    params
  );
}

function normalize(value: unknown): unknown {
  if (value && typeof value === "object" && !Array.isArray(value) && !(value instanceof Date)) {
    return JSON.stringify(value);
  }
  return value;
}
