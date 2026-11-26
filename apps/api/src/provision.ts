import type { Db } from "./db.js";
import { newId, writeAudit } from "./audit.js";
import { hashPassword, newSecret } from "./security.js";

const ROLE_NAMES: Record<string, string> = {
  admin: "Administrator",
  physician: "Medic",
  nurse: "Asistent",
  lab: "Laborator",
  ward_chief: "Șef de secție",
  hr: "Resurse umane",
  auditor: "Auditor"
};

const ROLE_PERMISSIONS: Record<string, string[]> = {
  physician: ["structure.read", "patient.read", "patient.write", "encounter.read", "encounter.write", "chart.read", "chart.write", "lab.read", "lab.write", "report.read", "care.break_glass", "appointment.read", "appointment.write", "zena.help", "zena.report"],
  nurse: ["structure.read", "patient.read", "encounter.read", "chart.read", "chart.write", "lab.read", "hr.read", "appointment.read", "zena.help"],
  lab: ["structure.read", "patient.read", "encounter.read", "lab.read", "lab.write", "lab.validate", "integration.lis", "zena.help"],
  ward_chief: ["structure.read", "patient.read", "encounter.read", "hr.read", "hr.approve", "report.read", "report.ward", "ward.scope.admin", "duty.write", "appointment.read", "appointment.write", "zena.help"],
  hr: ["structure.read", "hr.read", "hr.write", "duty.write", "extension.propose", "zena.help", "zena.configure"],
  auditor: ["audit.read", "report.read", "ops.backup", "ops.admin", "zena.help", "zena.diagnose"]
};

export type ProvisionInput = {
  name: string;
  timezone?: string;
  countryCode?: string;
  adminUsername: string;
  adminDisplayName: string;
  synthetic?: boolean;
};

export type ProvisionResult = {
  hospitalId: string;
  userId: string;
  username: string;
  password: string;
};

export async function provisionHospital(db: Db, input: ProvisionInput): Promise<ProvisionResult> {
  const password = newSecret();
  const hospitalId = newId();
  const userId = newId();
  const passwordHash = await hashPassword(password);
  await db.tx(async (q) => {
    await q.query(
      `INSERT INTO hospitals (id, name, timezone, country_code, synthetic)
       VALUES ($1, $2, $3, $4, $5)`,
      [hospitalId, input.name, input.timezone ?? "Europe/Bucharest", input.countryCode ?? "RO", input.synthetic ?? false]
    );
    const catalog = await q.query<{ code: string }>("SELECT code FROM permissions ORDER BY code");
    const known = new Set(catalog.map((row) => row.code));
    let adminRoleId = "";
    for (const [code, name] of Object.entries(ROLE_NAMES)) {
      const roleId = newId();
      if (code === "admin") adminRoleId = roleId;
      await q.query(
        "INSERT INTO roles (id, hospital_id, code, name) VALUES ($1, $2, $3, $4)",
        [roleId, hospitalId, code, name]
      );
      const codes = code === "admin" ? [...known] : (ROLE_PERMISSIONS[code] ?? []).filter((item) => known.has(item));
      for (const permission of codes) {
        await q.query(
          "INSERT INTO role_permissions (role_id, permission_code) VALUES ($1, $2)",
          [roleId, permission]
        );
      }
    }
    await q.query(
      `INSERT INTO users (id, hospital_id, username, password_hash, password_must_change, display_name)
       VALUES ($1, $2, $3, $4, true, $5)`,
      [userId, hospitalId, input.adminUsername, passwordHash, input.adminDisplayName]
    );
    await q.query("INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2)", [userId, adminRoleId]);
    await writeAudit(q, {
      hospitalId,
      actorUserId: userId,
      action: "provision",
      entityType: "hospital",
      entityId: hospitalId,
      summary: "Spital provizionat, fără copiere de date din alt spital."
    });
  });
  return { hospitalId, userId, username: input.adminUsername, password };
}
