// Adapter du lieu KTTV / do man tram thuc do cho hieu chinh mo hinh man.
//
// Thu tu uu tien nguon:
//   1. VNDMS (Cuc QLDD & PCTT) - neu dat VNDMS_SALINITY_URL (xem vndms.js).
//   2. Nguon KTTV chinh thuc - neu duoc cap (Dai KTTV Nam Bo cung cap qua
//      hop dong dich vu; khong co API cong khai). Dat:
//        KTTV_API_URL   : endpoint tra JSON/GeoJSON
//        KTTV_API_KEY   : khoa xac thuc (Bearer, neu can)
//      parse() ben duoi TU NHAN DANG nhieu dinh dang pho bien nen thuong
//      cam-la-chay; chi cần chỉnh khi nguồn dùng tên trường la.
//
// Khong co nguon nao -> tra null, he thong dung mo hinh man synthetic.
import { fetchVndmsSalinity } from "./vndms.js";

const KTTV_URL = process.env.KTTV_API_URL;
const KTTV_KEY = process.env.KTTV_API_KEY;

export async function fetchKttv() {
  // 1) VNDMS (uu tien - nguon quoc gia, chuan hoa san)
  const vndms = await fetchVndmsSalinity().catch(() => null);
  if (vndms) return { ...vndms, source: "kttv:vndms" };

  // 2) Nguon KTTV chinh thuc duoc cap quyen
  if (!KTTV_URL) return null;
  try {
    const res = await fetch(KTTV_URL, {
      signal: AbortSignal.timeout(8000),
      headers: KTTV_KEY ? { authorization: `Bearer ${KTTV_KEY}` } : {},
    });
    if (!res.ok) return null;
    const data = await res.json();
    const stations = normalize(data);
    if (!stations.length) return null;
    return { source: "kttv", fetched: new Date().toISOString(), stations };
  } catch {
    return null;
  }
}

// ---- Chuan hoa linh hoat ------------------------------------------------
// Nhan: mang [...], {data:[...]}/{stations:[...]}/{result:[...]}, hoac
// GeoJSON FeatureCollection. Tra ve [{station_id,name,lat,lon,
// salinity_gl,water_level_m,time}] voi cac truong co the null.
const num = (v) => {
  if (v == null) return null;
  const n = Number(String(v).replace(",", "."));
  return isFinite(n) ? n : null;
};
const pick = (o, keys) => {
  for (const k of keys) {
    for (const kk of Object.keys(o)) {
      if (kk.toLowerCase() === k) return o[kk];
    }
  }
  return undefined;
};

function toRows(data) {
  if (Array.isArray(data)) return data;
  if (!data || typeof data !== "object") return [];
  if (Array.isArray(data.features)) // GeoJSON
    return data.features.map((f) => ({
      ...(f.properties || {}),
      _lon: f.geometry?.coordinates?.[0],
      _lat: f.geometry?.coordinates?.[1],
    }));
  return data.data || data.stations || data.result || data.items || [];
}

function normalize(data) {
  const rows = toRows(data);
  const out = [];
  for (const r of rows) {
    if (!r || typeof r !== "object") continue;
    const sal = num(pick(r, ["salinity_gl", "salinity", "do_man", "doman",
      "dman", "man", "salt", "sal", "ec_salinity"]));
    const wl = num(pick(r, ["water_level_m", "water_level", "muc_nuoc",
      "mucnuoc", "wl", "level", "h"]));
    const lat = num(pick(r, ["lat", "latitude", "vido", "vi_do", "y"])) ?? num(r._lat);
    const lon = num(pick(r, ["lon", "lng", "long", "longitude", "longtitude",
      "kinhdo", "kinh_do", "x"])) ?? num(r._lon);
    const name = pick(r, ["name", "ten", "ten_tram", "station_name", "label"]) || null;
    const id = pick(r, ["station_id", "id", "ma_tram", "matram", "code"]) || null;
    const time = pick(r, ["time", "date", "datetime", "thoi_gian", "ngay", "d"])
      || new Date().toISOString();
    // chi giu ban ghi co it nhat 1 gia tri do (man hoac muc nuoc)
    if (sal == null && wl == null) continue;
    out.push({
      station_id: id, name, lat, lon,
      salinity_gl: sal, water_level_m: wl, time: String(time),
    });
  }
  return out;
}
