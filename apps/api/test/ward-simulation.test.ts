/**
 * Simulare spital: Cardiologie + Chirurgie generală, 3 zile operaționale.
 * 50% internări ambulator, 50% UPU → foaie → diagnostic → lab → externare + scrisoare.
 */
import { randomBytes } from "node:crypto";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance, LightMyRequestResponse } from "fastify";
import { buildApp, type AppConfig } from "../src/app.js";
import { openPglite, type Db } from "../src/db.js";
import { migrate } from "../src/migrate.js";
import { ensureAppDirs, resolveAppDirs } from "../src/paths.js";

type Staff = { id: string; username: string; cookie: string; displayName: string; role: "physician" | "nurse" };
type Stay = {
  patientId: string;
  encounterId: string;
  admissionId: string;
  pathway: "ambulatory" | "upu";
  wardKey: "cardio" | "surg";
  dx: string;
  name: string;
  dayAdmitted: number;
};

type WardBag = {
  key: "cardio" | "surg";
  name: string;
  wardId: string;
  roomId: string;
  bedIds: string[];
  physicians: Staff[];
  nurses: Staff[];
  employeeIds: string[];
  stays: Stay[];
};

const LAST = ["Ionescu", "Popa", "Radu", "Moldovan", "Suciu", "Nagy", "Costea", "Kiss", "Luca", "Stan", "Mureșan", "Toma"];
const FIRST_F = ["Maria", "Elena", "Ana", "Ioana", "Andreea", "Cristina"];
const FIRST_M = ["Ion", "Mihai", "Andrei", "Gheorghe", "Radu", "Paul"];
const DX_CARDIO = [
  "I21.4 Infarct miocardic acut subendocardic",
  "I50.0 Insuficiență cardiacă congestivă",
  "I48.0 Fibrilație atrială paroxistică",
  "I20.0 Angină pectorală instabilă",
  "I11.0 Boală cardiacă hipertensivă cu IC"
];
const DX_SURG = [
  "K35.8 Apendicită acută",
  "K80.0 Litiază biliară cu colecistită",
  "K40.9 Hernie inghinală",
  "K56.6 Ileus",
  "L02.2 Abces cutanat"
];

let dir = "";
let db: Db;
let app: FastifyInstance;
let adminCookie = "";
let reportPath = "";
const findings: string[] = [];
const letters: { patient: string; ward: string; pathway: string; body: string; ok: boolean; issues: string[] }[] = [];
let seq = 0;

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), "zenaios-sim-"));
  const dirs = await ensureAppDirs(resolveAppDirs({ ...process.env, ZENAIOS_ROOT: dir, BACKUP_DIR: join(dir, "backups") }));
  db = await openPglite(join(dir, "pg"));
  await migrate(db);
  const config: AppConfig = {
    aiDataKey: randomBytes(32),
    provisionToken: "",
    cookieSecure: false,
    logs: [],
    openAccess: false,
    dirs
  };
  app = await buildApp(db, config);
  reportPath = join(dir, "simulation-report.json");
}, 60_000);

afterAll(async () => {
  try {
    await mkdir(join(process.cwd(), "test-results"), { recursive: true });
    await writeFile(
      join(process.cwd(), "test-results", "ward-simulation-report.json"),
      JSON.stringify({ findings, letters, reportPath }, null, 2),
      "utf8"
    );
  } catch { /* ignore */ }
  await app.close();
  await db.close();
  await rm(dir, { recursive: true, force: true });
});

