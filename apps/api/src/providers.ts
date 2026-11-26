export const PROVIDER_HOSTS = {
  openai: "api.openai.com",
  anthropic: "api.anthropic.com",
  xai: "api.x.ai",
  google: "generativelanguage.googleapis.com"
} as const;

export type ProviderName = keyof typeof PROVIDER_HOSTS;

export type ProbeRequest = {
  url: string;
  method: "GET";
  headerNames: string[];
};

const BLOCKED = /^(localhost|.*\.local|.*\.internal)$/i;
const IP = /^(?:\d{1,3}\.){3}\d{1,3}$|^\[?[0-9a-f:]+\]?$/i;

export function assertAllowedHost(provider: ProviderName, host: string): void {
  const expected = PROVIDER_HOSTS[provider];
  const normalized = host.trim().toLowerCase();
  if (normalized !== expected || BLOCKED.test(normalized) || IP.test(normalized) || normalized.includes("/") || normalized.includes("@")) {
    throw Object.assign(new Error("Endpoint-ul nu este în lista de furnizori aprobați."), { statusCode: 422 });
  }
}

export function buildProbe(provider: ProviderName): ProbeRequest {
  const host = PROVIDER_HOSTS[provider];
  if (provider === "google") {
    return { url: `https://${host}/v1beta/models`, method: "GET", headerNames: ["x-goog-api-key"] };
  }
  if (provider === "anthropic") {
    return { url: `https://${host}/v1/models`, method: "GET", headerNames: ["authorization", "anthropic-version"] };
  }
  return { url: `https://${host}/v1/models`, method: "GET", headerNames: ["authorization"] };
}

export async function probeProvider(input: {
  provider: ProviderName;
  apiKey: string;
  organization?: string | null;
  projectId?: string | null;
  timeoutMs: number;
}): Promise<{ ok: boolean; status: number; error?: string }> {
  const probe = buildProbe(input.provider);
  const headers: Record<string, string> = {};
  if (input.provider === "google") headers["x-goog-api-key"] = input.apiKey;
  else headers.authorization = `Bearer ${input.apiKey}`;
  if (input.provider === "anthropic") headers["anthropic-version"] = "2023-06-01";
  if (input.provider === "openai" && input.organization) headers["OpenAI-Organization"] = input.organization;
  if (input.provider === "openai" && input.projectId) headers["OpenAI-Project"] = input.projectId;
  try {
    const response = await fetch(probe.url, {
      method: "GET",
      headers,
      signal: AbortSignal.timeout(input.timeoutMs)
    });
    return { ok: response.ok, status: response.status };
  } catch {
    return { ok: false, status: 0, error: "unreachable" };
  }
}
