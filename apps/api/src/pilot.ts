import { mkdir, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { newId, writeAudit } from "./audit.js";
import type { Db } from "./db.js";
import { toCsv, toHtmlDoc, toSimplePdf, toXlsx, writeReportArtifact, type ExportFormat } from "./exports.js";
import type { AppDirs } from "./paths.js";
import { applyZenaAdminCommand, dictationBody, ensureIntegrationSeed, normalizeDictation, seedFlows } from "./zena-admin.js";

type SessionUser = {
  id: string;
  hospitalId: string | null;
  permissions: Set<string>;
};

type RouteFn = (
  method: "get" | "post" | "put" | "delete",
  url: string,
  permission: string | undefined,
  handler: (request: FastifyRequest, reply: FastifyReply) => Promise<unknown>
) => void;

export type PilotDeps = {
  db: Db;
  dirs: AppDirs;
  route: RouteFn;
  requireUser: (request: FastifyRequest) => SessionUser;
  requireHospital: (request: FastifyRequest) => string;
  mustOwn: (q: { query: Db["query"] }, table: string, id: string, hospitalId: string) => Promise<void>;
  one: <T>(q: { query: Db["query"] }, text: string, params: unknown[]) => Promise<T>;
  fail: (status: number, message: string) => never;
  param: (request: FastifyRequest, name: string) => string;
};

export async function registerPilotRoutes(_app: FastifyInstance, deps: PilotDeps): Promise<void> {
  const { db, dirs, route, requireUser, requireHospital, mustOwn, one, fail, param } = deps;

  route("get", "/api/ops/paths", "ops.admin", async () => ({
    root: dirs.root,
    data: dirs.data,
    backups: dirs.backups,
    files: dirs.files,
    exports: dirs.exports,
    patients: dirs.patients,
    note: "Backup-urile și fișierele pacient stau pe disc lângă soft (data/)."
  }));

  route("get", "/api/ops/monitor", "ops.admin", async (request) => {
    const hospitalId = requireHospital(request);
    const [patients, admissions, backups, outbox, duties] = await Promise.all([
      db.query<{ n: number }>("SELECT count(*)::int AS n FROM patients WHERE hospital_id = $1", [hospitalId]),
      db.query<{ n: number }>("SELECT count(*)::int AS n FROM admissions WHERE hospital_id = $1 AND status = 'active'", [hospitalId]),
      db.query<{ n: number }>("SELECT count(*)::int AS n FROM backup_runs WHERE status = 'ok'"),
      db.query<{ n: number }>("SELECT count(*)::int AS n FROM integration_outbox WHERE hospital_id = $1 AND status = 'held'", [hospitalId]),
      db.query<{ n: number }>("SELECT count(*)::int AS n FROM duty_shifts WHERE hospital_id = $1 AND duty_date = current_date", [hospitalId])
    ]);
    return {
      ok: true,
      patients: patients[0]?.n ?? 0,
      activeAdmissions: admissions[0]?.n ?? 0,
      backupOkCount: backups[0]?.n ?? 0,
      lisHeld: outbox[0]?.n ?? 0,
      dutiesToday: duties[0]?.n ?? 0,
      paths: { backups: dirs.backups, files: dirs.files, exports: dirs.exports },
      sourceOfTruth: "clinical.admissions + patients (API), nu localStorage"
    };
  });

  route("post", "/api/ops/backup/test-restore", "ops.admin", async (request) => {
    const actor = requireUser(request);
    const hospitalId = requireHospital(request);
    const runs = await db.query<{ id: string; path: string; kind: string; status: string }>(
      "SELECT id, path, kind, status FROM backup_runs WHERE status = 'ok' ORDER BY created_at DESC LIMIT 1"
    );
    if (!runs[0]) fail(404, "Nu există o copie de rezervă reușită de testat.");
    const run = runs[0];
    const content = await readFile(run.path);
    const probe = join(dirs.backups, `restore-probe-${Date.now()}.bin`);
    await writeFile(probe, content);
    await db.tx((q) => writeAudit(q, {
      hospitalId, actorUserId: actor.id, action: "restore_probe", entityType: "backup_run", entityId: run.id,
      summary: "Test restaurare: fișierul a fost citit și rescris pe disc (probe)."
    }));
    return { ok: true, backupId: run.id, probePath: probe, bytes: content.length, note: "Probe de restaurare pe disc; nu înlocuiește baza live." };
  });

  route("get", "/api/census", "structure.read", async (request) => {
    const hospitalId = requireHospital(request);
    const wards = await db.query<{
      id: string; name: string; bed_total: number; occupied: number; free: number;
    }>(
      `SELECT w.id, w.name,
         count(b.id)::int AS bed_total,
         count(a.id)::int AS occupied,
         (count(b.id) - count(a.id))::int AS free
       FROM wards w
       LEFT JOIN rooms r ON r.ward_id = w.id
       LEFT JOIN beds b ON b.room_id = r.id AND b.status = 'open'
       LEFT JOIN admissions a ON a.bed_id = b.id AND a.status = 'active'
       WHERE w.hospital_id = $1
       GROUP BY w.id, w.name
       ORDER BY w.name`,
      [hospitalId]
    );
    const totals = wards.reduce(
      (acc, row) => ({ beds: acc.beds + row.bed_total, occupied: acc.occupied + row.occupied, free: acc.free + row.free }),
      { beds: 0, occupied: 0, free: 0 }
    );
    return {
      sourceOfTruth: "clinical.admissions",
      updatedAt: new Date().toISOString(),
      totals,
      wards
    };
  });

  route("get", "/api/integrations/endpoints", "integration.admin", async (request) => {
    const hospitalId = requireHospital(request);
    await ensureIntegrationSeed(db, hospitalId);
    return db.query(
      `SELECT id, code, name, base_url, mode, auth_kind, last_tested_at, last_test_ok, last_test_detail, updated_at
       FROM integration_endpoints WHERE hospital_id = $1 ORDER BY code`,
      [hospitalId]
    );
  });

  route("put", "/api/integrations/endpoints/:code", "integration.admin", async (request) => {
    const actor = requireUser(request);
    const hospitalId = requireHospital(request);
    const code = String((request.params as { code: string }).code || "").toLowerCase();
    await ensureIntegrationSeed(db, hospitalId);
    const body = z.object({
      baseUrl: z.string().url().optional().nullable(),
      mode: z.enum(["neconfigurat", "simulator", "test", "productie"]).optional(),
      authKind: z.enum(["none", "bearer", "basic", "mutual_tls"]).optional(),
      config: z.record(z.unknown()).optional()
    }).parse(request.body);
    const updated = await db.query(
      `UPDATE integration_endpoints SET
         base_url = COALESCE($3, base_url),
         mode = COALESCE($4, mode),
         auth_kind = COALESCE($5, auth_kind),
         config = COALESCE($6::jsonb, config),
         updated_at = now()
       WHERE hospital_id = $1 AND code = $2
       RETURNING id, code, name, base_url, mode, auth_kind`,
      [hospitalId, code, body.baseUrl ?? null, body.mode ?? null, body.authKind ?? null, body.config ? JSON.stringify(body.config) : null]
    );
    if (!updated.length) fail(404, "Integrarea nu există.");
    await db.tx((q) => writeAudit(q, {
      hospitalId, actorUserId: actor.id, action: "integration_update", entityType: "integration_endpoint", entityId: String(updated[0]!.id),
      summary: `Integrare ${code} actualizată.`
    }));
    return updated[0];
  });

  route("post", "/api/integrations/endpoints/:code/test", "integration.admin", async (request) => {
    const hospitalId = requireHospital(request);
    const code = String((request.params as { code: string }).code || "").toLowerCase();
    await ensureIntegrationSeed(db, hospitalId);
    const row = await one<{ id: string; mode: string; base_url: string | null }>(
      db, "SELECT id, mode, base_url FROM integration_endpoints WHERE hospital_id = $1 AND code = $2", [hospitalId, code]
    );
    let ok = false;
    let detail = "";
    if (code === "lis" && (row.mode === "simulator" || row.mode === "test")) {
      ok = true;
      detail = "LIS ACK local disponibil (simulator). Dispatch: POST /api/integrations/lis/dispatch";
    } else if (code === "docs") {
      ok = true;
      detail = "Export documente pe disc activ (data/exports).";
    } else if (code === "siui" && row.mode === "neconfigurat") {
      ok = false;
      detail = "SIUI neconfigurat — identificare CNP locală disponibilă; conectarea PIAS vine la pilot.";
    } else if (!row.base_url || row.mode === "neconfigurat") {
      ok = false;
      detail = "Neconfigurat — setați URL și modul test/productie înainte de conectare.";
    } else {
      ok = false;
      detail = "Endpoint salvat, dar conectarea live nu este încă activă în demo.";
    }
    await db.query(
      `UPDATE integration_endpoints SET last_tested_at = now(), last_test_ok = $3, last_test_detail = $4, updated_at = now()
       WHERE id = $1 AND hospital_id = $2`,
      [row.id, hospitalId, ok, detail]
    );
    return { code, ok, detail, mode: row.mode };
  });

  route("post", "/api/identity/lookup", "patient.read", async (request) => {
    const hospitalId = requireHospital(request);
    const body = z.object({ cnp: z.string().regex(/^\d{13}$/) }).parse(request.body);
    const local = await db.query(
      `SELECT p.id, p.first_name, p.last_name, p.birth_date, p.sex, p.identified
       FROM patients p
       JOIN patient_identifiers i ON i.patient_id = p.id AND i.hospital_id = p.hospital_id
       WHERE p.hospital_id = $1 AND i.system = 'urn:cnas:cnp' AND i.value = $2
       LIMIT 5`,
      [hospitalId, body.cnp]
    );
    const endpoints = await db.query<{ mode: string }>(
      "SELECT mode FROM integration_endpoints WHERE hospital_id = $1 AND code = 'siui'",
      [hospitalId]
    );
    const siuiMode = endpoints[0]?.mode ?? "neconfigurat";
    return {
      cnp: body.cnp,
      localMatches: local,
      siui: { mode: siuiMode, connected: siuiMode === "productie" || siuiMode === "test", note: siuiMode === "neconfigurat" ? "SIUI neconfigurat — căutare doar locală." : "SIUI pregătit; răspuns extern încă stub." }
    };
  });

  route("get", "/api/upu/board", "encounter.read", async (request) => {
    const hospitalId = requireHospital(request);
    const rows = await db.query(
      `SELECT u.id, u.triage_code, u.location, u.status, u.presented_at, u.patient_id, u.encounter_id,
              p.first_name, p.last_name, p.identified
       FROM upu_presentations u
       JOIN patients p ON p.id = u.patient_id
       WHERE u.hospital_id = $1 AND u.status IN ('waiting', 'in_care')
       ORDER BY
         CASE u.triage_code WHEN 'rosu' THEN 0 WHEN 'galben' THEN 1 WHEN 'verde' THEN 2 ELSE 3 END,
         u.presented_at`,
      [hospitalId]
    );
    return { items: rows, source: "upu_presentations" };
  });

  route("post", "/api/upu/presentations/:id/status", "upu.write", async (request) => {
    const actor = requireUser(request);
    const hospitalId = requireHospital(request);
    const id = param(request, "id");
    const body = z.object({ status: z.enum(["waiting", "in_care", "admitted", "discharged", "left"]) }).parse(request.body);
    const updated = await db.query(
      `UPDATE upu_presentations SET status = $3, updated_at = now()
       WHERE id = $1 AND hospital_id = $2 RETURNING id, status`,
      [id, hospitalId, body.status]
    );
    if (!updated.length) fail(404, "Prezentarea UPU nu există.");
    await db.tx((q) => writeAudit(q, {
      hospitalId, actorUserId: actor.id, action: "upu_status", entityType: "upu_presentation", entityId: id,
      summary: `UPU → ${body.status}`
    }));
    return updated[0];
  });

  route("get", "/api/duty/today", "structure.read", async (request) => {
    const hospitalId = requireHospital(request);
    const query = z.object({ wardId: z.string().uuid().optional(), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }).parse(request.query);
    const day = query.date ?? new Date().toISOString().slice(0, 10);
    const params: unknown[] = [hospitalId, day];
    let sql = `SELECT id, ward_id, duty_date, role, person_name, employee_id, starts_at, ends_at, hours, source
               FROM duty_shifts WHERE hospital_id = $1 AND duty_date = $2`;
    if (query.wardId) {
      params.push(query.wardId);
      sql += ` AND ward_id = $3`;
    }
    sql += " ORDER BY starts_at, person_name";
    const items = await db.query<{ person_name: string; hours: number | string }>(sql, params);
    const summary = {
      people: new Set(items.map((r) => r.person_name)).size,
      hours: items.reduce((acc, r) => acc + Number(r.hours), 0),
      shifts: items.length
    };
    return { date: day, summary, items };
  });

  route("post", "/api/duty/shifts", "duty.write", async (request) => {
    const actor = requireUser(request);
    const hospitalId = requireHospital(request);
    const body = z.object({
      wardId: z.string().uuid().optional().nullable(),
      dutyDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      role: z.string().min(1).max(80),
      personName: z.string().min(1).max(120),
      employeeId: z.string().uuid().optional().nullable(),
      startsAt: z.string().datetime(),
      endsAt: z.string().datetime()
    }).parse(request.body);
    if (body.wardId) await mustOwn(db, "wards", body.wardId, hospitalId);
    if (body.employeeId) await mustOwn(db, "employees", body.employeeId, hospitalId);
    const start = new Date(body.startsAt);
    const end = new Date(body.endsAt);
    const hours = Math.max(0, (end.getTime() - start.getTime()) / 3_600_000);
    const id = newId();
    await db.query(
      `INSERT INTO duty_shifts (id, hospital_id, ward_id, duty_date, role, person_name, employee_id, starts_at, ends_at, hours, source)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'manual')`,
      [id, hospitalId, body.wardId ?? null, body.dutyDate, body.role, body.personName, body.employeeId ?? null, body.startsAt, body.endsAt, Math.round(hours * 100) / 100]
    );
    const minutes = Math.round(hours * 60);
    const monthKey = body.dutyDate.slice(0, 7);
    await db.query(
      `INSERT INTO timesheet_entries (id, hospital_id, employee_id, ward_id, person_name, work_date, minutes, kind, month_key)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'duty',$8)
       ON CONFLICT (hospital_id, person_name, work_date, kind, ward_id) DO UPDATE SET
         minutes = EXCLUDED.minutes, employee_id = COALESCE(EXCLUDED.employee_id, timesheet_entries.employee_id)`,
      [newId(), hospitalId, body.employeeId ?? null, body.wardId ?? null, body.personName, body.dutyDate, minutes, monthKey]
    );
    await db.tx((q) => writeAudit(q, {
      hospitalId, actorUserId: actor.id, action: "duty_create", entityType: "duty_shift", entityId: id,
      summary: `Gardă ${body.personName} ${body.dutyDate} (${hours}h).`
    }));
    return { id, hours };
  });

  route("get", "/api/timesheet", "duty.write", async (request) => {
    const hospitalId = requireHospital(request);
    const query = z.object({
      month: z.string().regex(/^\d{4}-\d{2}$/),
      wardId: z.string().uuid().optional()
    }).parse(request.query);
    const params: unknown[] = [hospitalId, query.month];
    let sql = `SELECT person_name, ward_id, kind, sum(minutes)::int AS minutes, bool_or(locked) AS locked
               FROM timesheet_entries WHERE hospital_id = $1 AND month_key = $2`;
    if (query.wardId) {
      params.push(query.wardId);
      sql += ` AND ward_id = $3`;
    }
    sql += " GROUP BY person_name, ward_id, kind ORDER BY person_name, kind";
    const rows = await db.query(sql, params);
    return { month: query.month, rows, note: "Pontajul se generează automat din gărzi." };
  });

  route("post", "/api/timesheet/close", "duty.write", async (request) => {
    const actor = requireUser(request);
    const hospitalId = requireHospital(request);
    const body = z.object({ month: z.string().regex(/^\d{4}-\d{2}$/), wardId: z.string().uuid().optional() }).parse(request.body);
    const params: unknown[] = [hospitalId, body.month];
    let sql = `UPDATE timesheet_entries SET locked = true WHERE hospital_id = $1 AND month_key = $2 AND locked = false`;
    if (body.wardId) {
      params.push(body.wardId);
      sql += ` AND ward_id = $3`;
    }
    sql += " RETURNING id";
    const updated = await db.query(sql, params);
    await db.tx((q) => writeAudit(q, {
      hospitalId, actorUserId: actor.id, action: "timesheet_close", entityType: "timesheet", entityId: hospitalId,
      summary: `Pontaj închis ${body.month} (${updated.length} rânduri).`
    }));
    return { month: body.month, locked: updated.length };
  });

  route("get", "/api/pharmacy/items", "structure.read", async (request) => {
    const hospitalId = requireHospital(request);
    const query = z.object({ wardId: z.string().uuid().optional() }).parse(request.query);
    const params: unknown[] = [hospitalId];
    let sql = `SELECT id, ward_id, sku, name, unit, quantity, min_quantity, group_name, updated_at
               FROM pharmacy_items WHERE hospital_id = $1`;
    if (query.wardId) {
      params.push(query.wardId);
      sql += ` AND (ward_id = $2 OR ward_id IS NULL)`;
    }
    sql += " ORDER BY name";
    return { items: await db.query(sql, params) };
  });

  route("post", "/api/pharmacy/items", "pharmacy.write", async (request) => {
    const hospitalId = requireHospital(request);
    const body = z.object({
      wardId: z.string().uuid().optional().nullable(),
      name: z.string().min(1).max(160),
      unit: z.string().min(1).max(20),
      quantity: z.number().nonnegative().default(0),
      minQuantity: z.number().nonnegative().default(0),
      sku: z.string().max(40).optional(),
      groupName: z.string().max(80).optional()
    }).parse(request.body);
    if (body.wardId) await mustOwn(db, "wards", body.wardId, hospitalId);
    const id = newId();
    await db.query(
      `INSERT INTO pharmacy_items (id, hospital_id, ward_id, sku, name, unit, quantity, min_quantity, group_name)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [id, hospitalId, body.wardId ?? null, body.sku ?? null, body.name, body.unit, body.quantity, body.minQuantity, body.groupName ?? null]
    );
    return { id };
  });

  route("post", "/api/pharmacy/move", "pharmacy.write", async (request) => {
    const actor = requireUser(request);
    const hospitalId = requireHospital(request);
    const body = z.object({
      itemId: z.string().uuid(),
      direction: z.enum(["in", "out", "adjust"]),
      quantity: z.number().positive(),
      reason: z.string().min(1).max(200),
      patientId: z.string().uuid().optional(),
      encounterId: z.string().uuid().optional()
    }).parse(request.body);
    return db.tx(async (q) => {
      const item = await one<{ id: string; quantity: number }>(q, "SELECT id, quantity FROM pharmacy_items WHERE id = $1 AND hospital_id = $2", [body.itemId, hospitalId]);
      let next = Number(item.quantity);
      if (body.direction === "in") next += body.quantity;
      else if (body.direction === "out") next -= body.quantity;
      else next = body.quantity;
      if (next < 0) fail(409, "Stoc insuficient.");
      await q.query("UPDATE pharmacy_items SET quantity = $3, updated_at = now() WHERE id = $1 AND hospital_id = $2", [body.itemId, hospitalId, next]);
      const id = newId();
      await q.query(
        `INSERT INTO pharmacy_movements (id, hospital_id, item_id, patient_id, encounter_id, direction, quantity, reason, actor_user_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [id, hospitalId, body.itemId, body.patientId ?? null, body.encounterId ?? null, body.direction, body.quantity, body.reason, actor.id]
      );
      return { id, quantity: next };
    });
  });

  route("get", "/api/lab/ward", "lab.read", async (request) => {
    const hospitalId = requireHospital(request);
    const query = z.object({ wardId: z.string().uuid().optional(), status: z.string().optional() }).parse(request.query);
    const params: unknown[] = [hospitalId];
    let sql = `SELECT sr.id, sr.code, sr.display, sr.status, sr.created_at, sr.patient_id, sr.encounter_id,
                      p.first_name, p.last_name, a.current_ward_id AS ward_id
               FROM service_requests sr
               JOIN patients p ON p.id = sr.patient_id
               LEFT JOIN admissions a ON a.encounter_id = sr.encounter_id AND a.status = 'active'
               WHERE sr.hospital_id = $1 AND sr.category = 'laboratory'`;
    if (query.wardId) {
      params.push(query.wardId);
      sql += ` AND a.current_ward_id = $${params.length}`;
    }
    if (query.status) {
      params.push(query.status);
      sql += ` AND sr.status = $${params.length}`;
    }
    sql += " ORDER BY sr.created_at DESC LIMIT 200";
    return { items: await db.query(sql, params) };
  });

  route("post", "/api/reports/ward/export", "report.ward", async (request, reply) => {
    const actor = requireUser(request);
    const hospitalId = requireHospital(request);
    const body = z.object({
      wardId: z.string().uuid().optional(),
      reportKey: z.enum(["census", "lab", "pharmacy", "duty", "timesheet"]).default("census"),
      format: z.enum(["json", "csv", "xlsx", "pdf", "doc", "html"]).default("xlsx"),
      month: z.string().regex(/^\d{4}-\d{2}$/).optional()
    }).parse(request.body ?? {});

    const rows = await buildReportRows(db, hospitalId, body.reportKey, body.wardId, body.month);
    const stamp = new Date().toISOString().slice(0, 10);
    const base = `${body.reportKey}-${stamp}`;
    let content: Buffer | string;
    let mediaType: string;
    let filename: string;
    const format = body.format as ExportFormat;

    if (format === "json") {
      content = JSON.stringify({ reportKey: body.reportKey, rows }, null, 2);
      mediaType = "application/json";
      filename = `${base}.json`;
    } else if (format === "csv") {
      content = toCsv(rows);
      mediaType = "text/csv; charset=utf-8";
      filename = `${base}.csv`;
    } else if (format === "xlsx") {
      content = await toXlsx(body.reportKey, rows);
      mediaType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
      filename = `${base}.xlsx`;
    } else if (format === "pdf") {
      content = toSimplePdf(`Raport ${body.reportKey}`, rows.map((r) => Object.values(r).join(" | ")));
      mediaType = "application/pdf";
      filename = `${base}.pdf`;
    } else if (format === "doc") {
      content = toHtmlDoc(`Raport ${body.reportKey}`, rows);
      mediaType = "application/msword";
      filename = `${base}.doc`;
    } else {
      content = toHtmlDoc(`Raport ${body.reportKey}`, rows);
      mediaType = "text/html; charset=utf-8";
      filename = `${base}.html`;
    }

    const artifact = await writeReportArtifact(db, dirs, {
      hospitalId,
      actorUserId: actor.id,
      reportKey: body.reportKey,
      format,
      filename,
      content,
      mediaType
    });

    if (format === "json" || format === "csv" || format === "html" || format === "doc") {
      reply.header("content-type", mediaType);
      reply.header("content-disposition", `attachment; filename="${filename}"`);
      reply.header("x-artifact-id", artifact.id);
      return reply.send(typeof content === "string" ? content : content);
    }
    reply.header("content-type", mediaType);
    reply.header("content-disposition", `attachment; filename="${filename}"`);
    reply.header("x-artifact-id", artifact.id);
    return reply.send(content);
  });

  route("get", "/api/reports/artifacts", "report.ward", async (request) => {
    const hospitalId = requireHospital(request);
    return db.query(
      `SELECT id, report_key, format, filename, path, media_type, created_at
       FROM report_artifacts WHERE hospital_id = $1 ORDER BY created_at DESC LIMIT 50`,
      [hospitalId]
    );
  });

  route("get", "/api/flows", "structure.read", async (request) => {
    const hospitalId = requireHospital(request);
    const existing = await db.query("SELECT id FROM flow_definitions WHERE hospital_id = $1 LIMIT 1", [hospitalId]);
    if (!existing.length) await seedFlows(db, hospitalId);
    const flows = await db.query(
      `SELECT id, code, title, kind, steps, active, updated_at FROM flow_definitions
       WHERE hospital_id = $1 AND active ORDER BY kind, title`,
      [hospitalId]
    );
    return { flows, diagram: buildFlowDiagram(flows as { code: string; title: string; kind: string; steps: unknown }[]) };
  });

  route("post", "/api/flows/seed", "flow.admin", async (request) => {
    const actor = requireUser(request);
    const hospitalId = requireHospital(request);
    const count = await seedFlows(db, hospitalId);
    await db.tx((q) => writeAudit(q, {
      hospitalId, actorUserId: actor.id, action: "flows_seed", entityType: "flow_definitions", entityId: hospitalId,
      summary: `Fluxuri seed (${count}).`
    }));
    return { count };
  });

  route("post", "/api/zena/admin", "zena.admin", async (request) => {
    const actor = requireUser(request);
    const hospitalId = requireHospital(request);
    const body = z.object({ message: z.string().min(1).max(2000) }).parse(request.body);
    return applyZenaAdminCommand(db, { hospitalId, actorUserId: actor.id, message: body.message });
  });

  route("post", "/api/zena/dictation", undefined, async (request) => {
    const actor = requireUser(request);
    const hospitalId = requireHospital(request);
    if (!actor.permissions.has("chart.write") && !actor.permissions.has("zena.admin") && !actor.permissions.has("zena.configure")) {
      fail(403, "Dictarea necesită drepturi pe foaie sau Zena.");
    }
    const body = dictationBody.parse(request.body);
    const { normalized, lang } = await normalizeDictation(body.text, body.lang);
    const id = newId();
    await db.query(
      `INSERT INTO dictation_logs (id, hospital_id, actor_user_id, lang, source_text, normalized_text, target)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [id, hospitalId, actor.id, lang, body.text, normalized, body.target ?? null]
    );
    return { id, lang, text: normalized, faithful: true };
  });

  route("post", "/api/patients/:id/archive-file", "patient.write", async (request) => {
    const actor = requireUser(request);
    const hospitalId = requireHospital(request);
    const id = param(request, "id");
    await mustOwn(db, "patients", id, hospitalId);
    const patient = await one<Record<string, unknown>>(db, "SELECT * FROM patients WHERE id = $1 AND hospital_id = $2", [id, hospitalId]);
    const identifiers = await db.query("SELECT system, value FROM patient_identifiers WHERE patient_id = $1 AND hospital_id = $2", [id, hospitalId]);
    const encounters = await db.query("SELECT id, class, status, started_at, ended_at FROM encounters WHERE patient_id = $1 AND hospital_id = $2 ORDER BY started_at", [id, hospitalId]);
    const folder = join(dirs.patients, id);
    await mkdir(folder, { recursive: true });
    const path = join(folder, `dossier-${Date.now()}.json`);
    const payload = {
      savedAt: new Date().toISOString(),
      hospitalId,
      patient,
      identifiers,
      encounters,
      sourceOfTruth: "database + disk mirror"
    };
    await writeFile(path, JSON.stringify(payload, null, 2), "utf8");
    await db.tx((q) => writeAudit(q, {
      hospitalId, actorUserId: actor.id, action: "patient_archive", entityType: "patient", entityId: id,
      summary: "Dosar pacient salvat pe disc."
    }));
    return { path, patientId: id };
  });
}

async function buildReportRows(
  db: Db,
  hospitalId: string,
  reportKey: string,
  wardId?: string,
  month?: string
): Promise<Record<string, unknown>[]> {
  if (reportKey === "census") {
    const params: unknown[] = [hospitalId];
    let sql = `SELECT w.name AS sectie, count(b.id)::int AS paturi, count(a.id)::int AS ocupate,
                      (count(b.id) - count(a.id))::int AS libere
               FROM wards w
               LEFT JOIN rooms r ON r.ward_id = w.id
               LEFT JOIN beds b ON b.room_id = r.id AND b.status = 'open'
               LEFT JOIN admissions a ON a.bed_id = b.id AND a.status = 'active'
               WHERE w.hospital_id = $1`;
    if (wardId) {
      params.push(wardId);
      sql += ` AND w.id = $2`;
    }
    sql += " GROUP BY w.name ORDER BY w.name";
    return db.query(sql, params);
  }
  if (reportKey === "lab") {
    const params: unknown[] = [hospitalId];
    let sql = `SELECT sr.display AS analiza, sr.status, p.last_name || ' ' || p.first_name AS pacient, sr.created_at
               FROM service_requests sr JOIN patients p ON p.id = sr.patient_id
               LEFT JOIN admissions a ON a.encounter_id = sr.encounter_id
               WHERE sr.hospital_id = $1 AND sr.category = 'laboratory'`;
    if (wardId) {
      params.push(wardId);
      sql += ` AND a.current_ward_id = $2`;
    }
    sql += " ORDER BY sr.created_at DESC LIMIT 500";
    return db.query(sql, params);
  }
  if (reportKey === "pharmacy") {
    const params: unknown[] = [hospitalId];
    let sql = `SELECT name, unit, quantity, min_quantity, group_name FROM pharmacy_items WHERE hospital_id = $1`;
    if (wardId) {
      params.push(wardId);
      sql += ` AND (ward_id = $2 OR ward_id IS NULL)`;
    }
    sql += " ORDER BY name";
    return db.query(sql, params);
  }
  if (reportKey === "duty") {
    const params: unknown[] = [hospitalId];
    let sql = `SELECT duty_date, role, person_name, hours, ward_id FROM duty_shifts WHERE hospital_id = $1`;
    if (wardId) {
      params.push(wardId);
      sql += ` AND ward_id = $2`;
    }
    sql += " ORDER BY duty_date DESC, person_name LIMIT 500";
    return db.query(sql, params);
  }
  const monthKey = month ?? new Date().toISOString().slice(0, 7);
  const params: unknown[] = [hospitalId, monthKey];
  let sql = `SELECT person_name, work_date, minutes, kind, locked FROM timesheet_entries WHERE hospital_id = $1 AND month_key = $2`;
  if (wardId) {
    params.push(wardId);
    sql += ` AND ward_id = $3`;
  }
  sql += " ORDER BY person_name, work_date";
  return db.query(sql, params);
}

function buildFlowDiagram(flows: { code: string; title: string; kind: string; steps: unknown }[]) {
  return flows.map((flow) => {
    const steps = Array.isArray(flow.steps) ? flow.steps as { id: string; title: string; system?: string; next?: string[] }[] : [];
    return {
      code: flow.code,
      title: flow.title,
      kind: flow.kind as string,
      nodes: steps.map((s, i) => ({ id: s.id, label: s.title, system: s.system, x: 40 + (i % 4) * 180, y: 40 + Math.floor(i / 4) * 100 })),
      edges: steps.flatMap((s) => (s.next || []).map((to) => ({ from: s.id, to })))
    };
  });
}
