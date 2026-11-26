import { apiJson } from "./api.js";

export async function hydrateBoardOccupancy(state, ui) {
  const board = await apiJson("/api/board/wards?limit=100&offset=0");
  ui.apiBoardTotal = board.total || 0;
  const byId = new Map((board.items || []).map((row) => [row.id, row]));
  const byName = new Map((board.items || []).map((row) => [String(row.name || "").toLowerCase(), row]));
  for (const w of state.wards) {
    const row = (w.apiId && byId.get(w.apiId)) || byName.get(String(w.name || "").toLowerCase());
    if (!row) continue;
    w.apiId = row.id;
    w.apiBedTotal = row.bed_total;
    w.apiOccupied = row.occupied;
    w.apiFree = row.free;
    if (row.bed_total > 0) w.bedCount = row.bed_total;
  }
  return board;
}

export async function syncStructureToApi(state, ui, helpers) {
  const { bedCount, persist } = helpers;
  const structure = await apiJson("/api/structure");
  const byName = new Map((structure.wards || []).map((w) => [String(w.name || "").toLowerCase(), w]));
  let buildingId = structure.buildings?.[0]?.id;
  let departmentId = structure.departments?.[0]?.id;
  if (!buildingId) {
    buildingId = (await apiJson("/api/buildings", { method: "POST", body: JSON.stringify({ name: "Pavilion principal" }) })).id;
  }
  if (!departmentId) {
    departmentId = (await apiJson("/api/departments", {
      method: "POST",
      body: JSON.stringify({ buildingId, name: "Clinic", kind: "clinical" })
    })).id;
  }
  for (const w of state.wards) {
    let apiWard = byName.get(String(w.name || "").toLowerCase());
    if (!apiWard) {
      const created = await apiJson("/api/wards", {
        method: "POST",
        body: JSON.stringify({ departmentId, name: w.name, specialty: w.name })
      });
      apiWard = { id: created.id, name: w.name };
      byName.set(String(w.name || "").toLowerCase(), apiWard);
      const room = await apiJson("/api/rooms", {
        method: "POST",
        body: JSON.stringify({ wardId: created.id, name: "Salon 1" })
      });
      const beds = bedCount(w);
      for (let i = 1; i <= beds; i++) {
        await apiJson("/api/beds", {
          method: "POST",
          body: JSON.stringify({ roomId: room.id, label: `Pat ${i}` })
        });
      }
    }
    w.apiId = apiWard.id;
  }
  await hydrateBoardOccupancy(state, ui);
  persist();
  ui.platformNote = "Structura din foaie este legată de baza clinică. Ocuparea vine din /api/board.";
}
