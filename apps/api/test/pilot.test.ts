import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp, type AppConfig } from "../src/app.js";
import { openPglite, type Db } from "../src/db.js";
import { migrate } from "../src/migrate.js";
import { ensureAppDirs, resolveAppDirs } from "../src/paths.js";

let dir = "";
let db: Db;
let app: FastifyInstance;
let cookie = "";
let hospitalId = "";
let wardId = "";

const aiKey = randomBytes(32);

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "zenaios-pilot-"));
  const dirs = await ensureAppDirs(resolveAppDirs({ ...process.env, ZENAIOS_ROOT: dir, BACKUP_DIR: join(dir, "backups") }));
  db = await openPglite(join(dir, "pg"));
  await migrate(db);
  const config: AppConfig = {
    aiDataKey: aiKey,
    provisionToken: "",
    cookieSecure: false,
    logs: [],
    openAccess: true,
    dirs
  };
  app = await buildApp(db, config);
  const open = await app.inject({ method: "POST", url: "/api/auth/open" });
  expect(open.statusCode).toBe(200);
  cookie = String(open.headers["set-cookie"]).split(";")[0]!;
  hospitalId = (open.json() as { hospitalId: string }).hospitalId;
  const structure = await app.inject({ method: "GET", url: "/api/structure", headers: { cookie } });
  wardId = (structure.json() as { wards: { id: string }[] }).wards[0]!.id;
});

afterAll(async () => {
  await app.close();
  await db.close();
  await rm(dir, { recursive: true, force: true });
});

describe("pilot județean", () => {
  it("census, integrări, gărzi/pontaj, farmacie, fluxuri, zena admin, dictare, export", async () => {
    const census = await app.inject({ method: "GET", url: "/api/census", headers: { cookie } });
    expect(census.statusCode).toBe(200);
    expect((census.json() as { sourceOfTruth: string }).sourceOfTruth).toBe("clinical.admissions");

    const integ = await app.inject({ method: "GET", url: "/api/integrations/endpoints", headers: { cookie } });
    expect(integ.statusCode).toBe(200);
    const codes = (integ.json() as { code: string; mode: string }[]).map((r) => r.code);
    expect(codes).toContain("lis");
    expect(codes).toContain("siui");

    const lisTest = await app.inject({
      method: "POST",
      url: "/api/integrations/endpoints/lis/test",
      headers: { cookie },
      payload: {}
    });
    expect(lisTest.statusCode).toBe(200);
    expect((lisTest.json() as { ok: boolean }).ok).toBe(true);

    const day = new Date().toISOString().slice(0, 10);
    const duty = await app.inject({
      method: "POST",
      url: "/api/duty/shifts",
      headers: { cookie },
      payload: {
        wardId,
        dutyDate: day,
        role: "medic",
        personName: "Dr. Pilot",
        startsAt: `${day}T08:00:00.000Z`,
        endsAt: `${day}T20:00:00.000Z`
      }
    });
    expect(duty.statusCode).toBe(200);

    const today = await app.inject({ method: "GET", url: `/api/duty/today?wardId=${wardId}`, headers: { cookie } });
    expect((today.json() as { summary: { people: number } }).summary.people).toBeGreaterThanOrEqual(1);

    const month = day.slice(0, 7);
    const sheet = await app.inject({ method: "GET", url: `/api/timesheet?month=${month}&wardId=${wardId}`, headers: { cookie } });
    expect(sheet.statusCode).toBe(200);
    expect((sheet.json() as { rows: unknown[] }).rows.length).toBeGreaterThanOrEqual(1);

    const ph = await app.inject({
      method: "POST",
      url: "/api/pharmacy/items",
      headers: { cookie },
      payload: { wardId, name: "Paracetamol 500", unit: "buc", quantity: 50, minQuantity: 10 }
    });
    expect(ph.statusCode).toBe(200);

    const zena = await app.inject({
      method: "POST",
      url: "/api/zena/converse",
      headers: { cookie },
      payload: { mode: "admin", message: "setează LIS pe simulator" }
    });
    expect(zena.statusCode).toBe(200);
    expect((zena.json() as { action: string }).action).toBe("integration.mode");

    const dict = await app.inject({
      method: "POST",
      url: "/api/zena/dictation",
      headers: { cookie },
      payload: { text: "pacientul prezinta febra", lang: "ro-RO" }
    });
    expect(dict.statusCode).toBe(200);
    expect((dict.json() as { text: string }).text.toLowerCase()).toContain("febr");

    const flows = await app.inject({ method: "GET", url: "/api/flows", headers: { cookie } });
    expect(flows.statusCode).toBe(200);
    const body = flows.json() as { flows: unknown[]; diagram: unknown[] };
    expect(body.flows.length).toBeGreaterThanOrEqual(5);
    expect(body.diagram.length).toBeGreaterThanOrEqual(5);

    const exportRes = await app.inject({
      method: "POST",
      url: "/api/reports/ward/export",
      headers: { cookie },
      payload: { wardId, reportKey: "census", format: "csv" }
    });
    expect(exportRes.statusCode).toBe(200);
    expect(String(exportRes.headers["content-type"])).toContain("text/csv");

    const upu = await app.inject({
      method: "POST",
      url: "/api/upu/presentations",
      headers: { cookie },
      payload: {
        unidentified: true,
        triageCode: "galben",
        location: "Box 2",
        firstName: "Necunoscut",
        lastName: "UPU"
      }
    });
    expect(upu.statusCode).toBe(200);
    expect((upu.json() as { upuId: string }).upuId).toBeTruthy();

    const board = await app.inject({ method: "GET", url: "/api/upu/board", headers: { cookie } });
    expect((board.json() as { items: unknown[] }).items.length).toBeGreaterThanOrEqual(1);

    void hospitalId;
  });
});
