// Adapter du lieu KTTV / do man tram thuc do cho hieu chinh mo hinh man.
//
// Thu tu uu tien nguon:
//   1. VNDMS (Cuc QLDD & PCTT) - neu dat VNDMS_SALINITY_URL (xem vndms.js).
//      Day la diem gom tram man tot nhat ca nuoc, cap nhat gan realtime,
//      hoat dong mua kho (12-5).
//   2. Nguon KTTV rieng - neu duoc cap: dat KTTV_API_URL (+ KTTV_API_KEY).
//      Dinh dang mong doi: [{ station_id, name, lat, lon, salinity_gl, time }]
//
// Khong co nguon nao -> tra null, he thong dung mo hinh man synthetic.
import { fetchVndmsSalinity } from "./vndms.js";

const KTTV_URL = process.env.KTTV_API_URL;
const KTTV_KEY = process.env.KTTV_API_KEY;

export async function fetchKttv() {
  // 1) VNDMS (uu tien - nguon quoc gia, chuan hoa san)
  const vndms = await fetchVndmsSalinity().catch(() => null);
  if (vndms) return { ...vndms, source: "kttv:vndms" };

  // 2) Nguon KTTV rieng duoc cap quyen
  if (!KTTV_URL) return null;
  try {
    const res = await fetch(KTTV_URL, {
      signal: AbortSignal.timeout(8000),
      headers: KTTV_KEY ? { authorization: `Bearer ${KTTV_KEY}` } : {},
    });
    if (!res.ok) return null;
    const data = await res.json();
    const stations = parse(data);
    if (!stations.length) return null;
    return { source: "kttv", fetched: new Date().toISOString(), stations };
  } catch {
    return null;
  }
}

function parse(data) {
  // Chinh lai theo cau truc JSON thuc te cua nguon KTTV duoc cap
  return Array.isArray(data) ? data : data.stations || [];
}
