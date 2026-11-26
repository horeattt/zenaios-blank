import ExcelJS from "exceljs";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { newId, writeAudit } from "./audit.js";
import type { Db } from "./db.js";

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

export type ModuleConfigDeps = {
  db: Db;
  route: RouteFn;
  requireUser: (request: FastifyRequest) => SessionUser;
  requireHospital: (request: FastifyRequest) => string;
  one: <T>(q: { query: Db["query"] }, text: string, params: unknown[]) => Promise<T>;
  fail: (status: number, message: string) => never;
  param: (request: FastifyRequest, name: string) => string;
};

export type FieldDef = {
  key: string;
  label: string;
  type: "text" | "number" | "date" | "select";
  required: boolean;
  enabled: boolean;
  options?: string[];
  catalog?: boolean;
};

const fieldSchema = z.object({
  key: z.string().min(1).max(64),
  label: z.string().min(1).max(120),
  type: z.enum(["text", "number", "date", "select"]),
  required: z.boolean(),
  enabled: z.boolean(),
  options: z.array(z.string()).optional(),
  catalog: z.boolean().optional()
});

function f(key: string, label: string, type: FieldDef["type"] = "text", required = false, extra: Partial<FieldDef> = {}): FieldDef {
  return { key, label, type, required, enabled: true, catalog: true, ...extra };
}

