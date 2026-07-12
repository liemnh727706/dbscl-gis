// Goi Modeling API (Python/FastAPI)
const BASE = process.env.MODEL_API_URL || "http://localhost:8000";

export async function modelGet(path) {
  const res = await fetch(`${BASE}${path}`, { signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error(`model-api GET ${path}: ${res.status}`);
  return res.json();
}

export async function modelPost(path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(300000), // chay mo phong co the mat vai phut
  });
  if (!res.ok) throw new Error(`model-api POST ${path}: ${res.status} ${await res.text()}`);
  return res.json();
}
