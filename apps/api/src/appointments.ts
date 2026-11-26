import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { newId, writeAudit } from "./audit.js";
import type { Db } from "./db.js";
import { buildSiuMessage, type SiuTrigger } from "./hl7-siu.js";

type SessionUser = {
  id: string;
  hospitalId: string | null;
  permissions: Set<string>;
  displayName?: string;
};

type RouteFn = (
  method: "get" | "post" | "put" | "delete",
  url: string,
  permission: string | undefined,
  handler: (request: FastifyRequest, reply: FastifyReply) => Promise<unknown>
) => void;

export type AppointmentDeps = {
  db: Db;
  route: RouteFn;
  requireUser: (request: FastifyRequest) => SessionUser;
  requireHospital: (request: FastifyRequest) => string;
  mustOwn: (q: { query: Db["query"] }, table: string, id: string, hospitalId: string) => Promise<void>;
  one: <T>(q: { query: Db["query"] }, text: string, params: unknown[]) => Promise<T>;
  fail: (status: number, message: string) => never;
  param: (request: FastifyRequest, name: string) => string;
};

export async function registerAppointmentRoutes(_app: FastifyInstance, deps: AppointmentDeps): Promise<void> {
  const { db, route, requireUser, requireHospital, mustOwn, one, fail, param } = deps;

  route("get", "/api/appointments/schedules", "appointment.read", async (request) => {
    const hospitalId = requireHospital(request);
    const query = z.object({ wardId: z.string().uuid().optional() }).parse(request.query);
    const params: unknown[] = [hospitalId];
    let sql = `SELECT s.id, s.ward_id, s.practitioner_user_id, s.specialty, s.location, s.active,
                      u.display_name AS practitioner_name, w.name AS ward_name
               FROM ambulatory_schedules s
               JOIN users u ON u.id = s.practitioner_user_id
               LEFT JOIN wards w ON w.id = s.ward_id
               WHERE s.hospital_id = $1 AND s.active`;
    if (query.wardId) {
      params.push(query.wardId);
      sql += ` AND s.ward_id = $2`;
    }
    sql += " ORDER BY s.specialty, u.display_name";
    return { items: await db.query(sql, params) };
  });

  route("post", "/api/appointments/schedules", "appointment.write", async (request) => {
    const actor = requireUser(request);
    const hospitalId = requireHospital(request);
    const body = z.object({
      practitionerUserId: z.string().uuid(),
      wardId: z.string().uuid().optional().nullable(),
      specialty: z.string().min(1).max(120),
      location: z.string().min(1).max(120).default("Ambulatoriu")
    }).parse(request.body);
    await mustOwn(db, "users", body.practitionerUserId, hospitalId);
    if (body.wardId) await mustOwn(db, "wards", body.wardId, hospitalId);
    const existing = await db.query<{ id: string }>(
      `SELECT id FROM ambulatory_schedules
       WHERE hospital_id = $1 AND practitioner_user_id = $2 AND specialty = $3
         AND ward_id IS NOT DISTINCT FROM $4`,
      [hospitalId, body.practitionerUserId, body.specialty, body.wardId ?? null]
    );
    const id = existing[0]?.id ?? newId();
    if (existing[0]) {
      await db.query(
        `UPDATE ambulatory_schedules SET location = $2, active = true WHERE id = $1 AND hospital_id = $3`,
        [id, body.location, hospitalId]
      );
    } else {
      await db.query(
        `INSERT INTO ambulatory_schedules (id, hospital_id, ward_id, practitioner_user_id, specialty, location)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [id, hospitalId, body.wardId ?? null, body.practitionerUserId, body.specialty, body.location]
      );
    }
    await db.tx((q) => writeAudit(q, {
      hospitalId, actorUserId: actor.id, action: "schedule_upsert", entityType: "ambulatory_schedule", entityId: id,
      summary: `Program ambulatoriu ${body.specialty}.`
    }));
    return { id, specialty: body.specialty };
  });

  route("get", "/api/appointments", "appointment.read", async (request) => {
    const hospitalId = requireHospital(request);
    const query = z.object({
      from: z.string().datetime(),
      to: z.string().datetime(),
      wardId: z.string().uuid().optional(),
      practitionerUserId: z.string().uuid().optional(),
      specialty: z.string().max(120).optional()
    }).parse(request.query);
    const params: unknown[] = [hospitalId, query.from, query.to];
    let sql = `SELECT a.id, a.ward_id, a.practitioner_user_id, a.patient_id, a.patient_first_name, a.patient_last_name,
                      a.patient_cnp, a.specialty, a.location, a.reason, a.status, a.starts_at, a.ends_at,
                      a.duration_minutes, a.placer_appointment_id, a.hl7_control_id, a.last_siu_trigger,
                      u.display_name AS practitioner_name, w.name AS ward_name
               FROM appointments a
               JOIN users u ON u.id = a.practitioner_user_id
               LEFT JOIN wards w ON w.id = a.ward_id
               WHERE a.hospital_id = $1 AND a.starts_at >= $2 AND a.starts_at < $3`;
    if (query.wardId) {
      params.push(query.wardId);
      sql += ` AND a.ward_id = $${params.length}`;
    }
    if (query.practitionerUserId) {
      params.push(query.practitionerUserId);
      sql += ` AND a.practitioner_user_id = $${params.length}`;
    }
    if (query.specialty) {
      params.push(query.specialty);
      sql += ` AND a.specialty = $${params.length}`;
    }
    sql += " ORDER BY a.starts_at, u.display_name";
    return { items: await db.query(sql, params), standard: "HL7 v2.5.1 SIU" };
  });

  route("get", "/api/appointments/stats", "appointment.admin", async (request) => {
    const hospitalId = requireHospital(request);
    const query = z.object({
      from: z.string().datetime().optional(),
      to: z.string().datetime().optional()
    }).parse(request.query);
    const from = query.from ?? new Date(new Date().setHours(0, 0, 0, 0)).toISOString();
    const to = query.to ?? new Date(Date.now() + 7 * 86400000).toISOString();
    const byStatus = await db.query<{ status: string; n: number }>(
      `SELECT status, count(*)::int AS n FROM appointments
       WHERE hospital_id = $1 AND starts_at >= $2 AND starts_at < $3
       GROUP BY status ORDER BY status`,
      [hospitalId, from, to]
    );
    const bySpecialty = await db.query<{ specialty: string; n: number }>(
      `SELECT specialty, count(*)::int AS n FROM appointments
       WHERE hospital_id = $1 AND starts_at >= $2 AND starts_at < $3 AND status <> 'cancelled'
       GROUP BY specialty ORDER BY n DESC`,
      [hospitalId, from, to]
    );
    const byPractitioner = await db.query<{ practitioner_user_id: string; practitioner_name: string; n: number }>(
      `SELECT a.practitioner_user_id, u.display_name AS practitioner_name, count(*)::int AS n
       FROM appointments a JOIN users u ON u.id = a.practitioner_user_id
       WHERE a.hospital_id = $1 AND a.starts_at >= $2 AND a.starts_at < $3 AND a.status <> 'cancelled'
       GROUP BY a.practitioner_user_id, u.display_name ORDER BY n DESC`,
      [hospitalId, from, to]
    );
    const byWard = await db.query<{ ward_id: string | null; ward_name: string; n: number }>(
      `SELECT a.ward_id, COALESCE(w.name, 'Ambulatoriu general') AS ward_name, count(*)::int AS n
       FROM appointments a LEFT JOIN wards w ON w.id = a.ward_id
       WHERE a.hospital_id = $1 AND a.starts_at >= $2 AND a.starts_at < $3 AND a.status <> 'cancelled'
       GROUP BY a.ward_id, w.name ORDER BY n DESC`,
      [hospitalId, from, to]
    );
    const total = byStatus.reduce((acc, row) => acc + Number(row.n), 0);
    return { from, to, total, byStatus, bySpecialty, byPractitioner, byWard };
  });

  route("post", "/api/appointments", "appointment.write", async (request) => {
    const actor = requireUser(request);
    const hospitalId = requireHospital(request);
    const body = z.object({
      practitionerUserId: z.string().uuid(),
      wardId: z.string().uuid().optional().nullable(),
      scheduleId: z.string().uuid().optional().nullable(),
      patientId: z.string().uuid().optional().nullable(),
      patientFirstName: z.string().min(1).max(80),
      patientLastName: z.string().min(1).max(80),
      patientCnp: z.string().regex(/^\d{13}$/).optional().nullable(),
      specialty: z.string().min(1).max(120),
      location: z.string().min(1).max(120).default("Ambulatoriu"),
      reason: z.string().max(400).optional(),
      startsAt: z.string().datetime(),
      durationMinutes: z.number().int().min(5).max(240).default(30)
    }).parse(request.body);

    await mustOwn(db, "users", body.practitionerUserId, hospitalId);
    if (body.wardId) await mustOwn(db, "wards", body.wardId, hospitalId);
    if (body.patientId) await mustOwn(db, "patients", body.patientId, hospitalId);

    const start = new Date(body.startsAt);
    const end = new Date(start.getTime() + body.durationMinutes * 60_000);
    await assertNoOverlap(db, hospitalId, body.practitionerUserId, start, end);

    const id = newId();
    const placerId = `APT-${id.slice(0, 8).toUpperCase()}`;
    const controlId = `SIU${Date.now()}`;
    await db.query(
      `INSERT INTO appointments (
         id, hospital_id, schedule_id, ward_id, practitioner_user_id, patient_id,
         patient_first_name, patient_last_name, patient_cnp, specialty, location, reason,
         placer_appointment_id, filler_appointment_id, status, starts_at, ends_at, duration_minutes,
         hl7_control_id, last_siu_trigger, created_by
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$13,'booked',$14,$15,$16,$17,'S12',$18)`,
      [
        id, hospitalId, body.scheduleId ?? null, body.wardId ?? null, body.practitionerUserId, body.patientId ?? null,
        body.patientFirstName, body.patientLastName, body.patientCnp ?? null, body.specialty, body.location,
        body.reason ?? null, placerId, start.toISOString(), end.toISOString(), body.durationMinutes, controlId, actor.id
      ]
    );

    const hl7 = await persistSiu(db, hospitalId, id, "S12", controlId);
    await db.tx((q) => writeAudit(q, {
      hospitalId, actorUserId: actor.id, action: "appointment_book", entityType: "appointment", entityId: id,
      summary: `Programare ambulatoriu SIU^S12 ${body.specialty}.`
    }));
    return { id, placerAppointmentId: placerId, status: "booked", hl7ControlId: controlId, siu: "S12", hl7Stored: Boolean(hl7) };
  });

  route("post", "/api/appointments/:id/reschedule", "appointment.write", async (request) => {
    const actor = requireUser(request);
    const hospitalId = requireHospital(request);
    const id = param(request, "id");
    const body = z.object({
      startsAt: z.string().datetime(),
      durationMinutes: z.number().int().min(5).max(240).optional()
    }).parse(request.body);
    const current = await one<{
      practitioner_user_id: string; status: string; duration_minutes: number;
    }>(db, "SELECT practitioner_user_id, status, duration_minutes FROM appointments WHERE id = $1 AND hospital_id = $2", [id, hospitalId]);
    if (current.status === "cancelled") fail(409, "Programarea este anulată.");
    const duration = body.durationMinutes ?? Number(current.duration_minutes);
    const start = new Date(body.startsAt);
    const end = new Date(start.getTime() + duration * 60_000);
    await assertNoOverlap(db, hospitalId, current.practitioner_user_id, start, end, id);
    const controlId = `SIU${Date.now()}`;
    await db.query(
      `UPDATE appointments SET starts_at = $3, ends_at = $4, duration_minutes = $5, status = 'rescheduled',
         hl7_control_id = $6, last_siu_trigger = 'S13', updated_at = now()
       WHERE id = $1 AND hospital_id = $2`,
      [id, hospitalId, start.toISOString(), end.toISOString(), duration, controlId]
    );
    await persistSiu(db, hospitalId, id, "S13", controlId);
    await db.tx((q) => writeAudit(q, {
      hospitalId, actorUserId: actor.id, action: "appointment_reschedule", entityType: "appointment", entityId: id,
      summary: "Reprogramare SIU^S13."
    }));
    return { id, status: "rescheduled", siu: "S13" };
  });

  route("post", "/api/appointments/:id/status", "appointment.write", async (request) => {
    const actor = requireUser(request);
    const hospitalId = requireHospital(request);
    const id = param(request, "id");
    const body = z.object({
      status: z.enum(["booked", "arrived", "fulfilled", "cancelled", "noshow"])
    }).parse(request.body);
    const trigger: SiuTrigger = body.status === "cancelled" ? "S15" : body.status === "noshow" ? "S26" : "S14";
    const controlId = `SIU${Date.now()}`;
    const updated = await db.query(
      `UPDATE appointments SET status = $3, hl7_control_id = $4, last_siu_trigger = $5, updated_at = now()
       WHERE id = $1 AND hospital_id = $2 RETURNING id`,
      [id, hospitalId, body.status, controlId, trigger]
    );
    if (!updated.length) fail(404, "Programarea nu există.");
    await persistSiu(db, hospitalId, id, trigger, controlId);
    await db.tx((q) => writeAudit(q, {
      hospitalId, actorUserId: actor.id, action: "appointment_status", entityType: "appointment", entityId: id,
      summary: `Status ${body.status} · SIU^${trigger}.`
    }));
    return { id, status: body.status, siu: trigger };
  });

  route("get", "/api/appointments/:id/hl7", "appointment.read", async (request) => {
    const hospitalId = requireHospital(request);
    const id = param(request, "id");
    await mustOwn(db, "appointments", id, hospitalId);
    const rows = await db.query(
      `SELECT id, message_type, trigger_event, control_id, hl7, status, created_at
       FROM appointment_hl7_messages WHERE hospital_id = $1 AND appointment_id = $2
       ORDER BY created_at DESC`,
      [hospitalId, id]
    );
    return { items: rows };
  });

  route("get", "/api/appointments/practitioners", "appointment.read", async (request) => {
    const hospitalId = requireHospital(request);
    const query = z.object({ wardId: z.string().uuid().optional() }).parse(request.query);
    // Medici: rol physician (+ cei cu schedule ambulatoriu)
    const params: unknown[] = [hospitalId];
    let sql = `SELECT DISTINCT u.id, u.display_name, u.username,
                      COALESCE(s.specialty, w.specialty, 'General') AS specialty,
                      s.ward_id, w.name AS ward_name
               FROM users u
               JOIN user_roles ur ON ur.user_id = u.id
               JOIN roles r ON r.id = ur.role_id
               LEFT JOIN ambulatory_schedules s ON s.practitioner_user_id = u.id AND s.hospital_id = u.hospital_id AND s.active
               LEFT JOIN wards w ON w.id = s.ward_id
               WHERE u.hospital_id = $1 AND u.active AND r.code = 'physician'`;
    if (query.wardId) {
      params.push(query.wardId);
      sql += ` AND (s.ward_id = $2 OR EXISTS (
        SELECT 1 FROM user_ward_scopes uws WHERE uws.user_id = u.id AND uws.ward_id = $2
      ))`;
    }
    sql += " ORDER BY u.display_name";
    return { items: await db.query(sql, params) };
  });

  async function persistSiu(dbConn: Db, hospitalId: string, appointmentId: string, trigger: SiuTrigger, controlId: string): Promise<string> {
    const row = await one<{
      placer_appointment_id: string; filler_appointment_id: string | null; starts_at: string; ends_at: string;
      duration_minutes: number; status: string; specialty: string; location: string; reason: string | null;
      patient_id: string | null; patient_first_name: string; patient_last_name: string; patient_cnp: string | null;
      practitioner_user_id: string; practitioner_name: string; ward_name: string | null; hospital_name: string;
    }>(
      dbConn,
      `SELECT a.placer_appointment_id, a.filler_appointment_id, a.starts_at, a.ends_at, a.duration_minutes, a.status,
              a.specialty, a.location, a.reason, a.patient_id, a.patient_first_name, a.patient_last_name, a.patient_cnp,
              a.practitioner_user_id, u.display_name AS practitioner_name, w.name AS ward_name, h.name AS hospital_name
       FROM appointments a
       JOIN users u ON u.id = a.practitioner_user_id
       JOIN hospitals h ON h.id = a.hospital_id
       LEFT JOIN wards w ON w.id = a.ward_id
       WHERE a.id = $1 AND a.hospital_id = $2`,
      [appointmentId, hospitalId]
    );
    const hl7 = buildSiuMessage(trigger, {
      controlId,
      hospitalName: row.hospital_name,
      placerId: row.placer_appointment_id,
      fillerId: row.filler_appointment_id,
      startsAt: new Date(row.starts_at),
      endsAt: new Date(row.ends_at),
      durationMinutes: Number(row.duration_minutes),
      status: row.status,
      specialty: row.specialty,
      location: row.location,
      reason: row.reason,
      patientId: row.patient_id,
      patientLastName: row.patient_last_name,
      patientFirstName: row.patient_first_name,
      patientCnp: row.patient_cnp,
      practitionerUserId: row.practitioner_user_id,
      practitionerName: row.practitioner_name,
      wardName: row.ward_name
    });
    await dbConn.query(
      `INSERT INTO appointment_hl7_messages (id, hospital_id, appointment_id, message_type, trigger_event, control_id, hl7, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'stored')`,
      [newId(), hospitalId, appointmentId, `SIU^${trigger}`, trigger, controlId, hl7]
    );
    return hl7;
  }
}

async function assertNoOverlap(
  db: Db,
  hospitalId: string,
  practitionerUserId: string,
  start: Date,
  end: Date,
  exceptId?: string
): Promise<void> {
  const params: unknown[] = [hospitalId, practitionerUserId, start.toISOString(), end.toISOString()];
  let sql = `SELECT id FROM appointments
             WHERE hospital_id = $1 AND practitioner_user_id = $2
               AND status NOT IN ('cancelled', 'noshow')
               AND starts_at < $4 AND ends_at > $3`;
  if (exceptId) {
    params.push(exceptId);
    sql += ` AND id <> $5`;
  }
  sql += " LIMIT 1";
  const rows = await db.query(sql, params);
  if (rows.length) {
    throw Object.assign(new Error("Medicul are deja o programare în acest interval."), { statusCode: 409 });
  }
}
