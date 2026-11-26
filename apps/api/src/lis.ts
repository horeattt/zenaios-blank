import { newId } from "./audit.js";
import type { Db } from "./db.js";

export type LisDispatchResult = {
  messageId: string;
  outboxId: string;
  controlId: string;
  ackCode: "AA" | "AE";
  status: "acked" | "failed";
};

/** Construiește un mesaj HL7 v2.5.1 OML^O21 minimal, fără PHI în log-uri. */
export function buildOmlO21(input: {
  controlId: string;
  hospitalName: string;
  patientId: string;
  lastName: string;
  firstName: string;
  sex: string | null;
  serviceRequestId: string;
  code: string;
  display: string;
  now?: Date;
}): string {
  const ts = formatHl7Ts(input.now ?? new Date());
  const sex = input.sex === "F" ? "F" : input.sex === "M" ? "M" : "U";
  const segments = [
    `MSH|^~\\&|ZenAIOS|${escapeHl7(input.hospitalName)}|LIS|LAB|${ts}||OML^O21^OML_O21|${escapeHl7(input.controlId)}|P|2.5.1`,
    `PID|1||${escapeHl7(input.patientId)}^^^ZenAIOS^PI||${escapeHl7(input.lastName)}^${escapeHl7(input.firstName)}||${sex}`,
    `ORC|NW|${escapeHl7(input.serviceRequestId)}|||||||${ts}`,
    `OBR|1|${escapeHl7(input.serviceRequestId)}||${escapeHl7(input.code)}^${escapeHl7(input.display)}^LN`
  ];
  return segments.join("\r");
}

export function simulateLisAck(hl7: string): { ackCode: "AA" | "AE"; ack: string; controlId: string } {
  const msh = hl7.split("\r")[0] ?? "";
  const fields = msh.split("|");
  const controlId = fields[9] ?? "UNKNOWN";
  const valid = fields[0] === "MSH" && (fields[8] ?? "").startsWith("OML^O21");
  const ackCode: "AA" | "AE" = valid ? "AA" : "AE";
  const ts = formatHl7Ts(new Date());
  const ack = [
    `MSH|^~\\&|LIS|LAB|ZenAIOS|HOSP|${ts}||ACK^O21^ACK|ACK-${controlId}|P|2.5.1`,
    `MSA|${ackCode}|${controlId}`
  ].join("\r");
  return { ackCode, ack, controlId };
}

export async function dispatchHeldLis(
  db: Db,
  hospitalId: string,
  actorUserId: string,
  limit = 20
): Promise<LisDispatchResult[]> {
  const hospital = await db.query<{ name: string }>("SELECT name FROM hospitals WHERE id = $1", [hospitalId]);
  if (!hospital[0]) throw Object.assign(new Error("Spitalul nu există."), { statusCode: 404 });
  const held = await db.query<{ id: string; payload: unknown; idempotency_key: string }>(
    `SELECT id, payload, idempotency_key FROM integration_outbox
     WHERE hospital_id = $1 AND destination = 'lis' AND status = 'held'
     ORDER BY created_at ASC LIMIT $2`,
    [hospitalId, limit]
  );
  const results: LisDispatchResult[] = [];
  for (const row of held) {
    const payload = typeof row.payload === "string" ? JSON.parse(row.payload) as { serviceRequestId?: string } : (row.payload as { serviceRequestId?: string } | null);
    const serviceRequestId = payload?.serviceRequestId ?? row.idempotency_key;
    const request = await db.query<{
      id: string;
      patient_id: string;
      code: string;
      display: string;
      first_name: string;
      last_name: string;
      sex: string | null;
    }>(
      `SELECT sr.id, sr.patient_id, sr.code, sr.display, p.first_name, p.last_name, p.sex
       FROM service_requests sr JOIN patients p ON p.id = sr.patient_id
       WHERE sr.id = $1 AND sr.hospital_id = $2`,
      [serviceRequestId, hospitalId]
    );
    if (!request[0]) {
      await db.query(
        "UPDATE integration_outbox SET status = 'failed' WHERE id = $1 AND hospital_id = $2",
        [row.id, hospitalId]
      );
      continue;
    }
    const controlId = `CTRL-${row.id.slice(0, 8)}`;
    const hl7 = buildOmlO21({
      controlId,
      hospitalName: hospital[0].name,
      patientId: request[0].patient_id,
      lastName: request[0].last_name,
      firstName: request[0].first_name,
      sex: request[0].sex,
      serviceRequestId: request[0].id,
      code: request[0].code,
      display: request[0].display
    });
    const { ackCode, ack } = simulateLisAck(hl7);
    const messageId = newId();
    const status = ackCode === "AA" ? "acked" : "failed";
    await db.tx(async (q) => {
      await q.query(
        `INSERT INTO lis_messages
          (id, hospital_id, outbox_id, service_request_id, direction, message_type, control_id, hl7, ack_code, status)
         VALUES ($1,$2,$3,$4,'outbound','OML^O21',$5,$6,$7,$8)`,
        [messageId, hospitalId, row.id, request[0].id, controlId, hl7, ackCode, status]
      );
      await q.query(
        `INSERT INTO lis_messages
          (id, hospital_id, outbox_id, service_request_id, direction, message_type, control_id, hl7, ack_code, status)
         VALUES ($1,$2,$3,$4,'inbound','ACK^O21',$5,$6,$7,$8)`,
        [newId(), hospitalId, row.id, request[0].id, `ACK-${controlId}`, ack, ackCode, status]
      );
      await q.query(
        `UPDATE integration_outbox SET status = $3 WHERE id = $1 AND hospital_id = $2`,
        [row.id, hospitalId, ackCode === "AA" ? "sent" : "failed"]
      );
      await q.query(
        "UPDATE integration_catalog SET status = 'testat' WHERE code = 'lis'"
      );
    });
    results.push({
      messageId,
      outboxId: row.id,
      controlId,
      ackCode,
      status
    });
  }
  void actorUserId;
  return results;
}

function formatHl7Ts(date: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${date.getUTCFullYear()}${p(date.getUTCMonth() + 1)}${p(date.getUTCDate())}${p(date.getUTCHours())}${p(date.getUTCMinutes())}${p(date.getUTCSeconds())}`;
}

function escapeHl7(value: string): string {
  return value.replace(/([|\\^~&])/g, "\\$1").slice(0, 120);
}
