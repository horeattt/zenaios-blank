import type { Db } from "./db.js";

export type PageQuery = { limit: number; offset: number };

export function parsePage(query: Record<string, unknown>, max = 100): PageQuery {
  const limitRaw = Number(query.limit ?? 50);
  const offsetRaw = Number(query.offset ?? 0);
  const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(1, Math.trunc(limitRaw)), max) : 50;
  const offset = Number.isFinite(offsetRaw) ? Math.max(0, Math.trunc(offsetRaw)) : 0;
  return { limit, offset };
}

/** Admin și utilizatorii fără domeniu atribuit văd tot spitalul. Altfel: doar secțiile din domeniu. */
export async function loadWardScopeIds(db: Db, hospitalId: string, userId: string, isAdmin: boolean): Promise<string[] | null> {
  if (isAdmin) return null;
  const scopes = await db.query<{ ward_id: string }>(
    "SELECT ward_id FROM user_ward_scopes WHERE hospital_id = $1 AND user_id = $2",
    [hospitalId, userId]
  );
  if (!scopes.length) return null;
  return scopes.map((row) => row.ward_id);
}

export function assertWardInScope(wardId: string, scopeIds: string[] | null): void {
  if (scopeIds && !scopeIds.includes(wardId)) {
    throw Object.assign(new Error("Secția nu este în domeniul tău."), { statusCode: 403 });
  }
}

export async function canReadPatient(
  db: Db,
  hospitalId: string,
  userId: string,
  patientId: string,
  permissions: Set<string>
): Promise<{ allowed: boolean; via: "admin" | "unscoped" | "care_team" | "ward" | "denied" }> {
  if (permissions.has("user.admin") || permissions.has("audit.read")) return { allowed: true, via: "admin" };

  const scopes = await loadWardScopeIds(db, hospitalId, userId, false);
  if (!scopes) return { allowed: true, via: "unscoped" };

  const onTeam = await db.query(
    "SELECT 1 FROM care_team WHERE hospital_id = $1 AND patient_id = $2 AND user_id = $3 AND active LIMIT 1",
    [hospitalId, patientId, userId]
  );
  if (onTeam.length) return { allowed: true, via: "care_team" };

  const onWard = await db.query(
    `SELECT 1 FROM admissions a
     WHERE a.hospital_id = $1 AND a.patient_id = $2 AND a.status = 'active'
       AND a.current_ward_id = ANY($3::uuid[])
     LIMIT 1`,
    [hospitalId, patientId, scopes]
  );
  if (onWard.length) return { allowed: true, via: "ward" };
  return { allowed: false, via: "denied" };
}
