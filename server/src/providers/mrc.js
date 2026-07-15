// MRC (Mekong River Commission) - muc nuoc song Mekong THOI GIAN THUC
// API telemetry cong khai cua cong giam sat https://monitoring.mrcmekong.org
// (cap nhat 15 phut/lan, ~80 tram tu Trung Quoc toi DBSCL).
//   GET {MRC_API_URL}/stations -> [{stationId, name, river, country,
//                                   waterLevel, lastMeasurement, ...}]
// Doi endpoint bang bien moi truong MRC_API_URL neu MRC thay doi duong dan.
const MRC_URL =
  process.env.MRC_API_URL ||
  "https://api.mrcmekong.org/api/v1/time-series/telemetry/recent";

// Tram then chot cho DBSCL (id MRC -> khoa noi bo)
const KEY_STATIONS = {
  "019803": "tan_chau",   // Song Tien - cua ngo dong chay vao dong bang
  "039801": "chau_doc",   // Song Hau
  "039803": "can_tho",    // Song Hau giua dong bang
  "019804": "my_thuan",   // Song Tien giua dong bang
  "985203": "vam_kenh",   // cua Tieu (trieu)
  "981702": "tra_vinh",   // Co Chien
  "039812": "dai_ngai",   // Song Hau gan cua
  "908001": "cho_lach",   // Ham Luong
  "014901": "kratie",     // Campuchia - tin hieu lu thuong nguon som
  "019806": "neak_luong", // Campuchia - ha luu Phnom Penh
};

const clamp = (v, lo, hi) => Math.min(Math.max(v, lo), hi);

// Nghich dao quan he mua trong synthetic.js (tan_chau = 1.2 + 3.1*flood,
// chau_doc = 1.1 + 2.7*flood; q_factor = 1 + 3.5*flood) de suy he so dong
// chay thuong nguon TU MUC NUOC THUC DO thay vi chi theo lich mua.
function qFactorFromLevels(st) {
  const est = [];
  if (st.tan_chau) est.push(clamp((st.tan_chau.wl_m - 1.2) / 3.1, 0, 1.3));
  if (st.chau_doc) est.push(clamp((st.chau_doc.wl_m - 1.1) / 2.7, 0, 1.3));
  if (!est.length) return null;
  const flood = est.reduce((a, b) => a + b, 0) / est.length;
  return +(1 + 3.5 * flood).toFixed(2);
}

export async function fetchMrcLevels() {
  try {
    const res = await fetch(`${MRC_URL}/stations`, {
      signal: AbortSignal.timeout(10000),
      headers: { accept: "application/json" },
    });
    if (!res.ok) return null;
    const all = await res.json();
    if (!Array.isArray(all)) return null;
    const stations = {};
    for (const s of all) {
      const key = KEY_STATIONS[s.stationId];
      if (key && s.waterLevel != null && isFinite(s.waterLevel)) {
        stations[key] = {
          id: s.stationId, name: s.name, river: s.river,
          wl_m: +Number(s.waterLevel).toFixed(2),
          time: s.lastMeasurement,
        };
      }
    }
    // Khong co tram cua ngo nao -> coi nhu nguon khong dung duoc
    if (!stations.tan_chau && !stations.chau_doc) return null;
    return {
      source: "mrc-telemetry",
      fetched: new Date().toISOString(),
      stations,
      q_factor_obs: qFactorFromLevels(stations),
    };
  } catch {
    return null;
  }
}