describe("simulare 3 zile · Cardiologie + Chirurgie", () => {
  it("administrează personalul, rulează 3 zile, externează cu scrisoare medicală completă", async () => {
    // —— 1. Setup administrativ ——
    const setup = await app.inject({
      method: "POST",
      url: "/api/setup",
      payload: {
        hospitalName: "Spital Județean Simulare",
        adminUsername: "admin.sim",
        adminDisplayName: "Admin Simulare"
      }
    });
    expect(setup.statusCode).toBe(200);
    const otp = (setup.json() as { oneTimePassword: string }).oneTimePassword;
    adminCookie = await loginAs("admin.sim", otp);

    const building = await mustOk(app.inject({
      method: "POST", url: "/api/buildings", headers: { cookie: adminCookie },
      payload: { name: "Pavilion Clinic" }
    }));
    const dept = await mustOk(app.inject({
      method: "POST", url: "/api/departments", headers: { cookie: adminCookie },
      payload: { buildingId: building.id, name: "Clinic", kind: "clinical" }
    }));

    const wards: WardBag[] = [];
    for (const spec of [
      { key: "cardio" as const, name: "Cardiologie" },
      { key: "surg" as const, name: "Chirurgie generală" }
    ]) {
      const ward = await mustOk(app.inject({
        method: "POST", url: "/api/wards", headers: { cookie: adminCookie },
        payload: { departmentId: dept.id, name: spec.name, specialty: spec.name }
      }));
      const room = await mustOk(app.inject({
        method: "POST", url: "/api/rooms", headers: { cookie: adminCookie },
        payload: { wardId: ward.id, name: `Salon ${spec.name}` }
      }));
      const bedIds: string[] = [];
      for (let i = 1; i <= 12; i++) {
        const bed = await mustOk(app.inject({
          method: "POST", url: "/api/beds", headers: { cookie: adminCookie },
          payload: { roomId: room.id, label: `Pat ${i}` }
        }));
        bedIds.push(bed.id);
      }

      const physicians: Staff[] = [];
      for (let i = 1; i <= 2; i++) {
        physicians.push(await createClinicalUser(adminCookie, {
          username: `${spec.key}.medic${i}`,
          displayName: `Dr. ${LAST[(seq + i) % LAST.length]} ${FIRST_M[i % FIRST_M.length]}`,
          roleCode: "physician",
          wardId: ward.id
        }));
      }

      const nurses: Staff[] = [];
      const employeeIds: string[] = [];
      for (let i = 1; i <= 10; i++) {
        const name = `${FIRST_F[i % FIRST_F.length]} ${LAST[(seq + i * 3) % LAST.length]}`;
        const emp = await mustOk(app.inject({
          method: "POST", url: "/api/hr/employees", headers: { cookie: adminCookie },
          payload: { firstName: name.split(" ")[0], lastName: name.split(" ").slice(1).join(" "), jobTitle: "Asistent medical", wardId: ward.id }
        }));
        employeeIds.push(emp.id);
        // 3 asistente ca useri activi pe foaie (restul doar HR)
        if (i <= 3) {
          nurses.push(await createClinicalUser(adminCookie, {
            username: `${spec.key}.asist${i}`,
            displayName: `As. ${name}`,
            roleCode: "nurse",
            wardId: ward.id
          }));
        }
      }

      // Gărzi ziua 1 pentru cei 2 medici
      const day0 = isoDay(0);
      for (const [idx, phy] of physicians.entries()) {
        await mustOk(app.inject({
          method: "POST", url: "/api/duty/shifts", headers: { cookie: adminCookie },
          payload: {
            wardId: ward.id,
            dutyDate: day0,
            role: "medic",
            personName: phy.displayName,
            startsAt: `${day0}T0${8 + idx}:00:00.000Z`,
            endsAt: `${day0}T${20 + idx}:00:00.000Z`
          }
        }));
      }

      wards.push({
        key: spec.key,
        name: spec.name,
        wardId: ward.id,
        roomId: room.id,
        bedIds,
        physicians,
        nurses,
        employeeIds,
        stays: []
      });
      seq += 7;
    }

    expect(wards[0]!.physicians).toHaveLength(2);
    expect(wards[1]!.physicians).toHaveLength(2);
    expect(wards[0]!.employeeIds).toHaveLength(10);
    expect(wards[1]!.employeeIds).toHaveLength(10);

    // —— 2. Populare inițială: 5 pacienți / secție (4 „seed” + 1), 50/50 UPU/ambulator ——
    for (const ward of wards) {
      for (let i = 0; i < 5; i++) {
        const pathway: "ambulatory" | "upu" = i % 2 === 0 ? "ambulatory" : "upu";
        const stay = await admitPatient(ward, pathway, 0);
        ward.stays.push(stay);
      }
      expect(ward.stays).toHaveLength(5);
    }

    await assertCensus(wards, 5);

    // —— 3. Trei zile: pe fiecare secție externează 2, internează 2 ——
    for (let day = 1; day <= 3; day++) {
      for (const ward of wards) {
        // Evoluție / lab pe pacienții rămași (contribuție medici + asistente)
        for (const stay of ward.stays) {
          await dayCare(ward, stay, day);
        }

        const toDischarge = pick(ward.stays, 2);
        for (const stay of toDischarge) {
          const letter = await dischargeWithLetter(ward, stay, day);
          letters.push(letter);
          ward.stays = ward.stays.filter((s) => s.patientId !== stay.patientId);
        }

        for (let i = 0; i < 2; i++) {
          // alternare 50/50 pe zi
          const pathway: "ambulatory" | "upu" = (day + i) % 2 === 0 ? "upu" : "ambulatory";
          ward.stays.push(await admitPatient(ward, pathway, day));
        }

        expect(ward.stays).toHaveLength(5);
      }
      await assertCensus(wards, 5);

      // Export census pe secție
      for (const ward of wards) {
        const exp = await app.inject({
          method: "POST",
          url: "/api/reports/ward/export",
          headers: { cookie: adminCookie },
          payload: { wardId: ward.wardId, reportKey: "census", format: "csv" }
        });
        expect(exp.statusCode).toBe(200);
        expect(String(exp.body)).toMatch(/sectie|Paturi|ocupate/i);
      }
    }

    // —— 4. Analiză scrisori ——
    expect(letters.length).toBe(12); // 2 wards × 2 discharges × 3 days
    const ambulatoryLetters = letters.filter((l) => l.pathway === "ambulatory");
    const upuLetters = letters.filter((l) => l.pathway === "upu");
    expect(ambulatoryLetters.length).toBeGreaterThan(0);
    expect(upuLetters.length).toBeGreaterThan(0);

    for (const letter of letters) {
      const issues = analyzeLetter(letter.body);
      letter.issues = issues;
      letter.ok = issues.length === 0;
      expect(letter.body.length).toBeGreaterThan(80);
      expect(letter.body).toMatch(/Scrisoare medicală|Diagnostic|Evoluție|Recomandări/i);
      // cerem minim: diagnostic + evoluție + recomandări
      expect(issues.filter((i) => i.startsWith("missing:"))).toHaveLength(0);
    }

    const pathwayCounts = await countPathways();
    findings.push(`Pathway notes ambulator/UPU pe foaie: ${JSON.stringify(pathwayCounts)}`);
    findings.push(`Scrisori generate: ${letters.length}; OK structural: ${letters.filter((l) => l.ok).length}`);
    findings.push(`Medici: 4 · Asistenți HR: 20 · Asistenți user foaie: 6`);

    await writeFile(reportPath, JSON.stringify({ findings, letters, pathwayCounts }, null, 2), "utf8");

    // census final
    await assertCensus(wards, 5);
  }, 180_000);
});