/** Catalog preset pe tip de modul — spitalul activează/redenumește, nu inventează tipuri periculoase. */
export const MODULE_PRESETS: Record<string, { kind: "dept" | "gest" | "people" | "ward"; label: string; fields: FieldDef[] }> = {
  "dept:it": {
    kind: "dept", label: "IT",
    fields: [f("asset", "Echipament / sistem", "text", true), f("owner", "Responsabil"), f("status", "Status", "select", true, { options: ["activ", "mentenanță", "retras"] }), f("notes", "Note")]
  },
  "dept:spiaam": {
    kind: "dept", label: "SPIAAM",
    fields: [
      f("event_date", "Data eveniment", "date", true),
      f("event_type", "Tip IAAM", "select", true, { options: ["ISO", "pneumonie", "ITU", "bacteriemie", "altul"] }),
      f("organism", "Microorganism"),
      f("location", "Localizare / salon"),
      f("measures", "Măsuri"),
      f("reported_by", "Raportat de", "text", true)
    ]
  },
  "dept:calitate": {
    kind: "dept", label: "Managementul calității",
    fields: [f("proc_code", "Cod procedură", "text", true), f("title", "Titlu", "text", true), f("status", "Status", "select", true, { options: ["draft", "aprobat", "revizie"] }), f("due_date", "Termen", "date"), f("owner", "Responsabil")]
  },
  "dept:hr": {
    kind: "dept", label: "Resurse umane",
    fields: [f("employee", "Angajat", "text", true), f("role", "Funcție", "text", true), f("contract", "Contract"), f("ward", "Secție"), f("start_date", "Data începerii", "date"), f("status", "Status", "select", false, { options: ["activ", "concediu", "încheiat"] })]
  },
  "dept:financiar": {
    kind: "dept", label: "Financiar-contabilitate",
    fields: [f("period", "Lună", "text", true), f("cost_center", "Centru de cost", "text", true), f("article", "Articol buget"), f("amount", "Sumă", "number", true), f("kind", "Tip", "select", true, { options: ["cost", "venit"] }), f("note", "Notă")]
  },
  "dept:achizitii": {
    kind: "dept", label: "Achiziții publice",
    fields: [f("procedure", "Procedură", "text", true), f("cpv", "CPV"), f("value", "Valoare estimată", "number"), f("status", "Status", "select", true, { options: ["planificat", "derulare", "atribuit", "anulat"] }), f("supplier", "Furnizor")]
  },
  "dept:statistica": {
    kind: "dept", label: "Statistică medicală",
    fields: [f("period", "Perioadă", "text", true), f("ward", "Secție"), f("drg", "DRG"), f("icm", "ICM", "number"), f("cases", "Cazuri", "number"), f("note", "Observații")]
  },
  "dept:farmacie": {
    kind: "dept", label: "Farmacie",
    fields: [f("cim", "COD CIM"), f("name", "Denumire", "text", true), f("lot", "Lot"), f("expiry", "Expirare", "date"), f("qty", "Cantitate", "number", true), f("unit", "UM"), f("min_stock", "Stoc minim", "number")]
  },
  "dept:laborator": {
    kind: "dept", label: "Laborator",
    fields: [f("test_code", "Cod analiză", "text", true), f("test_name", "Denumire", "text", true), f("sample", "Probă"), f("tat_hours", "TAT (ore)", "number"), f("active", "Activ", "select", false, { options: ["da", "nu"] })]
  },
  "dept:imagistica": {
    kind: "dept", label: "Imagistică",
    fields: [f("modality", "Modalitate", "select", true, { options: ["RX", "CT", "RMN", "ECO"] }), f("exam", "Examinare", "text", true), f("room", "Sală"), f("duration_min", "Durată (min)", "number")]
  },
  "dept:bloc": {
    kind: "dept", label: "Bloc operator",
    fields: [f("sala", "Sală", "text", true), f("specialty", "Specialitate"), f("slot", "Interval"), f("status", "Status", "select", false, { options: ["liber", "ocupat", "mentenanță"] })]
  },
  "dept:upu": {
    kind: "dept", label: "UPU",
    fields: [f("triage", "Triaaj", "select", true, { options: ["roșu", "galben", "verde"] }), f("chief_complaint", "Motiv prezentare", "text", true), f("disposition", "Dispoziție", "select", false, { options: ["internare", "externare", "transfer"] }), f("note", "Notă")]
  },
  "dept:sterilizare": {
    kind: "dept", label: "Sterilizare",
    fields: [f("cycle_id", "Ciclu", "text", true), f("load", "Încărcătură"), f("result", "Rezultat", "select", true, { options: ["conform", "neconform"] }), f("operator", "Operator"), f("date", "Data", "date", true)]
  },
  "dept:administrativ": {
    kind: "dept", label: "Administrativ",
    fields: [f("asset", "Obiect / spațiu", "text", true), f("category", "Categorie", "select", false, { options: ["clădire", "utilitate", "pază", "altul"] }), f("status", "Status"), f("vendor", "Furnizor"), f("note", "Notă")]
  },
  "gest:materiale": {
    kind: "gest", label: "Materiale",
    fields: [f("name", "Denumire", "text", true), f("qty", "Cantitate", "number", true), f("unit", "UM"), f("min", "Minim", "number"), f("ward", "Secție")]
  },
  "gest:medicamente": {
    kind: "gest", label: "Medicamente",
    fields: [f("name", "Denumire", "text", true), f("dose", "Dozaj"), f("group", "Grup"), f("qty", "Stoc", "number", true), f("unit", "UM"), f("min", "Minim", "number")]
  },
  "gest:lenjerie": {
    kind: "gest", label: "Lenjerie",
    fields: [f("name", "Denumire", "text", true), f("qty", "Cantitate", "number", true), f("unit", "UM"), f("min", "Minim", "number")]
  },
  "gest:dezinfectanti": {
    kind: "gest", label: "Dezinfectanți",
    fields: [f("name", "Denumire", "text", true), f("qty", "Cantitate", "number", true), f("unit", "UM"), f("min", "Minim", "number")]
  },
  "people:medici": {
    kind: "people", label: "Medici",
    fields: [f("last", "Nume", "text", true), f("first", "Prenume", "text", true), f("specialty", "Specialitate"), f("ward", "Secție"), f("phone", "Telefon"), f("mail", "Email")]
  },
  "people:asistenti": {
    kind: "people", label: "Asistenți",
    fields: [f("last", "Nume", "text", true), f("first", "Prenume", "text", true), f("ward", "Secție"), f("shift", "Tură"), f("phone", "Telefon")]
  }
};

