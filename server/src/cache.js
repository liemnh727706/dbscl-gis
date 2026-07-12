// Cache trong bo nho don gian, TTL theo giay
const store = new Map();
const TTL = Number(process.env.CACHE_TTL_SECONDS || 600);

export async function cached(key, fn, ttl = TTL) {
  const hit = store.get(key);
  if (hit && Date.now() - hit.at < ttl * 1000) return hit.value;
  const value = await fn();
  store.set(key, { value, at: Date.now() });
  return value;
}
