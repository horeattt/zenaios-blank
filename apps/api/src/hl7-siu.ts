/** HL7 v2.5.1 SIU — Schedule Information Unsolicited (programări ambulatoriu). */

export type SiuTrigger = "S12" | "S13" | "S14" | "S15" | "S26";

export type SiuAppointment = {
  controlId: string;
  hospitalName: string;
  placerId: string;
  fillerId?: string | null;
  startsAt: Date;
  endsAt: Date;
  durationMinutes: number;
  status: string;
  specialty: string;
  location: string;
  reason?: string | null;
  patientId?: string | null;
  patientLastName: string;
  patientFirstName: string;
  patientCnp?: string | null;
  practitionerUserId: string;
  practitionerName: string;
  wardName?: string | null;
};

const TRIGGER_LABEL: Record<SiuTrigger, string> = {
  S12: "Notification of new appointment booking",
  S13: "Notification of appointment rescheduling",
  S14: "Notification of appointment modification",
  S15: "Notification of appointment cancellation",
  S26: "Notification that patient did not show up"
};

export function siuMessageType(trigger: SiuTrigger): string {
  return `SIU^${trigger}^SIU_${trigger}`;
}

export function buildSiuMessage(trigger: SiuTrigger, appt: SiuAppointment, now = new Date()): string {
  const ts = formatHl7Ts(now);
  const start = formatHl7Ts(appt.startsAt);
  const end = formatHl7Ts(appt.endsAt);
  const schStatus = mapSchStatus(appt.status, trigger);
  const pidId = appt.patientId ?? appt.patientCnp ?? "TEMP";
  const cnp = appt.patientCnp ? `~${escapeHl7(appt.patientCnp)}^^^CNAS^NI` : "";
  const segments = [
    `MSH|^~\\&|ZenAIOS|${escapeHl7(appt.hospitalName)}|HIS|AMB|${ts}||${siuMessageType(trigger)}|${escapeHl7(appt.controlId)}|P|2.5.1`,
    // SCH: Schedule Activity Information — placer / filler appointment IDs, timing, status
    `SCH|${escapeHl7(appt.placerId)}|${escapeHl7(appt.fillerId ?? appt.placerId)}||||${escapeHl7(appt.reason ?? appt.specialty)}^${escapeHl7(appt.specialty)}^L|||${appt.durationMinutes}^min^min^^${start}^${end}||||||||${schStatus}|`,
    `TQ1|1|${appt.durationMinutes}^min|${start}|${end}`,
    `NTE|1||${escapeHl7(TRIGGER_LABEL[trigger])}`,
    `PID|1||${escapeHl7(pidId)}^^^ZenAIOS^PI${cnp}||${escapeHl7(appt.patientLastName)}^${escapeHl7(appt.patientFirstName)}`,
    `RGS|1|A`,
    // AIS: Appointment Information — Service
    `AIS|1|A|${escapeHl7(appt.specialty)}^Consult ${escapeHl7(appt.specialty)}^L|||${start}|${appt.durationMinutes}|min`,
    // AIL: Appointment Information — Location
    `AIL|1|A|${escapeHl7(appt.location)}^^${escapeHl7(appt.wardName ?? "Ambulatoriu")}`,
    // AIP: Appointment Information — Personnel Resource (medic)
    `AIP|1|A|${escapeHl7(appt.practitionerUserId)}^^^ZenAIOS^PR|${escapeHl7(appt.practitionerName)}||${start}|${appt.durationMinutes}|min`
  ];
  return segments.join("\r");
}

export function parseSiuControlId(hl7: string): string {
  const msh = hl7.split("\r")[0] ?? "";
  return msh.split("|")[9] ?? "";
}

function mapSchStatus(status: string, trigger: SiuTrigger): string {
  if (trigger === "S15") return "Cancelled";
  if (trigger === "S26") return "No Show";
  if (status === "arrived") return "Arrived";
  if (status === "fulfilled") return "Complete";
  if (status === "cancelled") return "Cancelled";
  if (status === "noshow") return "No Show";
  return "Booked";
}

export function formatHl7Ts(date: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${date.getUTCFullYear()}${p(date.getUTCMonth() + 1)}${p(date.getUTCDate())}${p(date.getUTCHours())}${p(date.getUTCMinutes())}${p(date.getUTCSeconds())}`;
}

export function escapeHl7(value: string): string {
  return String(value ?? "")
    .replace(/\\/g, "\\E\\")
    .replace(/\|/g, "\\F\\")
    .replace(/~/g, "\\R\\")
    .replace(/\^/g, "\\S\\")
    .replace(/&/g, "\\T\\")
    .replace(/\r|\n/g, " ");
}
