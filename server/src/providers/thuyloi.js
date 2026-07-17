// Adapter CSDL Thuy loi Viet Nam (Cuc Thuy loi) - Data Warehouse
// https://thuyloivietnam.gov.vn/dwh  -> GeoServer cong khai:
//   https://gs.vbeta.net/geoserver/dubaonguonnuoc
//
// KET QUA MO (2026-07, kiem chung truc tiep, KHONG can key):
//   WFS GetFeature -> GeoJSON. Cac lop dung duoc:
//   - tramdomnnoidongscl : 115 tram DO MAN noi dong DBSCL (ten, ma KTTV that
//       vd H39.KTTV.MN005, toa do), truong `mnhientai` = do man hien tai
//       (g/l) - populated mua kho (12-5), null mua lu.
//   - xnm_ranhmandubao / xmn_ranhmanhientrang : ranh man du bao / hien trang
//       (MultiLineString) - lop ban do chinh thuc.
//   - tramdotudong (472), tramthuyvan : tram muc nuoc/mua.
//
// Day la nguon DO MAN cong khai tot nhat (chinh thuc, toan DBSCL, GeoJSON,
// khong auth). Doi endpoint bang THUYLOI_WFS_URL neu GeoServer chuyen domain.

const WFS_BASE = process.env.THUYLOI_WFS_URL ||
  "https://gs.vbeta.net/geoserver/dubaonguonnuoc/wfs";
const SAL_LAYER = process.env.THUYLOI_SALINITY_LAYER ||
  "dubaonguonnuoc:tramdomnnoidongscl";

// Khung DBSCL de loc nhieu (mot so tram catalog nam ngoai, vd Bien Ho - CPC)
const IN_DELTA = (lon, lat) =>
  lon > 104 && lon < 107.6 && lat > 8 && lat < 11.6;

const num = (v) => {
  if (v == null) return null;
  const n = Number(String(v).replace(",", "."));
  return isFinite(n) ? n : null;
};

function wfsUrl(layer) {
  const q = new URLSearchParams({
    service: "WFS", version: "2.0.0", request: "GetFeature",
    typeNames: layer, outputFormat: "application/json", srsName: "EPSG:4326",
  });
  return `${WFS_BASE}?${q.toString()}`;
}

// GeoJSON tram do man -> [{station_id, name, lat, lon, salinity_gl, time}]
// Chi giu tram trong khung DBSCL; salinity_gl lay tu mnhientai (null mua lu).
export function parseSalinityStations(fc) {
  const feats = (fc && fc.features) || [];
  const out = [];
  for (const f of feats) {
    const p = f.properties || {};
    const c = f.geometry && f.geometry.coordinates;
    const lon = num(p.x) ?? (c ? num(c[0]) : null);
    const lat = num(p.y) ?? (c ? num(c[1]) : null);
    if (lon == null || lat == null || !IN_DELTA(lon, lat)) continue;
    out.push({
      station_id: p.ma || String(p.stt ?? ""),
      name: p.tram || null,
      lat, lon,
      salinity_gl: num(p.mnhientai),
      subregion: p.tieuvung || p.mavung || null,
      time: p.thoigian || p.ngaycapnhat || new Date().toISOString(),
    });
  }
  return out;
}

async function fetchGeoJSON(url) {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(12000),
    headers: { accept: "application/json" },
  });
  if (!res.ok) throw new Error(`geoserver ${res.status}`);
  return res.json();
}

// Danh sach tram do man DBSCL (toa do + do man hien tai). Luon tra ve mang
// tram (kem toa do) - phuc vu ca lam DANH MUC TRAM; truong salinity_gl chi
// khac null vao mua kho. Tra null neu GeoServer loi.
export async function fetchThuyloiSalinity() {
  try {
    const fc = await fetchGeoJSON(wfsUrl(SAL_LAYER));
    const stations = parseSalinityStations(fc);
    if (!stations.length) return null;
    const withVal = stations.filter((s) => s.salinity_gl != null);
    return {
      source: "thuyloi-dwh",
      fetched: new Date().toISOString(),
      station_count: stations.length,
      measured_count: withVal.length,     // 0 vao mua lu
      stations,
    };
  } catch {
    return null;
  }
}
