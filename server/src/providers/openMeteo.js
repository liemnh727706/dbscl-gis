// Open-Meteo: du bao mua cho DBSCL - mien phi, khong can API key
// https://open-meteo.com/en/docs
const POINTS = [
  { id: "can_tho", name: "Cần Thơ", lat: 10.03, lon: 105.78 },
  { id: "my_tho", name: "Mỹ Tho", lat: 10.36, lon: 106.36 },
  { id: "ca_mau", name: "Cà Mau", lat: 9.18, lon: 105.15 },
  { id: "rach_gia", name: "Rạch Giá", lat: 9.83, lon: 105.10 },
  { id: "chau_doc", name: "Châu Đốc", lat: 10.70, lon: 105.11 },
  { id: "ben_tre", name: "Bến Tre", lat: 10.23, lon: 106.37 },
];

export async function fetchRainfall() {
  const lats = POINTS.map((p) => p.lat).join(",");
  const lons = POINTS.map((p) => p.lon).join(",");
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${lats}&longitude=${lons}` +
    `&daily=precipitation_sum&hourly=precipitation&forecast_days=3&timezone=Asia%2FBangkok`;
  const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error(`open-meteo ${res.status}`);
  const data = await res.json();
  const arr = Array.isArray(data) ? data : [data];
  const points = POINTS.map((p, i) => ({
    ...p,
    rain_today_mm: arr[i]?.daily?.precipitation_sum?.[0] ?? null,
    rain_3day_mm: (arr[i]?.daily?.precipitation_sum || [])
      .slice(0, 3)
      .reduce((a, b) => a + (b || 0), 0),
  }));
  const valid = points.filter((p) => p.rain_today_mm != null);
  const avg = valid.length
    ? valid.reduce((a, p) => a + p.rain_today_mm, 0) / valid.length
    : null;
  return { source: "open-meteo", fetched: new Date().toISOString(), points, avg_rain_mm_day: avg };
}