export function resolvePreset(moduleKey: string): { kind: "dept" | "gest" | "people" | "ward"; label: string; fields: FieldDef[] } | null {
  if (MODULE_PRESETS[moduleKey]) return MODULE_PRESETS[moduleKey];
  const [kind, rest] = moduleKey.split(":");
  if (kind === "dept" && rest) {
    return {
      kind: "dept",
      label: rest,
      fields: [f("name", "Denumire", "text", true), f("value", "Valoare"), f("note", "Notă"), f("date", "Data", "date")]
    };
  }
  if (kind === "gest" && rest) {
    return { kind: "gest", label: rest, fields: MODULE_PRESETS["gest:materiale"].fields };
  }
  if (kind === "people" && rest) {
    return { kind: "people", label: rest, fields: MODULE_PRESETS["people:medici"].fields };
  }
  return null;
}

export function deptCodeFromName(name: string): string {
  const n = name.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "");
  if (n.includes("spiaam")) return "spiaam";
  if (n.includes("calitat")) return "calitate";
  if (n.includes("resurse") || n === "hr") return "hr";
  if (n.includes("financiar") || n.includes("contabil")) return "financiar";
  if (n.includes("achizit")) return "achizitii";
  if (n.includes("statistic")) return "statistica";
  if (n.includes("farmac")) return "farmacie";
  if (n.includes("laborat")) return "laborator";
  if (n.includes("imagist")) return "imagistica";
  if (n.includes("bloc")) return "bloc";
  if (n.includes("upu") || n.includes("urgent")) return "upu";
  if (n.includes("steriliz")) return "sterilizare";
  if (n.includes("administrativ")) return "administrativ";
  if (n === "it" || n.startsWith("it ")) return "it";
  return n.replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "modul";
}

async function ensureModule(db: Db, hospitalId: string, moduleKey: string) {
  const existing = await db.query<{
    id: string; module_key: string; kind: string; label: string; enabled: boolean;
    fields: FieldDef[]; import_mode: string; import_config: Record<string, unknown>; updated_at: string;
  }>(
    `SELECT id, module_key, kind, label, enabled, fields, import_mode, import_config, updated_at
     FROM hospital_modules WHERE hospital_id = $1 AND module_key = $2`,
    [hospitalId, moduleKey]
  );
  if (existing[0]) {
    const row = existing[0];
    return {
      id: row.id,
      moduleKey: row.module_key,
      kind: row.kind,
      label: row.label,
      enabled: row.enabled,
      fields: row.fields,
      importMode: row.import_mode,
      importConfig: row.import_config,
      updatedAt: row.updated_at
    };
  }
  const preset = resolvePreset(moduleKey);
  if (!preset) return null;
  const id = newId();
  await db.query(
    `INSERT INTO hospital_modules (id, hospital_id, module_key, kind, label, fields, import_mode)
     VALUES ($1,$2,$3,$4,$5,$6::jsonb,'excel_template')`,
    [id, hospitalId, moduleKey, preset.kind, preset.label, JSON.stringify(preset.fields)]
  );
  return {
    id,
    moduleKey,
    kind: preset.kind,
    label: preset.label,
    enabled: true,
    fields: preset.fields,
    importMode: "excel_template",
    importConfig: {},
    updatedAt: new Date().toISOString()
  };
}

function activeFields(fields: FieldDef[]): FieldDef[] {
  return (fields || []).filter((x) => x.enabled !== false);
}

function validateRow(fields: FieldDef[], row: Record<string, unknown>, index: number) {
  const errors: string[] = [];
  const data: Record<string, unknown> = {};
  for (const field of fields) {
    const raw = row[field.key] ?? row[field.label];
    const value = raw == null ? "" : String(raw).trim();
    if (field.required && !value) errors.push(`Rând ${index + 1}: lipsește „${field.label}”.`);
    if (field.type === "number" && value && Number.isNaN(Number(value.replace(",", ".")))) {
      errors.push(`Rând ${index + 1}: „${field.label}” trebuie să fie număr.`);
    }
    if (field.type === "select" && value && field.options?.length && !field.options.includes(value)) {
      errors.push(`Rând ${index + 1}: „${field.label}” nu e în listă (${field.options.join(", ")}).`);
    }
    data[field.key] = field.type === "number" && value ? Number(value.replace(",", ".")) : value;
  }
  return { ok: errors.length === 0, errors, data };
}

