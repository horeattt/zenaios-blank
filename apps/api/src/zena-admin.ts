import { z } from "zod";
import { newId, writeAudit } from "./audit.js";
import type { Db } from "./db.js";
import { DEFAULT_FLOWS } from "./flows.js";

export type ZenaAdminResult = {
  action: string;
  target: string;
  message: string;
  result: Record<string, unknown>;
};

/** Acțiuni declarative imediat aplicabile (nu cod arbitrar). */
export async function applyZenaAdminCommand(
  db: Db,
  input: { hospitalId: string; actorUserId: string; message: string }
): Promise<ZenaAdminResult> {
  const text = input.message.trim();
  const lower = text.toLowerCase();

  const setFlag = lower.match(/(?:activează|activeaza|pornește|porneste|enable)\s+(?:flag|funcție|functie)?\s*([a-z0-9._-]+)/i)
    || lower.match(/flag\s+([a-z0-9._-]+)\s*(?:on|activ)/i);
  if (setFlag) {
    const code = setFlag[1]!;
    await db.query(
      `INSERT INTO feature_flags (hospital_id, code, enabled, config, updated_at)
       VALUES ($1, $2, true, '{}'::jsonb, now())
       ON CONFLICT (hospital_id, code) DO UPDATE SET enabled = true, updated_at = now()`,
      [input.hospitalId, code]
    );
    return saveAction(db, input, "feature_flag.enable", code, { enabled: true }, `Flag ${code} activat.`);
  }

  const unsetFlag = lower.match(/(?:dezactivează|dezactiveaza|oprește|opreste|disable)\s+(?:flag|funcție|functie)?\s*([a-z0-9._-]+)/i);
  if (unsetFlag) {
    const code = unsetFlag[1]!;
    await db.query(
      `INSERT INTO feature_flags (hospital_id, code, enabled, updated_at)
       VALUES ($1, $2, false, now())
       ON CONFLICT (hospital_id, code) DO UPDATE SET enabled = false, updated_at = now()`,
      [input.hospitalId, code]
    );
    return saveAction(db, input, "feature_flag.disable", code, { enabled: false }, `Flag ${code} dezactivat.`);
  }

  const integ = lower.match(/(?:setează|seteaza|configurează|configureaza)\s+(lis|siui|des|sipe|ceas|pacs|drg)\s+(?:pe|în|in)?\s*(neconfigurat|simulator|test|productie|producție)/i);
  if (integ) {
    const code = integ[1]!.toLowerCase();
    const modeRaw = integ[2]!.toLowerCase().replace("ț", "t").replace("ţ", "t");
    const mode = modeRaw === "producție" || modeRaw === "productie" ? "productie" : modeRaw;
    await ensureIntegrationSeed(db, input.hospitalId);
    await db.query(
      `UPDATE integration_endpoints SET mode = $3, updated_at = now()
       WHERE hospital_id = $1 AND code = $2`,
      [input.hospitalId, code, mode]
    );
    return saveAction(db, input, "integration.mode", code, { mode }, `Integrarea ${code} → ${mode}.`);
  }

  const urlMatch = lower.match(/(?:setează|seteaza|pune)\s+(?:url|adresa|adresă)\s+(lis|siui|des|sipe|ceas|pacs|drg)\s+(\S+)/i);
  if (urlMatch) {
    const code = urlMatch[1]!.toLowerCase();
    const baseUrl = text.match(/(https?:\/\/\S+)/i)?.[1] ?? urlMatch[2]!;
    await ensureIntegrationSeed(db, input.hospitalId);
    await db.query(
      `UPDATE integration_endpoints SET base_url = $3, updated_at = now()
       WHERE hospital_id = $1 AND code = $2`,
      [input.hospitalId, code, baseUrl]
    );
    return saveAction(db, input, "integration.url", code, { baseUrl }, `URL ${code} actualizat.`);
  }

  if (/reseedează flux|reseedeaza flux|reîncarcă flux|reincarca flux|seed flow|resetează diagrame|reseteaza diagrame/.test(lower)) {
    const count = await seedFlows(db, input.hospitalId);
    return saveAction(db, input, "flows.seed", "all", { count }, `Fluxuri reîncărcate (${count}).`);
  }

  const stock = lower.match(/(?:adaugă|adauga)\s+(?:stoc|medicament)\s+(.+?)\s+(\d+(?:[.,]\d+)?)\s*([a-zA-Zăâîșț]+)?/i);
  if (stock) {
    const name = stock[1]!.trim().replace(/\s+/g, " ").slice(0, 120);
    const qty = Number(String(stock[2]).replace(",", "."));
    const unit = (stock[3] || "buc").slice(0, 20);
    const id = newId();
    await db.query(
      `INSERT INTO pharmacy_items (id, hospital_id, name, unit, quantity, min_quantity)
       VALUES ($1, $2, $3, $4, $5, 0)`,
      [id, input.hospitalId, name, unit, qty]
    );
    return saveAction(db, input, "pharmacy.add", name, { id, quantity: qty, unit }, `Stoc: ${name} ${qty} ${unit}.`);
  }

  if (/ajutor|help|ce poți|ce poti|ce comenzi/.test(lower)) {
    return {
      action: "help",
      target: "zena.admin",
      message: "Comenzi: activează flag X · setează LIS pe simulator · setează URL SIUI https://… · reseedează fluxuri · adaugă stoc Paracetamol 100 buc",
      result: { ok: true }
    };
  }

  return {
    action: "clarify",
    target: "zena.admin",
    message: "Nu am recunoscut comanda. Spuneți: activează flag pilot.upu · setează LIS pe simulator · reseedează fluxuri · adaugă stoc X 10 buc",
    result: { ok: false }
  };
}

