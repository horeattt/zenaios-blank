export async function apiJson(url, options = {}) {
  const response = await fetch(url, {
    credentials: "include",
    headers: { "content-type": "application/json", ...(options.headers || {}) },
    ...options
  });
  const text = await response.text();
  const body = text ? JSON.parse(text) : {};
  if (!response.ok) throw new Error(body.message || `Eroare ${response.status}`);
  return body;
}
