import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { buildApp, type AppConfig } from "../src/app.js";
import { newId } from "../src/audit.js";
import { seedLargeStructure } from "../src/board.js";
import { openPglite, type Db } from "../src/db.js";
import { buildOmlO21, simulateLisAck } from "../src/lis.js";
import { migrate } from "../src/migrate.js";
import { runLogicalBackup } from "../src/ops.js";

let dir = "";
let db: Db;
let app: FastifyInstance;
const aiKey = randomBytes(32);
const config: AppConfig = {
  aiDataKey: aiKey,
  provisionToken: "scale-token",
  cookieSecure: false,
  logs: []
};

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "zenaios-scale-"));
  db = await openPglite(dir);
  const applied = await migrate(db);
  expect(applied).toEqual(["0001_init", "0002_collection", "0003_scale", "0004_pilot", "0005_appointments", "0006_module_config"]);
  app = await buildApp(db, config);
});

afterAll(async () => {
  await app.close();
  await db.close();
  await rm(dir, { recursive: true, force: true });
});

describe("scalabilitate spitale mari", () => {
  it("paginează panoul de secții, izolează domeniul pe secție, dispatch LIS și backup", async () => {
    const setup = await app.inject({
      method: "POST",
      url: "/api/setup",
      payload: { hospitalName: "Spital Mare", adminUsername: "admin.scale", adminDisplayName: "Admin Scale" }
    });
    expect(setup.statusCode).toBe(200);
    const hospitalId = (setup.json() as { hospitalId: string }).hospitalId;
    const adminCookie = await login((setup.json() as { oneTimePassword: string }).oneTimePassword, "admin.scale");

    const seeded = await seedLargeStructure(db, hospitalId, {
      wards: 12,
      roomsPerWard: 4,
      bedsPerRoom: 5,
      newId
    });
    expect(seeded.bedCount).toBe(240);

    const page1 = await app.inject({ method: "GET", url: "/api/board/wards?limit=5&offset=0", headers: { cookie: adminCookie } });
    expect(page1.statusCode).toBe(200);
    const board1 = page1.json() as { total: number; items: { id: string; name: string }[] };
    expect(board1.total).toBe(12);
    expect(board1.items).toHaveLength(5);

    const page2 = await app.inject({ method: "GET", url: "/api/board/wards?limit=5&offset=5", headers: { cookie: adminCookie } });
    const board2 = page2.json() as { items: { id: string }[] };
    expect(board2.items[0]?.id).not.toBe(board1.items[0]?.id);

    const beds = await app.inject({
      method: "GET",
      url: `/api/board/wards/${seeded.wardIds[0]}/beds?limit=50&offset=0`,
      headers: { cookie: adminCookie }
    });
    expect(beds.statusCode).toBe(200);
    expect((beds.json() as { total: number }).total).toBe(20);

    const nurse = await app.inject({
      method: "POST",
      url: "/api/users",
      headers: { cookie: adminCookie },
      payload: { username: "nurse.scale", displayName: "Nurse Scale", roleCode: "nurse" }
    });
    const nurseCookie = await login((nurse.json() as { oneTimePassword: string }).oneTimePassword, "nurse.scale");
    const nurseId = (nurse.json() as { id: string }).id;

    await app.inject({
      method: "PUT",
      url: `/api/users/${nurseId}/ward-scopes`,
      headers: { cookie: adminCookie },
      payload: { wardIds: [seeded.wardIds[0]] }
    });

    // re-login to refresh session scopes
    const nurseFresh = await loginOn(app, "nurse.scale-Parola-12", "nurse.scale", false);
    const scoped = await app.inject({ method: "GET", url: "/api/board/wards?limit=50", headers: { cookie: nurseFresh } });
    expect(scoped.statusCode).toBe(200);
    const scopedBoard = scoped.json() as { total: number; items: { id: string }[] };
    expect(scopedBoard.total).toBe(1);
    expect(scopedBoard.items[0]?.id).toBe(seeded.wardIds[0]);

    const deniedWard = await app.inject({
      method: "GET",
      url: `/api/board/wards/${seeded.wardIds[1]}/beds`,
      headers: { cookie: nurseFresh }
    });
    expect(deniedWard.statusCode).toBe(403);

    const bedId = (await db.query<{ id: string }>(
      `SELECT b.id FROM beds b JOIN rooms r ON r.id = b.room_id WHERE r.ward_id = $1 LIMIT 1`,
      [seeded.wardIds[0]]
    ))[0]?.id;
    const upu = await app.inject({
      method: "POST",
      url: "/api/upu/presentations",
      headers: { cookie: adminCookie },
      payload: { firstName: "Ana", lastName: "Mare", triageCode: "verde", location: "Triaj" }
    });
    const presentation = upu.json() as { patientId: string; encounterId: string };
    const admitted = await app.inject({
      method: "POST",
      url: `/api/encounters/${presentation.encounterId}/admit`,
      headers: { cookie: adminCookie },
      payload: { wardId: seeded.wardIds[0], bedId }
    });
    expect(admitted.statusCode).toBe(200);
    const admission = admitted.json() as { encounterId: string };

    const labReq = await app.inject({
      method: "POST",
      url: "/api/service-requests",
      headers: { cookie: adminCookie },
      payload: { encounterId: admission.encounterId, code: "Na", display: "Sodiu", idempotencyKey: "scale-na-1" }
    });
    expect(labReq.statusCode).toBe(200);
    expect((labReq.json() as { outbox: string }).outbox).toBe("held");

    const dispatch = await app.inject({
      method: "POST",
      url: "/api/integrations/lis/dispatch",
      headers: { cookie: adminCookie },
      payload: { limit: 10 }
    });
    expect(dispatch.statusCode).toBe(200);
    const dispatched = dispatch.json() as { dispatched: number; results: { status: string; ackCode: string }[] };
    expect(dispatched.dispatched).toBe(1);
    expect(dispatched.results[0]).toMatchObject({ status: "acked", ackCode: "AA" });

    const outbox = await db.query<{ status: string }>(
      "SELECT status FROM integration_outbox WHERE hospital_id = $1 AND destination = 'lis'",
      [hospitalId]
    );
    expect(outbox.every((row) => row.status === "sent")).toBe(true);

    const sample = buildOmlO21({
      controlId: "CTRL-TEST",
      hospitalName: "Spital Mare",
      patientId: presentation.patientId,
      lastName: "Mare",
      firstName: "Ana",
      sex: "F",
      serviceRequestId: (labReq.json() as { id: string }).id,
      code: "Na",
      display: "Sodiu"
    });
    expect(simulateLisAck(sample).ackCode).toBe("AA");

    const backup = await runLogicalBackup(db, aiKey, { hospitalId, dir: join(dir, "backups"), keep: 3 });
    expect(backup.bytes).toBeGreaterThan(100);
    const runs = await app.inject({ method: "GET", url: "/api/ops/backup-runs", headers: { cookie: adminCookie } });
    expect(runs.statusCode).toBe(200);
    expect((runs.json() as unknown[]).length).toBeGreaterThanOrEqual(1);
  });
});

async function login(password: string, username: string): Promise<string> {
  return loginOn(app, password, username, true);
}

async function loginOn(target: FastifyInstance, password: string, username: string, changePassword: boolean): Promise<string> {
  const response = await target.inject({ method: "POST", url: "/api/auth/login", payload: { username, password } });
  expect(response.statusCode).toBe(200);
  const cookie = cookieOf(response);
  if (!changePassword) return cookie;
  const changed = await target.inject({
    method: "POST",
    url: "/api/auth/change-password",
    headers: { cookie },
    payload: { password: `${username}-Parola-12` }
  });
  expect(changed.statusCode).toBe(200);
  return cookie;
}

function cookieOf(response: { headers: object }): string {
  const raw = (response.headers as { "set-cookie"?: string | string[] })["set-cookie"];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value) throw new Error("Sesiunea nu a fost setată.");
  return value.split(";")[0] ?? value;
}
