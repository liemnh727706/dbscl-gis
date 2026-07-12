// Adapter du lieu KTTV Viet Nam (Tong cuc Khi tuong Thuy van / Dai KTTV Nam Bo)
// Khong co API cong khai - cau hinh qua bien moi truong khi co nguon truy cap:
//   KTTV_API_URL   : endpoint tra JSON
//   KTTV_API_KEY   : khoa xac thuc (neu can)
// Dinh dang mong doi (tuy bien lai ham parse() theo nguon thuc te):
//   [{ station_id, name, lat, lon, water_level_m?, salinity_gl?, time }]
const KTTV_URL = process.env.KTTV_API_URL;
const KTTV_KEY = process.env.KTTV_API_KEY;

export async function fetchKttv() {
  if (!KTTV_URL) return null;
  try {
    const res = await fetch(KTTV_URL, {
      signal: AbortSignal.timeout(8000),
      headers: KTTV_KEY ? { authorization: `Bearer ${KTTV_KEY}` } : {},
    });
    if (!res.ok) return null;
    const data = await res.json();
    return { source: "kttv", fetched: new Date().toISOString(), stations: parse(data) };
  } catch {
    return null;
  }
}

function parse(data) {
  // TODO: chinh lai theo cau truc JSON thuc te cua nguon KTTV duoc cap
  return Array.isArray(data) ? data : data.stations || [];
}
