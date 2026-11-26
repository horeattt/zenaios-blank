import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import ExcelJS from "exceljs";
import { newId } from "./audit.js";
import type { Db } from "./db.js";
import type { AppDirs } from "./paths.js";

export type ExportFormat = "json" | "csv" | "xlsx" | "pdf" | "doc" | "html";

export async function writeReportArtifact(
  db: Db,
  dirs: AppDirs,
  input: {
    hospitalId: string;
    actorUserId: string | null;
    reportKey: string;
    format: ExportFormat;
    filename: string;
    content: Buffer | string;
    mediaType: string;
  }
): Promise<{ id: string; path: string; filename: string }> {
  await mkdir(dirs.exports, { recursive: true });
  const id = newId();
  const filename = input.filename;
  const path = join(dirs.exports, `${id}-${filename}`);
  await writeFile(path, input.content);
  await db.query(
    `INSERT INTO report_artifacts (id, hospital_id, actor_user_id, report_key, format, filename, path, media_type)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [id, input.hospitalId, input.actorUserId, input.reportKey, input.format, filename, path, input.mediaType]
  );
  return { id, path, filename };
}

export function toCsv(rows: Record<string, unknown>[]): string {
  if (!rows.length) return "";
  const keys = Object.keys(rows[0]!);
  const esc = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  return [keys.join(","), ...rows.map((row) => keys.map((k) => esc(row[k])).join(","))].join("\n");
}

export async function toXlsx(sheetName: string, rows: Record<string, unknown>[]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(sheetName);
  if (rows[0]) {
    const keys = Object.keys(rows[0]);
    sheet.addRow(keys);
    for (const row of rows) sheet.addRow(keys.map((k) => row[k]));
  }
  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

export function toHtmlDoc(title: string, rows: Record<string, unknown>[]): string {
  const keys = rows[0] ? Object.keys(rows[0]) : [];
  const head = keys.map((k) => `<th>${escapeHtml(k)}</th>`).join("");
  const body = rows.map((row) => `<tr>${keys.map((k) => `<td>${escapeHtml(row[k])}</td>`).join("")}</tr>`).join("");
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title></head><body><h1>${escapeHtml(title)}</h1><table border="1" cellpadding="4"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></body></html>`;
}

/** PDF minimal text-only, fără dependențe externe. */
export function toSimplePdf(title: string, lines: string[]): Buffer {
  const contentLines = [title, ""].concat(lines).map((line) => line.slice(0, 110));
  const stream = contentLines.map((line, index) => `BT /F1 10 Tf 40 ${780 - index * 14} Td (${escapePdf(line)}) Tj ET`).join("\n");
  const objects = [
    "1 0 obj<< /Type /Catalog /Pages 2 0 R >>endobj\n",
    "2 0 obj<< /Type /Pages /Kids [3 0 R] /Count 1 >>endobj\n",
    "3 0 obj<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources<< /Font<< /F1 5 0 R >> >> >>endobj\n",
    `4 0 obj<< /Length ${Buffer.byteLength(stream)} >>stream\n${stream}\nendstream\nendobj\n`,
    "5 0 obj<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>endobj\n"
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (const obj of objects) {
    offsets.push(Buffer.byteLength(pdf));
    pdf += obj;
  }
  const xref = offsets.length - 1;
  const startxref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${xref + 1}\n`;
  pdf += "0000000000 65535 f \n";
  for (let i = 1; i <= xref; i++) pdf += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer<< /Size ${xref + 1} /Root 1 0 R >>\nstartxref\n${startxref}\n%%EOF`;
  return Buffer.from(pdf);
}

function escapeHtml(value: unknown): string {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

function escapePdf(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}
