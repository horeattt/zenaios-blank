import { DateTime } from "luxon";
import type { Queryable } from "./db.js";

export type MonthWindow = { label: string; startIso: string; endIso: string };

export function previousCalendarMonth(zone: string, now: Date): MonthWindow {
  const local = DateTime.fromJSDate(now, { zone: "utc" }).setZone(zone);
  const start = local.minus({ months: 1 }).startOf("month");
  const end = start.plus({ months: 1 });
  const startIso = start.toUTC().toISO();
  const endIso = end.toUTC().toISO();
  if (!startIso || !endIso) throw new Error("Intervalul calendaristic nu a putut fi calculat.");
  return { label: start.toFormat("yyyy-LL"), startIso, endIso };
}

export const ADMISSIONS_REPORT = {
  key: "admissions_by_ward",
  title: "Internări pe secții",
  population: "Episoade de spitalizare continuă a căror internare a început în luna calendaristică anterioară, în fusul orar al spitalului.",
  formula: "Durata medie este media, în zile, dintre momentul internării și momentul externării, doar pentru episoadele închise. Episoadele încă deschise sunt numărate separat și nu intră în medie.",
  transfers: "Transferul între secții nu creează o internare nouă. Internarea rămâne pe secția de internare.",
  notOfficial: "Acesta este un indicator operațional ZenAIOS. Nu este DMS-ul și nu este ICM-ul calculate de INMSS pentru decontarea DRG."
} as const;

export type AdmissionRow = {
  wardId: string;
  ward: string;
  admissions: number;
  stillOpen: number;
  meanStayDays: number | null;
};

export async function admissionsByWard(q: Queryable, hospitalId: string, window: MonthWindow): Promise<AdmissionRow[]> {
  const rows = await q.query<{
    ward_id: string;
    ward: string;
    admissions: number;
    still_open: number;
    mean_stay_days: string | number | null;
  }>(
    `SELECT w.id AS ward_id, w.name AS ward,
            count(*)::int AS admissions,
            count(*) FILTER (WHERE e.ended_at IS NULL)::int AS still_open,
            avg(EXTRACT(EPOCH FROM (e.ended_at - a.started_at)) / 86400.0)
              FILTER (WHERE e.ended_at IS NOT NULL) AS mean_stay_days
     FROM admissions a
     JOIN encounters e ON e.id = a.encounter_id AND e.hospital_id = a.hospital_id
     JOIN wards w ON w.id = a.admitting_ward_id AND w.hospital_id = a.hospital_id
     WHERE a.hospital_id = $1
       AND e.class = 'inpatient'
       AND a.started_at >= $2
       AND a.started_at < $3
     GROUP BY w.id, w.name
     ORDER BY w.name`,
    [hospitalId, window.startIso, window.endIso]
  );
  return rows.map((row) => ({
    wardId: row.ward_id,
    ward: row.ward,
    admissions: Number(row.admissions),
    stillOpen: Number(row.still_open),
    meanStayDays: row.mean_stay_days === null ? null : Math.round(Number(row.mean_stay_days) * 100) / 100
  }));
}

export function parseReportIntent(message: string): "admissions_by_ward" | "clarify" {
  const text = message.toLowerCase();
  if (text.includes("intern") && (text.includes("secț") || text.includes("sect"))) return "admissions_by_ward";
  return "clarify";
}