async function admitPatient(ward: WardBag, pathway: "ambulatory" | "upu", day: number): Promise<Stay> {
  const physician = ward.physicians[seq % ward.physicians.length]!;
  const sex = seq % 2 === 0 ? "F" : "M";
  const firstName = sex === "F" ? FIRST_F[seq % FIRST_F.length]! : FIRST_M[seq % FIRST_M.length]!;
  const lastName = LAST[seq % LAST.length]!;
  const dxPool = ward.key === "cardio" ? DX_CARDIO : DX_SURG;
  const dx = dxPool[seq % dxPool.length]!;
  const cnp = fakeCnp(sex === "F", 1975 + (seq % 30), seq);
  const name = `${lastName} ${firstName}`;
  seq += 1;

  const freeBed = await firstFreeBed(ward);
  let patientId: string;
  let encounterId: string;
  let admissionId: string;

  if (pathway === "upu") {
    // UPU + identificare + internare: medic (asistentul nu are encounter.write / patient.write)
    const upu = await mustOk(app.inject({
      method: "POST", url: "/api/upu/presentations", headers: { cookie: physician.cookie },
      payload: {
        unidentified: true,
        triageCode: pickOne(["rosu", "galben", "verde"] as const),
        location: `Box ${1 + (seq % 4)}`
      }
    }));
    await mustOk(app.inject({
      method: "POST", url: `/api/patients/${upu.patientId}/identify`, headers: { cookie: physician.cookie },
      payload: { firstName, lastName, birthDate: `${1975 + (seq % 30)}-06-15`, cnp }
    }));
    const admitted = await mustOk(app.inject({
      method: "POST", url: `/api/encounters/${upu.encounterId}/admit`, headers: { cookie: physician.cookie },
      payload: { wardId: ward.wardId, bedId: freeBed }
    }));
    patientId = admitted.patientId;
    encounterId = admitted.encounterId;
    admissionId = admitted.admissionId;

    await mustOk(app.inject({
      method: "POST", url: "/api/diagnoses", headers: { cookie: physician.cookie },
      payload: { encounterId, display: dx, code: dx.split(" ")[0], rank: "principal" }
    }));
    await mustOk(app.inject({
      method: "POST", url: "/api/notes", headers: { cookie: physician.cookie },
      payload: { encounterId, kind: "admission_pathway", body: "Cale internare: UPU / urgență." }
    }));
  } else {
    const ensured = await mustOk(app.inject({
      method: "POST", url: "/api/chart/ensure", headers: { cookie: physician.cookie },
      payload: {
        wardId: ward.wardId,
        bedId: freeBed,
        firstName,
        lastName,
        sex,
        birthDate: `${1975 + (seq % 30)}-06-15`,
        localKey: `${ward.key}:d${day}:${seq}`,
        diagnosis: dx,
        pathway: "ambulatory",
        cnp
      }
    }));
    patientId = ensured.patientId;
    encounterId = ensured.encounterId;
    admissionId = ensured.admissionId;
  }

  await mustOk(app.inject({
    method: "POST", url: `/api/patients/${patientId}/care-team`, headers: { cookie: adminCookie },
    payload: { userId: physician.id, role: "attending" }
  }));

  // alergie random ~30%
  if (seq % 3 === 0) {
    await mustOk(app.inject({
      method: "POST", url: "/api/allergies", headers: { cookie: physician.cookie },
      payload: { patientId, substance: pickOne(["Penicilină", "AINS", "Iod"]), criticality: "high" }
    }));
  }

  return { patientId, encounterId, admissionId, pathway, wardKey: ward.key, dx, name, dayAdmitted: day };
}

