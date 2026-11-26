import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp, type AppConfig } from "../src/app.js";
import { openPglite, type Db } from "../src/db.js";
import { migrate } from "../src/migrate.js";
import { buildSiuMessage, parseSiuControlId } from "../src/hl7-siu.js";

let dir = "";
let db: Db;
let app: FastifyInstance;
let cookie = "";
let wardId = "";
let physicianId = "";

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "zenaios-appt-"));
  db = await openPglite(dir);
  await migrate(db);
  const config: AppConfig = {
    aiDataKey: randomBytes(32),
    provisionToken: "",
    cookieSecure: false,
    logs: [],
    openAccess: true
  };
  app = await buildApp(db, config);
  const open = await app.inject({ method: "POST", url: "/api/auth/open", payload: {} });
  cookie = String(open.headers["set-cookie"]).split(";")[0]!;

  const building = await app.inject({ method: "POST", url: "/api/buildings", headers: { cookie }, payload: { name: "A" } });
  const dept = await app.inject({
    method: "POST", url: "/api/departments", headers: { cookie },
    payload: { buildingId: (building.json() as { id: string }).id, name: "Clinic", kind: "clinical" }
  });
  const ward = await app.inject({
    method: "POST", url: "/api/wards", headers: { cookie },
    payload: { departmentId: (dept.json() as { id: string }).id, name: "Cardiologie", specialty: "Cardiologie" }
  });
  wardId = (ward.json() as { id: string }).id;

  const phy = await app.inject({
    method: "POST", url: "/api/users", headers: { cookie },
    payload: { username: "cardio.doc", displayName: "Dr. Calendar", roleCode: "physician" }
  });
  physicianId = (phy.json() as { id: string }).id;
  await app.inject({
    method: "PUT", url: `/api/users/${physicianId}/ward-scopes`, headers: { cookie },
    payload: { wardIds: [wardId] }
  });
}, 60_000);

afterAll(async () => {
  await app.close();
  await db.close();
  await rm(dir, { recursive: true, force: true });
});

describe("programări ambulatoriu HL7 SIU", () => {
  it("construiește SIU^S12 valid și rezervă calendarul medicului", () => {
    const hl7 = buildSiuMessage("S12", {
      controlId: "CTRL1",
      hospitalName: "Spital Test",
      placerId: "APT-1",
      startsAt: new Date("2026-12-01T09:00:00.000Z"),
      endsAt: new Date("2026-12-01T09:30:00.000Z"),
      durationMinutes: 30,
      status: "booked",
      specialty: "Cardiologie",
      location: "Ambulatoriu",
      patientLastName: "Ionescu",
      patientFirstName: "Maria",
      patientCnp: "2800402123456",
      practitionerUserId: "00000000-0000-0000-0000-000000000001",
      practitionerName: "Dr. Test",
      wardName: "Cardiologie"
    });
    expect(hl7).toContain("MSH|");
    expect(hl7).toContain("SIU^S12^SIU_S12");
    expect(hl7).toContain("SCH|");
    expect(hl7).toContain("PID|");
    expect(hl7).toContain("AIP|");
    expect(parseSiuControlId(hl7)).toBe("CTRL1");
  });

  it("creează schedule + programare, generează HL7, blochează overlap, anulează cu S15", async () => {
    const schedule = await app.inject({
      method: "POST", url: "/api/appointments/schedules", headers: { cookie },
      payload: { practitionerUserId: physicianId, wardId, specialty: "Cardiologie", location: "Ambulatoriu Cardio" }
    });
    expect(schedule.statusCode).toBe(200);

    const startsAt = "2026-12-02T10:00:00.000Z";
    const created = await app.inject({
      method: "POST", url: "/api/appointments", headers: { cookie },
      payload: {
        practitionerUserId: physicianId,
        wardId,
        patientFirstName: "Elena",
        patientLastName: "Popa",
        patientCnp: "2850101123456",
        specialty: "Cardiologie",
        reason: "Control",
        startsAt,
        durationMinutes: 30
      }
    });
    expect(created.statusCode).toBe(200);
    const appt = created.json() as { id: string; siu: string };
    expect(appt.siu).toBe("S12");

    const overlap = await app.inject({
      method: "POST", url: "/api/appointments", headers: { cookie },
      payload: {
        practitionerUserId: physicianId,
        wardId,
        patientFirstName: "Ion",
        patientLastName: "Radu",
        specialty: "Cardiologie",
        startsAt: "2026-12-02T10:15:00.000Z",
        durationMinutes: 30
      }
    });
    expect(overlap.statusCode).toBe(409);

    const list = await app.inject({
      method: "GET",
      url: `/api/appointments?from=2026-12-02T00:00:00.000Z&to=2026-12-03T00:00:00.000Z&wardId=${wardId}`,
      headers: { cookie }
    });
    expect(list.statusCode).toBe(200);
    expect((list.json() as { items: unknown[] }).items.length).toBeGreaterThanOrEqual(1);

    const hl7 = await app.inject({ method: "GET", url: `/api/appointments/${appt.id}/hl7`, headers: { cookie } });
    expect(hl7.statusCode).toBe(200);
    const msg = (hl7.json() as { items: { hl7: string; trigger_event: string }[] }).items[0];
    expect(msg?.trigger_event).toBe("S12");
    expect(msg?.hl7).toContain("SIU^S12");

    const cancel = await app.inject({
      method: "POST", url: `/api/appointments/${appt.id}/status`, headers: { cookie },
      payload: { status: "cancelled" }
    });
    expect(cancel.statusCode).toBe(200);
    expect((cancel.json() as { siu: string }).siu).toBe("S15");

    const stats = await app.inject({
      method: "GET",
      url: "/api/appointments/stats?from=2026-12-01T00:00:00.000Z&to=2026-12-10T00:00:00.000Z",
      headers: { cookie }
    });
    expect(stats.statusCode).toBe(200);
    expect((stats.json() as { total: number }).total).toBeGreaterThanOrEqual(1);
  });
});
