import { randomUUID } from "node:crypto";
import type { Queryable } from "./db.js";
import { canonical, sha256 } from "./security.js";

export type AuditInput = {
  hospitalId: string | null;
  actorUserId: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  summary: string;
};

export async function writeAudit(q: Queryable, input: AuditInput): Promise<void> {
  const scope = input.hospitalId ?? "system";
  const summary = input.summary.slice(0, 300);
  await q.query(
    "INSERT INTO audit_heads (scope, last_hash) VALUES ($1, 'genesis') ON CONFLICT (scope) DO NOTHING",
    [scope]
  );
  const head = await q.query<{ last_hash: string }>("SELECT last_hash FROM audit_heads WHERE scope = $1 FOR UPDATE", [scope]);
  const prev = head[0]?.last_hash ?? "genesis";
  const rowHash = sha256(canonical({
    scope,
    hospitalId: input.hospitalId,
    actorUserId: input.actorUserId,
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId ?? null,
    summary,
    prev
  }));
  await q.query(
    `INSERT INTO audit_events
      (scope, hospital_id, actor_user_id, action, entity_type, entity_id, summary, prev_hash, row_hash)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [scope, input.hospitalId, input.actorUserId, input.action, input.entityType, input.entityId ?? null, summary, prev, rowHash]
  );
  await q.query("UPDATE audit_heads SET last_hash = $2 WHERE scope = $1", [scope, rowHash]);
}

export function newId(): string {
  return randomUUID();
}
