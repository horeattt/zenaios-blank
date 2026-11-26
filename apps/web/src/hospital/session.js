import { apiJson } from "./api.js";

export async function ensureSession() {
  try {
    return await apiJson("/api/auth/me");
  } catch {
    return apiJson("/api/auth/open", { method: "POST", body: "{}" });
  }
}