export async function normalizeDictation(raw: string, lang: string): Promise<{ normalized: string; lang: string }> {
  let text = raw.trim().replace(/\s+/g, " ");
  // Corecții uzuale RO + păstrare fidelă pentru alte limbi (doar spații / punctuație)
  if (lang.startsWith("ro")) {
    const map: Record<string, string> = {
      "pacientul": "pacientul",
      "evolutie": "evoluție",
      "diagnostice": "diagnostice",
      "tensiune arterila": "tensiune arterială",
      "febra": "febră",
      "dispnee": "dispnee"
    };
    for (const [from, to] of Object.entries(map)) {
      text = text.replace(new RegExp(from, "gi"), to);
    }
  }
  if (text && !/[.!?…]$/.test(text)) text += ".";
  if (text) text = text.charAt(0).toUpperCase() + text.slice(1);
  return { normalized: text, lang };
}

export async function ensureIntegrationSeed(db: Db, hospitalId: string): Promise<void> {
  const defaults = [
    { code: "lis", name: "LIS (laborator)", mode: "simulator" },
    { code: "siui", name: "SIUI / identificare CNP", mode: "neconfigurat" },
    { code: "des", name: "DES", mode: "neconfigurat" },
    { code: "sipe", name: "SIPE", mode: "neconfigurat" },
    { code: "ceas", name: "CEAS", mode: "neconfigurat" },
    { code: "pacs", name: "PACS", mode: "neconfigurat" },
    { code: "drg", name: "DRG", mode: "neconfigurat" },
    { code: "docs", name: "Export documente", mode: "test" }
  ];
  for (const item of defaults) {
    await db.query(
      `INSERT INTO integration_endpoints (id, hospital_id, code, name, mode)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (hospital_id, code) DO NOTHING`,
      [newId(), hospitalId, item.code, item.name, item.mode]
    );
  }
}

export async function seedFlows(db: Db, hospitalId: string): Promise<number> {
  let count = 0;
  for (const flow of DEFAULT_FLOWS) {
    await db.query(
      `INSERT INTO flow_definitions (id, hospital_id, code, title, kind, steps, active, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, true, now())
       ON CONFLICT (hospital_id, code) DO UPDATE SET
         title = EXCLUDED.title, kind = EXCLUDED.kind, steps = EXCLUDED.steps, active = true, updated_at = now()`,
      [newId(), hospitalId, flow.code, flow.title, flow.kind, JSON.stringify(flow.steps)]
    );
    count += 1;
  }
  return count;
}

async function saveAction(
  db: Db,
  input: { hospitalId: string; actorUserId: string; message: string },
  action: string,
  target: string,
  result: Record<string, unknown>,
  message: string
): Promise<ZenaAdminResult> {
  const id = newId();
  await db.query(
    `INSERT INTO zena_admin_actions (id, hospital_id, actor_user_id, action, target, payload, result)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb)`,
    [id, input.hospitalId, input.actorUserId, action, target, JSON.stringify({ message: input.message }), JSON.stringify(result)]
  );
  await db.tx((q) => writeAudit(q, {
    hospitalId: input.hospitalId,
    actorUserId: input.actorUserId,
    action: "zena_admin",
    entityType: "zena_admin_action",
    entityId: id,
    summary: message
  }));
  return { action, target, message, result: { ...result, id } };
}

export const dictationBody = z.object({
  text: z.string().min(1).max(8000),
  lang: z.string().min(2).max(16).default("ro-RO"),
  target: z.string().max(80).optional()
});
