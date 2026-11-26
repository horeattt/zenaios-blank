import type { Db } from "./db.js";

export type ChartBundle = {
  patient: Record<string, unknown>;
  admission: Record<string, unknown> | null;
  encounter: Record<string, unknown> | null;
  notes: Record<string, unknown>[];
  diagnoses: Record<string, unknown>[];
  allergies: Record<string, unknown>[];
  observations: Record<string, unknown>[];
  documents: Record<string, unknown>[];
};

export async function loadPatientChart(db: Db, hospitalId: string, patientId: string): Promise<ChartBundle> {
  const patients = await db.query<Record<string, unknown>>(
    "SELECT * FROM patients WHERE id = $1 AND hospital_id = $2",
    [patientId, hospitalId]
  );
  if (!patients[0]) throw Object.assign(new Error("Pacientul nu există în acest spital."), { statusCode: 404 });
  const [admission] = await db.query<Record<string, unknown>>(
    `SELECT * FROM admissions WHERE hospital_id = $1 AND patient_id = $2 AND status = 'active'
     ORDER BY started_at DESC LIMIT 1`,
    [hospitalId, patientId]
  );
  let encounter: Record<string, unknown> | null = null;
  if (admission?.encounter_id) {
    const rows = await db.query<Record<string, unknown>>(
      "SELECT * FROM encounters WHERE id = $1 AND hospital_id = $2",
      [admission.encounter_id, hospitalId]
    );
    encounter = rows[0] ?? null;
  }
  const [notes, diagnoses, allergies, observations, documents] = await Promise.all([
    db.query<Record<string, unknown>>(
      `SELECT id, kind, body, author_user_id, created_at FROM clinical_notes
       WHERE hospital_id = $1 AND patient_id = $2 ORDER BY created_at DESC LIMIT 200`,
      [hospitalId, patientId]
    ),
    db.query<Record<string, unknown>>(
      `SELECT id, code, display, rank, created_at FROM diagnoses
       WHERE hospital_id = $1 AND patient_id = $2 ORDER BY created_at DESC LIMIT 100`,
      [hospitalId, patientId]
    ),
    db.query<Record<string, unknown>>(
      `SELECT id, substance, criticality, noted_at FROM allergies
       WHERE hospital_id = $1 AND patient_id = $2 ORDER BY noted_at DESC LIMIT 50`,
      [hospitalId, patientId]
    ),
    db.query<Record<string, unknown>>(
      `SELECT id, code, display_name, value_numeric, value_text, unit, status, critical, created_at
       FROM observations WHERE hospital_id = $1 AND patient_id = $2
       ORDER BY created_at DESC LIMIT 200`,
      [hospitalId, patientId]
    ),
    db.query<Record<string, unknown>>(
      `SELECT id, doc_type, status, version, title, body, finalized_at, created_at
       FROM documents WHERE hospital_id = $1 AND patient_id = $2
       ORDER BY created_at DESC LIMIT 50`,
      [hospitalId, patientId]
    )
  ]);
  return {
    patient: patients[0],
    admission: admission ?? null,
    encounter,
    notes,
    diagnoses,
    allergies,
    observations,
    documents
  };
}
