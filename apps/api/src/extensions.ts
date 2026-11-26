import { z } from "zod";
import { canonical, sha256 } from "./security.js";

const component = z.enum(["text", "textarea", "date", "select", "number"]);

export const declarativeSpecSchema = z.object({
  moduleKey: z.string().regex(/^[a-z]+(\.[a-z_]+)+$/),
  title: z.string().min(1).max(120),
  resource: z.enum(["leave_requests"]),
  fields: z.array(z.object({
    name: z.string().regex(/^[a-zA-Z][a-zA-Z0-9]*$/),
    component,
    required: z.boolean(),
    source: z.string().max(40).optional()
  })).min(1).max(30),
  workflow: z.array(z.object({
    from: z.enum(["submitted"]),
    action: z.enum(["approve", "reject"]),
    permission: z.literal("hr.approve"),
    to: z.enum(["approved", "rejected"])
  })).min(1),
  report: z.object({
    key: z.literal("leave_monthly"),
    schedule: z.enum(["monthly", "none"])
  })
}).strict();

export type DeclarativeSpec = z.infer<typeof declarativeSpecSchema>;

const blockedKeys = new Set(["script", "sql", "template", "javascript", "query"]);

export function assertSafeSpec(value: unknown): DeclarativeSpec {
  walk(value);
  const parsed = declarativeSpecSchema.safeParse(value);
  if (!parsed.success) throw Object.assign(new Error("Specificația nu respectă schema declarativă."), { statusCode: 422 });
  return parsed.data;
}

function walk(value: unknown): void {
  if (Array.isArray(value)) {
    value.forEach(walk);
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (blockedKeys.has(key.toLowerCase())) {
        throw Object.assign(new Error("Specificația conține o cheie nepermisă."), { statusCode: 422 });
      }
      walk(item);
    }
  }
}

export function leaveSpec(monthlyReport: boolean): DeclarativeSpec {
  return {
    moduleKey: "hr.leave",
    title: "Concedii",
    resource: "leave_requests",
    fields: [
      { name: "employeeId", component: "select", required: true, source: "employees" },
      { name: "startDate", component: "date", required: true },
      { name: "endDate", component: "date", required: true },
      { name: "reason", component: "textarea", required: true }
    ],
    workflow: [
      { from: "submitted", action: "approve", permission: "hr.approve", to: "approved" },
      { from: "submitted", action: "reject", permission: "hr.approve", to: "rejected" }
    ],
    report: { key: "leave_monthly", schedule: monthlyReport ? "monthly" : "none" }
  };
}

export function interpretConfigure(message: string): { spec: DeclarativeSpec } | { questions: string[] } {
  const text = message.toLowerCase();
  if (!text.includes("conced")) {
    return { questions: ["Spune ce modul vrei: de exemplu concedii, cine aprobă și dacă există un raport."] };
  }
  if (!text.includes("șef") && !text.includes("sef")) {
    return { questions: ["Cine aprobă cererea de concediu?"] };
  }
  const monthly = text.includes("lunar") || text.includes("lună") || text.includes("luna");
  return { spec: leaveSpec(monthly) };
}

export function specChecksum(spec: DeclarativeSpec): string {
  return sha256(canonical(spec));
}

export const CODE_EXECUTION = {
  available: false,
  reason: "Generarea și publicarea de cod sunt indisponibile: mediul nu are un workspace izolat pentru agenți. Propunerea rămâne stocată și nu poate fi publicată."
} as const;
