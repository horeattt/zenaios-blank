export async function api<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    credentials: "include",
    headers: { "content-type": "application/json", ...(options?.headers ?? {}) },
    ...options
  });
  const text = await response.text();
  const body = text ? JSON.parse(text) as T & { message?: string } : {} as T;
  if (!response.ok) throw new Error((body as { message?: string }).message ?? `Eroare ${response.status}`);
  return body;
}