async function dayCare(ward: WardBag, stay: Stay, day: number): Promise<void> {
  const physician = ward.physicians[day % ward.physicians.length]!;
  const nurse = ward.nurses[day % ward.nurses.length]!;

  await mustOk(app.inject({
    method: "POST", url: "/api/notes", headers: { cookie: physician.cookie },
    payload: {
      encounterId: stay.encounterId,
      kind: "evolution",
      body: `Ziua ${day}: evoluție ${pickOne(["favorabilă", "staționară", "cu ameliorare clinică"])}. Pacient ${stay.name}. TA și puls monitorizate.`
    }
  }));
  await mustOk(app.inject({
    method: "POST", url: "/api/notes", headers: { cookie: nurse.cookie },
    payload: {
      encounterId: stay.encounterId,
      kind: "nursing",
      body: `Asistență ziua ${day}: vitale înregistrate, tratament administrat conform schemei.`
    }
  }));

  // lab pe ~jumătate
  if ((day + seq + stay.name.length) % 2 === 0) {
    const req = await mustOk(app.inject({
      method: "POST", url: "/api/service-requests", headers: { cookie: physician.cookie },
      payload: {
        encounterId: stay.encounterId,
        code: pickOne(["K", "Na", "Hb", "CRP"]),
        display: pickOne(["Potasiu", "Sodiu", "Hemoglobină", "PCR"]),
        idempotencyKey: `lab-${stay.patientId}-d${day}`
      }
    }));
    const specimen = await mustOk(app.inject({
      method: "POST", url: "/api/specimens", headers: { cookie: adminCookie },
      payload: { serviceRequestId: req.id, specimenType: "ser" }
    }));
    const obs = await mustOk(app.inject({
      method: "POST", url: "/api/observations", headers: { cookie: adminCookie },
      payload: {
        serviceRequestId: req.id,
        specimenId: specimen.id,
        code: "K",
        displayName: "Potasiu",
        valueNumeric: 3.8 + (seq % 20) / 10,
        unit: "mmol/L",
        referenceLow: 3.5,
        referenceHigh: 5.1,
        critical: false
      }
    }));
    await mustOk(app.inject({
      method: "POST", url: `/api/observations/${obs.id}/validate`, headers: { cookie: adminCookie },
      payload: {}
    }));
  }
}

