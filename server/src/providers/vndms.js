// Adapter VNDMS - He thong giam sat thien tai Viet Nam (Cuc QLDD & PCTT)
// https://vndms.gov.vn  (truoc day vndms.dmptc.gov.vn)
//
// KET QUA MO API NOI BO (2026-07, da kiem chung truc tiep):
//   - Cac lop "canh bao" tra ve GeoJSON diem tram, KHONG can key, nhung
//     CO KIEM TRA REFERER (goi tu trinh duyet/origin vndms.gov.vn moi 200;
//     server-to-server can dat header referer). Mau URL:
//       /warning_rain?lv1=&lv2=&types=   (mua)
//       /water_level?lv=1|2|3            (muc nuoc, theo cap bao dong)
//       /warning_wind, /nhietdo_kt ...
//     types: 1=Khi tuong 2=WeatherPlus 3=Vrain 4=Nhan dan(KTTV) 5=Thuy van
//            7=Cuc QLDD&PCTT
//   - Lop DO MAN ton tai trong chu giai (nhom "Canh bao do man >1/>4 permil",
//     nguon: Cuc QL&XDCT thuy loi, KTTV) NHUNG endpoint du lieu KHONG cong
//     khai: vang mat trong /LayerData/GetLayerDisplay va cac endpoint quan
//     trac tho (/LayerData/GetLayersData, /DuBaoHan/GetCTHT, /api/dskt-v2/*)
//     deu tra 401 Unauthorized. Ngoai ra lop man chi hoat dong MUA KHO (12-5).
//
// => Provider nay:
//   * Da CO SAN parser GeoJSON tram VNDMS (shape that: label, latitude,
//     longtitude, popupInfo chua "Ma tram" va gia tri do).
//   * Kich hoat nguon man khi dat VNDMS_SALINITY_URL (endpoint mua kho / ban
//     cap quyen). Vi route la noi bo/theo mua nen KHONG hardcode - de cau
//     hinh. Co the kem VNDMS_TOKEN cho endpoint can dang nhap.
//   * Fallback null -> he thong dung mo hinh synthetic nhu cu.

const SAL_URL = process.env.VNDMS_SALINITY_URL || null;
const TOKEN = process.env.VNDMS_TOKEN || null;
const REFERER = process.env.VNDMS_REFERER || "https://vndms.gov.vn/";

// Trich so thuc (float) tu chuoi popup: "Do man: <b>5.2 g/l</b>" / "4.1 ‰"
function extractSalinity(html) {
  if (!html) return null;
  const m = html.match(/([\d.]+)\s*(?:g\/l|‰|per\s*mil|g\.l)/i);
  return m ? Number(m[1]) : null;
}
function extractField(html, label) {
  if (!html) return null;
  const re = new RegExp(label + "\\s*:\\s*<b>\\s*([^<]+?)\\s*<", "i");
  const m = html.match(re);
  return m ? m[1].trim() : null;
}

// GeoJSON FeatureCollection tram VNDMS -> [{station_id, name, lat, lon,
// salinity_gl?, place, time}]
export function parseVndmsGeoJSON(fc, { valueKind = "salinity" } = {}) {
  const feats = (fc && fc.features) || [];
  const out = [];
  for (const f of feats) {
    const p = f.properties || {};
    const [lon, lat] = (f.geometry && f.geometry.coordinates) || [];
    const html = p.popupInfo || "";
    const rec = {
      station_id: extractField(html, "Mã trạm") || p.id || null,
      name: p.label || extractField(html, "Tên trạm") || null,
      lat: p.latitude ?? lat ?? null,
      lon: p.longtitude ?? p.longitude ?? lon ?? null, // luu y: VNDMS go "longtitude"
      place: extractField(html, "Địa điểm"),
      time: p.time || new Date().toISOString(),
    };
    if (valueKind === "salinity") rec.salinity_gl = extractSalinity(html);
    out.push(rec);
  }
  return out;
}

async function fetchGeoJSON(url) {
  const headers = { "x-requested-with": "XMLHttpRequest", referer: REFERER };
  if (TOKEN) headers.authorization = `Bearer ${TOKEN}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(10000), headers });
  if (!res.ok) throw new Error(`vndms ${res.status}`);
  return res.json();
}

// Do man tram VNDMS (mua kho / khi cau hinh endpoint). Tra ve danh sach tram
// co salinity_gl != null, hoac null neu chua cau hinh / khong co du lieu.
export async function fetchVndmsSalinity() {
  if (!SAL_URL) return null;
  try {
    const fc = await fetchGeoJSON(SAL_URL);
    const stations = parseVndmsGeoJSON(fc, { valueKind: "salinity" })
      .filter((s) => s.salinity_gl != null && isFinite(s.salinity_gl));
    if (!stations.length) return null;
    return { source: "vndms-salinity", fetched: new Date().toISOString(), stations };
  } catch {
    return null;
  }
}