export async function registerModuleConfigRoutes(_app: FastifyInstance, deps: ModuleConfigDeps): Promise<void> {
  const { db, route, requireUser, requireHospital, fail, param } = deps;

  route("get", "/api/modules/catalog", "module.read", async () => ({
    presets: Object.entries(MODULE_PRESETS).map(([key, p]) => ({
      moduleKey: key,
      kind: p.kind,
      label: p.label,
      fieldCount: p.fields.length
    }))
  }));

  route("get", "/api/modules", "module.read", async (request) => {
    const hospitalId = requireHospital(request);
    const rows = await db.query<{
      id: string; module_key: string; kind: string; label: string; enabled: boolean;
      import_mode: string; updated_at: string;
    }>(
      `SELECT id, module_key, kind, label, enabled, import_mode, updated_at
       FROM hospital_modules WHERE hospital_id = $1 ORDER BY kind, label`,
      [hospitalId]
    );
    return {
      items: rows.map((r) => ({
        id: r.id,
        moduleKey: r.module_key,
        kind: r.kind,
        label: r.label,
        enabled: r.enabled,
        importMode: r.import_mode,
        updatedAt: r.updated_at
      }))
    };
  });

  route("get", "/api/modules/:key", "module.read", async (request) => {
    const hospitalId = requireHospital(request);
    const key = decodeURIComponent(param(request, "key"));
    const mod = await ensureModule(db, hospitalId, key);
    if (!mod) fail(404, "Modul necunoscut.");
    const m = mod!;
    const count = await db.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM hospital_module_records WHERE module_id = $1",
      [m.id]
    );
    return { ...mod, recordCount: count[0]?.n ?? 0, catalog: resolvePreset(key)?.fields || [] };
  });

  route("put", "/api/modules/:key", "module.write", async (request) => {
    const actor = requireUser(request);
    const hospitalId = requireHospital(request);
    const key = decodeURIComponent(param(request, "key"));
    const body = z.object({
      label: z.string().min(1).max(120).optional(),
      enabled: z.boolean().optional(),
      fields: z.array(fieldSchema).min(1).max(40).optional(),
      importMode: z.enum(["excel_template", "csv_map", "manual", "api", "hl7"]).optional(),
      importConfig: z.record(z.unknown()).optional()
    }).parse(request.body);
    const mod = await ensureModule(db, hospitalId, key);
    if (!mod) fail(404, "Modul necunoscut.");
    const m = mod!;
    const fields = body.fields ?? m.fields;
    const label = body.label ?? m.label;
    const enabled = body.enabled ?? m.enabled;
    const importMode = body.importMode ?? m.importMode;
    const importConfig = body.importConfig ?? m.importConfig;
    await db.query(
      `UPDATE hospital_modules
       SET label = $2, enabled = $3, fields = $4::jsonb, import_mode = $5,
           import_config = $6::jsonb, updated_at = now()
       WHERE id = $1 AND hospital_id = $7`,
      [m.id, label, enabled, JSON.stringify(fields), importMode, JSON.stringify(importConfig), hospitalId]
    );
    await writeAudit(db, {
      hospitalId,
      actorUserId: actor.id,
      action: "module_config_update",
      entityType: "hospital_module",
      entityId: m.id,
      summary: `Configurare modul ${key}: ${importMode}, ${fields.filter((x) => x.enabled).length} câmpuri active`
    });
    return { ok: true, moduleKey: key, importMode, fieldCount: fields.filter((x) => x.enabled).length };
  });

  route("get", "/api/modules/:key/template.xlsx", "module.read", async (request, reply) => {
    const hospitalId = requireHospital(request);
    const key = decodeURIComponent(param(request, "key"));
    const mod = await ensureModule(db, hospitalId, key);
    if (!mod) fail(404, "Modul necunoscut.");
    const m = mod!;
    const fields = activeFields(m.fields as FieldDef[]);
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet(m.label.slice(0, 28) || "Import");
    sheet.addRow(fields.map((x) => x.key));
    sheet.addRow(fields.map((x) => x.label));
    sheet.getRow(1).font = { bold: true, color: { argb: "FF5B7CFF" } };
    sheet.getRow(2).font = { italic: true };
    sheet.addRow(fields.map((x) => (x.type === "select" && x.options?.[0]) || (x.type === "number" ? 0 : "")));
    fields.forEach((_, i) => { sheet.getColumn(i + 1).width = 18; });
    const buf = Buffer.from(await workbook.xlsx.writeBuffer());
    reply.header("content-type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    reply.header("content-disposition", `attachment; filename="zenaios-${key.replace(":", "-")}-sablon.xlsx"`);
    return reply.send(buf);
  });

  route("post", "/api/modules/:key/preview-import", "module.write", async (request) => {
    const hospitalId = requireHospital(request);
    const key = decodeURIComponent(param(request, "key"));
    const body = z.object({
      rows: z.array(z.record(z.unknown())).min(1).max(500)
    }).parse(request.body);
    const mod = await ensureModule(db, hospitalId, key);
    if (!mod) fail(404, "Modul necunoscut.");
    const m = mod!;
    const fields = activeFields(m.fields as FieldDef[]);
    const preview = body.rows.slice(0, 10).map((row, i) => validateRow(fields, row, i));
    const allErrors = preview.flatMap((p) => p.errors);
    return {
      ok: allErrors.length === 0,
      preview,
      errorCount: allErrors.length,
      sampleErrors: allErrors.slice(0, 12),
      importMode: m.importMode,
      note: allErrors.length ? "Corectați erorile înainte de Aplică." : "Validare OK — puteți aplica importul."
    };
  });

  route("post", "/api/modules/:key/apply-import", "module.write", async (request) => {
    const actor = requireUser(request);
    const hospitalId = requireHospital(request);
    const key = decodeURIComponent(param(request, "key"));
    const body = z.object({
      rows: z.array(z.record(z.unknown())).min(1).max(500),
      source: z.string().max(40).default("excel")
    }).parse(request.body);
    const mod = await ensureModule(db, hospitalId, key);
    if (!mod) fail(404, "Modul necunoscut.");
    const m = mod!;
    const fields = activeFields(m.fields as FieldDef[]);
    const validated = body.rows.map((row, i) => validateRow(fields, row, i));
    const errors = validated.flatMap((v) => v.errors);
    if (errors.length) fail(400, errors.slice(0, 8).join(" "));
    let inserted = 0;
    await db.tx(async (q) => {
      for (const row of validated) {
        await q.query(
          `INSERT INTO hospital_module_records (id, hospital_id, module_id, data, source)
           VALUES ($1,$2,$3,$4::jsonb,$5)`,
          [newId(), hospitalId, m.id, JSON.stringify(row.data), body.source]
        );
        inserted += 1;
      }
      await writeAudit(q, {
        hospitalId,
        actorUserId: actor.id,
        action: "module_import_apply",
        entityType: "hospital_module",
        entityId: m.id,
        summary: `Import ${inserted} rânduri pe ${key} (${body.source})`
      });
    });
    return { ok: true, inserted, moduleKey: key };
  });

  route("get", "/api/modules/:key/records", "module.read", async (request) => {
    const hospitalId = requireHospital(request);
    const key = decodeURIComponent(param(request, "key"));
    const mod = await ensureModule(db, hospitalId, key);
    if (!mod) fail(404, "Modul necunoscut.");
    const m = mod!;
    const rows = await db.query<{ id: string; data: Record<string, unknown>; source: string; created_at: string }>(
      `SELECT id, data, source, created_at FROM hospital_module_records
       WHERE module_id = $1 ORDER BY created_at DESC LIMIT 100`,
      [m.id]
    );
    return { items: rows.map((r) => ({ id: r.id, data: r.data, source: r.source, createdAt: r.created_at })) };
  });
}