async function dischargeWithLetter(ward: WardBag, stay: Stay, day: number) {
  const physician = ward.physicians[0]!;
  const chart = await mustOk(app.inject({
    method: "GET", url: `/api/patients/${stay.patientId}/chart`, headers: { cookie: physician.cookie }
  })) as {
    notes: { kind: string; body: string }[];
    diagnoses: { display: string }[];
    observations: { display_name: string; value_numeric: number; unit: string }[];
  };

  const evolutions = chart.notes.filter((n) => n.kind === "evolution").map((n) => n.body);
  const nursing = chart.notes.filter((n) => n.kind === "nursing").length;
  const dx = chart.diagnoses[0]?.display || stay.dx;
  const labs = chart.observations.slice(0, 3).map((o) => `${o.display_name} ${o.value_numeric} ${o.unit}`).join("; ");

  const summary = [
    "Scrisoare medicală",
    `Pacient: ${stay.name}`,
    `Secție: ${ward.name}`,
    `Cale de internare: ${stay.pathway === "upu" ? "UPU / urgență" : "Ambulator / programat"}`,
    `Diagnostic la externare: ${dx}`,
    `Evoluție: ${evolutions.slice(0, 2).join(" | ") || "Evoluție favorabilă sub tratament."}`,
    `Investigații: ${labs || "Fără rezultate noi la externare."}`,
    `Îngrijiri: ${nursing} note de asistență pe foaie.`,
    "Tratament: conform foii de observație; continuă schema la domiciliu 7 zile.",
    "Recomandări: control la 7 zile; prezentare la urgență dacă starea se agravează.",
    `Externat în ziua de simulare ${day}, medic curant ${physician.displayName}.`
  ].join("\n");

  const discharged = await mustOk(app.inject({
    method: "POST", url: `/api/encounters/${stay.encounterId}/discharge`, headers: { cookie: physician.cookie },
    payload: {
      summary: summary.length >= 50 ? summary : `${summary} Evoluție favorabilă, fără complicații acute la externare.`,
      dischargeStatus: "ameliorat",
      dischargeType: "externat",
      dxDisplay: dx,
      recommendations: "Control la medicul de familie în 7 zile. Prezentare la urgență dacă starea se agravează."
    }
  }));

  const doc = await mustOk(app.inject({
    method: "GET", url: `/api/documents/${discharged.documentId}`, headers: { cookie: physician.cookie }
  })) as { body: string; title: string; status: string; doc_type: string };

  expect(doc.status).toBe("final");
  expect(doc.doc_type).toBe("discharge_letter");
  expect(doc.body).toContain(dx.split(" ")[0]!);

  // arhivă pe disc
  await mustOk(app.inject({
    method: "POST", url: `/api/patients/${stay.patientId}/archive-file`, headers: { cookie: physician.cookie },
    payload: {}
  }));

  // export document via ward report after discharge is census; letter verified via GET
  return {
    patient: stay.name,
    ward: ward.name,
    pathway: stay.pathway,
    body: doc.body,
    ok: true,
    issues: [] as string[]
  };
}

function analyzeLetter(body: string): string[] {
  const issues: string[] = [];
  if (!/Diagnostic/i.test(body)) issues.push("missing:Diagnostic");
  if (!/Evoluție|Evolutie/i.test(body)) issues.push("missing:Evoluție");
  if (!/Recomandări|Recomandari/i.test(body)) issues.push("missing:Recomandări");
  if (!/Cale de internare|UPU|Ambulator/i.test(body)) issues.push("missing:cale-internare");
  if (body.length < 120) issues.push("too-short");
  return issues;
}

async function assertCensus(wards: WardBag[], perWard: number) {
  const census = await mustOk(app.inject({
    method: "GET", url: "/api/census", headers: { cookie: adminCookie }
  })) as { wards: { id: string; name: string; occupied: number }[]; totals: { occupied: number } };
  for (const w of wards) {
    const row = census.wards.find((r) => r.id === w.wardId);
    expect(row?.occupied, `census ${w.name}`).toBe(perWard);
  }
  expect(census.totals.occupied).toBe(perWard * wards.length);
}

async function firstFreeBed(ward: WardBag): Promise<string> {
  const beds = await mustOk(app.inject({
    method: "GET", url: `/api/board/wards/${ward.wardId}/beds?limit=50&offset=0`, headers: { cookie: adminCookie }
  })) as { items: { bed_id: string; admission_id: string | null; status: string }[] };
  const free = beds.items.find((b) => b.status === "open" && !b.admission_id);
  if (!free) throw new Error(`Nu există pat liber pe ${ward.name}`);
  return free.bed_id;
}

