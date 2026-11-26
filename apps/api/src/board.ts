import type { Db } from "./db.js";
import type { PageQuery } from "./access.js";

export type WardBoardRow = {
  id: string;
  name: string;
  specialty: string | null;
  department_id: string;
  bed_total: number;
  bed_open: number;
  occupied: number;
  free: number;
};

export type BedBoardRow = {
  bed_id: string;
  label: string;
  status: string;
  room_id: string;
  room_name: string;
  admission_id: string | null;
  patient_id: string | null;
  first_name: string | null;
  last_name: string | null;
  sex: string | null;
  started_at: string | null;
};

export async function listWardBoard(
  db: Db,
  hospitalId: string,
  scopeIds: string[] | null,
  page: PageQuery
): Promise<{ total: number; items: WardBoardRow[] }> {
  const params: unknown[] = [hospitalId];
  let scopeSql = "";
  if (scopeIds) {
    params.push(scopeIds);
    scopeSql = ` AND w.id = ANY($${params.length}::uuid[])`;
  }
  const totalRows = await db.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM wards w WHERE w.hospital_id = $1${scopeSql}`,
    params
  );
  params.push(page.limit, page.offset);
  const items = await db.query<WardBoardRow>(
    `SELECT w.id, w.name, w.specialty, w.department_id,
            count(b.id)::int AS bed_total,
            count(b.id) FILTER (WHERE b.status = 'open')::int AS bed_open,
            count(a.id)::int AS occupied,
            (count(b.id) FILTER (WHERE b.status = 'open') - count(a.id))::int AS free
     FROM wards w
     LEFT JOIN rooms r ON r.ward_id = w.id AND r.hospital_id = w.hospital_id
     LEFT JOIN beds b ON b.room_id = r.id AND b.hospital_id = w.hospital_id
     LEFT JOIN admissions a ON a.bed_id = b.id AND a.hospital_id = w.hospital_id AND a.status = 'active'
     WHERE w.hospital_id = $1${scopeSql}
     GROUP BY w.id, w.name, w.specialty, w.department_id
     ORDER BY w.name
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );
  return { total: Number(totalRows[0]?.n ?? 0), items };
}

export async function listBedsForWard(
  db: Db,
  hospitalId: string,
  wardId: string,
  page: PageQuery
): Promise<{ total: number; items: BedBoardRow[] }> {
  const totalRows = await db.query<{ n: number }>(
    `SELECT count(*)::int AS n
     FROM beds b JOIN rooms r ON r.id = b.room_id
     WHERE b.hospital_id = $1 AND r.ward_id = $2`,
    [hospitalId, wardId]
  );
  const items = await db.query<BedBoardRow>(
    `SELECT b.id AS bed_id, b.label, b.status, r.id AS room_id, r.name AS room_name,
            a.id AS admission_id, p.id AS patient_id, p.first_name, p.last_name, p.sex, a.started_at
     FROM beds b
     JOIN rooms r ON r.id = b.room_id
     LEFT JOIN admissions a ON a.bed_id = b.id AND a.hospital_id = b.hospital_id AND a.status = 'active'
     LEFT JOIN patients p ON p.id = a.patient_id
     WHERE b.hospital_id = $1 AND r.ward_id = $2
     ORDER BY r.name, b.label
     LIMIT $3 OFFSET $4`,
    [hospitalId, wardId, page.limit, page.offset]
  );
  return { total: Number(totalRows[0]?.n ?? 0), items };
}

export async function seedLargeStructure(
  db: Db,
  hospitalId: string,
  opts: { wards: number; roomsPerWard: number; bedsPerRoom: number; newId: () => string }
): Promise<{ wardIds: string[]; bedCount: number }> {
  const buildingId = opts.newId();
  const departmentId = opts.newId();
  await db.query("INSERT INTO buildings (id, hospital_id, name) VALUES ($1, $2, $3)", [buildingId, hospitalId, "Pavilion scală"]);
  await db.query(
    "INSERT INTO departments (id, hospital_id, building_id, name, kind) VALUES ($1, $2, $3, $4, 'clinical')",
    [departmentId, hospitalId, buildingId, "Departament scală"]
  );
  const wardIds: string[] = [];
  let bedCount = 0;
  for (let w = 1; w <= opts.wards; w++) {
    const wardId = opts.newId();
    wardIds.push(wardId);
    await db.query(
      "INSERT INTO wards (id, hospital_id, department_id, name, specialty) VALUES ($1, $2, $3, $4, $5)",
      [wardId, hospitalId, departmentId, `Secție ${w}`, `Spec ${w}`]
    );
    for (let r = 1; r <= opts.roomsPerWard; r++) {
      const roomId = opts.newId();
      await db.query(
        "INSERT INTO rooms (id, hospital_id, ward_id, name) VALUES ($1, $2, $3, $4)",
        [roomId, hospitalId, wardId, `Salon ${w}.${r}`]
      );
      for (let b = 1; b <= opts.bedsPerRoom; b++) {
        await db.query(
          "INSERT INTO beds (id, hospital_id, room_id, label) VALUES ($1, $2, $3, $4)",
          [opts.newId(), hospitalId, roomId, `P${b}`]
        );
        bedCount += 1;
      }
    }
  }
  return { wardIds, bedCount };
}
