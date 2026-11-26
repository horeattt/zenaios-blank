import { apiJson } from "./api.js";

/** Asigură pacient+internare clinică pentru o foaie locală și încarcă notele din API. */
export async function ensureAndLoadChart(ward, patient) {
  if (!ward?.apiId) throw new Error("Secția nu este sincronizată cu API.");
  const localKey = `ward:${ward.id}:patient:${patient.id}`;
  const birth = patient.birth || patient.birthDate || undefined;
  const ensured = await apiJson("/api/chart/ensure", {
    method: "POST",
    body: JSON.stringify({
      wardId: ward.apiId,
      firstName: patient.first || patient.firstName || "Necunoscut",
      lastName: patient.last || patient.lastName || "Necunoscut",
      sex: patient.sex === "F" || patient.sex === "M" ? patient.sex : "necunoscut",
      birthDate: birth && /^\d{4}-\d{2}-\d{2}$/.test(birth) ? birth : undefined,
      localKey,
      diagnosis: patient.dx || undefined
    })
  });
  patient.clinical = {
    patientId: ensured.patientId,
    encounterId: ensured.encounterId,
    admissionId: ensured.admissionId,
    localKey
  };
  const chart = await apiJson(`/api/patients/${ensured.patientId}/chart`);
  mergeChartIntoPatient(patient, chart);
  return { ensured, chart };
}

export function mergeChartIntoPatient(patient, chart) {
  const apiNotes = (chart.notes || []).map((n) => ({
    id: n.id,
    at: n.created_at,
    author: "foaie clinică",
    text: n.body,
    kind: n.kind,
    clinical: true
  }));
  const local = (patient.notes || []).filter((n) => !n.clinical);
  const seen = new Set(apiNotes.map((n) => n.id));
  patient.notes = apiNotes.concat(local.filter((n) => !n.id || !seen.has(n.id)));
  patient.clinicalDiagnoses = chart.diagnoses || [];
  patient.clinicalAllergies = chart.allergies || [];
  patient.clinicalObservations = chart.observations || [];
  if (chart.diagnoses?.[0]?.display) patient.dx = chart.diagnoses[0].display;
}

export async function saveClinicalNote(patient, text, kind = "evolution") {
  if (!patient?.clinical?.encounterId) throw new Error("Foaia nu este legată clinic.");
  const saved = await apiJson("/api/notes", {
    method: "POST",
    body: JSON.stringify({ encounterId: patient.clinical.encounterId, kind, body: text })
  });
  return saved;
}

export async function saveClinicalDiagnosis(patient, display, code) {
  if (!patient?.clinical?.encounterId) throw new Error("Foaia nu este legată clinic.");
  return apiJson("/api/diagnoses", {
    method: "POST",
    body: JSON.stringify({
      encounterId: patient.clinical.encounterId,
      display,
      code: code || undefined,
      rank: "principal"
    })
  });
}