async function countPathways() {
  const rows = await db.query<{ body: string; n: number }>(
    `SELECT body, count(*)::int AS n FROM clinical_notes WHERE kind = 'admission_pathway' GROUP BY body`
  );
  return rows;
}

async function createClinicalUser(
  admin: string,
  input: { username: string; displayName: string; roleCode: "physician" | "nurse"; wardId: string }
): Promise<Staff> {
  const createdRes = await app.inject({
    method: "POST", url: "/api/users", headers: { cookie: admin },
    payload: { username: input.username, displayName: input.displayName, roleCode: input.roleCode }
  });
  if (createdRes.statusCode !== 200) {
    throw new Error(`create user ${input.username} → ${createdRes.statusCode}: ${createdRes.body}`);
  }
  const created = createdRes.json() as { id: string; username: string; oneTimePassword: string };
  if (!created.id || !created.username || !created.oneTimePassword) {
    throw new Error(`create user incomplete: ${JSON.stringify(created)}`);
  }

  const scope = await app.inject({
    method: "PUT", url: `/api/users/${created.id}/ward-scopes`, headers: { cookie: admin },
    payload: { wardIds: [input.wardId] }
  });
  if (scope.statusCode !== 200) {
    throw new Error(`ward-scope ${created.username} → ${scope.statusCode}: ${scope.body}`);
  }

  const cookie = await loginAs(created.username, created.oneTimePassword);
  return {
    id: created.id,
    username: created.username,
    cookie,
    displayName: input.displayName,
    role: input.roleCode
  };
}

async function loginAs(username: string, password: string): Promise<string> {
  if (!username || !password) {
    throw new Error(`loginAs missing credentials user=${username} pass=${password ? "[set]" : "[empty]"}`);
  }
  const response = await app.inject({
    method: "POST",
    url: "/api/auth/login",
    headers: { "content-type": "application/json" },
    payload: { username: String(username), password: String(password) }
  });
  if (response.statusCode !== 200) {
    throw new Error(`login ${username} → ${response.statusCode}: ${response.body}`);
  }
  const cookie = cookieOf(response);
  const nextPassword = `${username.replace(/\./g, "_")}_ParolaLunga12`;
  const changed = await app.inject({
    method: "POST",
    url: "/api/auth/change-password",
    headers: { cookie, "content-type": "application/json" },
    payload: { password: nextPassword }
  });
  if (changed.statusCode !== 200) {
    throw new Error(`change-password ${username} → ${changed.statusCode}: ${changed.body}`);
  }
  return cookie;
}

async function mustOk(
  response: LightMyRequestResponse | Promise<LightMyRequestResponse>
): Promise<Record<string, any>> {
  const res = await response;
  if (res.statusCode >= 400) {
    throw new Error(`${res.statusCode}: ${res.body}`);
  }
  if (!res.body) return {};
  try {
    return res.json() as Record<string, any>;
  } catch {
    return { raw: res.body };
  }
}

function cookieOf(response: { headers: object }): string {
  const raw = (response.headers as { "set-cookie"?: string | string[] })["set-cookie"];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (!value) throw new Error("no cookie");
  return value.split(";")[0] ?? value;
}

function isoDay(offset: number): string {
  const d = new Date("2026-11-26T00:00:00.000Z");
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
}

function pick<T>(arr: T[], n: number): T[] {
  return arr.slice(0, n);
}

function pickOne<T>(arr: readonly T[]): T {
  return arr[seq % arr.length]!;
}

function fakeCnp(female: boolean, year: number, salt: number): string {
  const s = female ? (year >= 2000 ? "6" : "2") : (year >= 2000 ? "5" : "1");
  const yy = String(year).slice(2);
  const mm = String(1 + (salt % 12)).padStart(2, "0");
  const dd = String(1 + (salt % 28)).padStart(2, "0");
  const rest = String(1000000 + (salt * 7919) % 9000000).slice(0, 6);
  const base = `${s}${yy}${mm}${dd}${rest}`.slice(0, 12);
  // check digit simplified (not real CNP algorithm — only length/shape for API regex)
  return (base + String(salt % 10)).slice(0, 13);
}
