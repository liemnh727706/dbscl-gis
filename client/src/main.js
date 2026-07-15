import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";

// ===================== Trang thai ung dung =====================
const state = {
  mode: "realtime",       // realtime | custom | scenario
  meta: null,             // metadata run hien tai (times, files, tile template)
  salinity: null,         // ket qua do man hien tai
  t: 0,                   // chi so buoc thoi gian
  playing: false,
  playTimer: null,
  userMarker: null,
  scenarios: [],
  forecast: null,         // ket qua du bao man nhieu ngay
  fcDay: 0,               // ngay dang xem trong du bao
  zoneLevel: "off",       // ranh gioi hanh chinh: off | province | commune
  zoneMetric: "flood",    // to mau ranh gioi theo: flood | salt
  radar: {                // lop anh radar mua RainViewer
    host: null,
    frames: [],           // [{time, path, kind:"past"|"nowcast"}]
    i: 0,                 // frame dang hien
    playing: false,
    timer: null,
    refreshTimer: null,
  },
};

const $ = (sel) => document.querySelector(sel);

// ===================== Style ban do nen =====================
// Nen vector OpenFreeMap (lieu du OpenMapTiles) de kiem soat NHAN hoan toan:
// - Uu tien ten tieng Viet (name:vi) cho moi nhan; khong ghep ten phi Latin
// - BO nhan bien/dai duong cua style goc (South China Sea...) va nhan dao
//   goc (island/islet/archipelago) -> thay bang bo nhan tieng Viet rieng
//   (VN_PLACES ben duoi), dam bao dao/quan dao CHI mang ten Viet Nam.
// Nen raster OSM cu khong lam duoc viec nay vi nhan ve san trong anh tile.
const OSM_RASTER_FALLBACK = {
  version: 8,
  // Font ho tro day du dau tieng Viet (da kiem tra range 7680-7935)
  glyphs: "https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf",
  sources: {
    osm: {
      type: "raster",
      tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
      tileSize: 256,
      attribution: "© OpenStreetMap contributors",
    },
  },
  layers: [{ id: "osm", type: "raster", source: "osm" }],
};

function vietnamizeStyle(style) {
  const NAME_VI = ["coalesce",
    ["get", "name:vi"], ["get", "name:latin"], ["get", "name"]];
  // Bo toan bo nhan ten bien/song ho dang diem cua style goc
  style.layers = style.layers.filter((l) => l["source-layer"] !== "water_name");
  for (const l of style.layers) {
    if (!l.layout || !l.layout["text-field"]) continue;
    l.layout["text-field"] = NAME_VI;
    // label_other gom cac place ngoai city/town/village... -> loai dao
    if (l.id === "label_other")
      l.filter = ["all", l.filter,
        ["match", ["get", "class"],
          ["island", "islet", "archipelago"], false, true]];
  }
  return style;
}

async function buildStyle() {
  try {
    const res = await fetch("https://tiles.openfreemap.org/styles/liberty");
    if (!res.ok) throw new Error(`style ${res.status}`);
    return vietnamizeStyle(await res.json());
  } catch {
    return OSM_RASTER_FALLBACK; // mat mang -> van chay duoc voi nen raster
  }
}

const BASE_STYLE = await buildStyle();
window._baseStyle = BASE_STYLE; // debug console

// ===================== Khoi tao ban do =====================
const map = new maplibregl.Map({
  container: "map",
  center: [105.95, 10.05],  // DBSCL + luu vuc Sai Gon - Dong Nai
  zoom: 7.3,
  style: BASE_STYLE,
});
map.addControl(new maplibregl.NavigationControl(), "top-right");
map.addControl(new maplibregl.ScaleControl({ unit: "metric" }));

// Nut phong to toan canh Viet Nam & Bien Dong (thay Hoang Sa, Truong Sa)
map.addControl({
  onAdd() {
    const div = document.createElement("div");
    div.className = "maplibregl-ctrl maplibregl-ctrl-group";
    const btn = document.createElement("button");
    btn.textContent = "🇻🇳";
    btn.title = "Toàn cảnh Việt Nam & Biển Đông (Hoàng Sa, Trường Sa)";
    btn.onclick = () =>
      map.fitBounds([[101.5, 7.0], [117.8, 17.8]], { padding: 20 });
    div.appendChild(btn);
    return div;
  },
  onRemove() {},
}, "top-right");
window._map = map; // debug console

// Style san sang (da phan tich xong JSON) la du de addSource/addLayer -
// KHONG cho isStyleLoaded() vi no doi ca tile nen OSM (mang cham/bi chan
// se treo vinh vien). styledata ban ra ngay sau khi style noi tuyen duoc nap.
let styleReady = false;
map.on("styledata", () => { styleReady = true; });
function whenStyleReady(fn) {
  if (styleReady || map.isStyleLoaded()) fn();
  else map.once("styledata", () => fn());
}

// ============ Dia danh Viet Nam: bien dao, quan dao ============
// Nhan tieng Viet luon hien thi tren moi lop, theo the hien ban do Viet Nam:
// quan dao Hoang Sa (TP. Da Nang), quan dao Truong Sa (tinh Khanh Hoa).
const pt = (lon, lat, name, kind) => ({
  type: "Feature",
  geometry: { type: "Point", coordinates: [lon, lat] },
  properties: { name, kind },
});

const VN_PLACES = {
  type: "FeatureCollection",
  features: [
    // ----- Bien -----
    pt(110.30, 13.40, "BIỂN ĐÔNG", "sea"),
    pt(102.75, 9.10, "VỊNH THÁI LAN", "sea"),
    // ----- Quan dao lon (luon hien) -----
    pt(112.0, 16.40, "Quần đảo Hoàng Sa\n(TP. Đà Nẵng, Việt Nam)", "arch"),
    pt(113.80, 9.60, "Quần đảo Trường Sa\n(Tỉnh Khánh Hòa, Việt Nam)", "arch"),
    // ----- Dao ven bo (hien tu mot muc zoom vua) -----
    pt(103.96, 10.22, "Đảo Phú Quốc", "island"),
    pt(106.60, 8.69, "Côn Đảo", "island"),
    pt(103.48, 9.30, "Quần đảo Thổ Chu", "island"),
    pt(104.35, 9.68, "Quần đảo Nam Du", "island"),
    pt(104.63, 9.80, "Hòn Sơn (Lại Sơn)", "island"),
    pt(104.85, 9.97, "Hòn Tre (Kiên Hải)", "island"),
    pt(104.58, 10.18, "Quần đảo Bà Lụa", "island"),
    pt(104.33, 10.32, "Quần đảo Hải Tặc", "island"),
    pt(104.83, 8.43, "Hòn Khoai", "island"),
    pt(104.50, 8.95, "Hòn Chuối", "island"),
    pt(108.93, 10.52, "Đảo Phú Quý", "island"),
    pt(109.30, 12.22, "Đảo Hòn Tre (Nha Trang)", "island"),
    pt(109.35, 13.61, "Cù Lao Xanh", "island"),
    pt(109.11, 15.38, "Đảo Lý Sơn", "island"),
    pt(108.51, 15.95, "Cù Lao Chàm", "island"),
    pt(107.34, 17.16, "Đảo Cồn Cỏ", "island"),
    // ----- Cac dao thuoc quan dao Hoang Sa -----
    pt(112.33, 16.84, "Đảo Phú Lâm", "isle"),
    pt(111.61, 16.53, "Đảo Hoàng Sa", "isle"),
    pt(112.73, 16.66, "Đảo Linh Côn", "isle"),
    pt(111.19, 15.78, "Đảo Tri Tôn", "isle"),
    pt(111.51, 16.45, "Đảo Quang Ảnh", "isle"),
    // ----- Cac dao/da thuoc quan dao Truong Sa -----
    pt(111.92, 8.64, "Đảo Trường Sa (Trường Sa Lớn)", "isle"),
    pt(114.33, 11.43, "Đảo Song Tử Tây", "isle"),
    pt(114.32, 9.88, "Đảo Sinh Tồn", "isle"),
    pt(114.37, 10.18, "Đảo Nam Yết", "isle"),
    pt(114.47, 10.37, "Đảo Sơn Ca", "isle"),
    pt(112.92, 7.87, "Đảo An Bang", "isle"),
    pt(112.88, 9.55, "Đá Chữ Thập", "isle"),
    pt(113.85, 10.05, "Đá Lớn", "isle"),
  ],
};

function addVietnamLabels() {
  if (map.getSource("vn-places")) return;
  map.addSource("vn-places", { type: "geojson", data: VN_PLACES });
  // Cham dao (lop duoi cung cua nhom nhan - cac lop khac chen ben duoi no)
  map.addLayer({
    id: "vn-islands", type: "circle", source: "vn-places",
    filter: ["in", ["get", "kind"], ["literal", ["isle", "island"]]],
    paint: {
      "circle-radius": ["case", ["==", ["get", "kind"], "isle"], 2.5, 3.5],
      "circle-color": "#c99b3f",
      "circle-stroke-color": "#ffffff", "circle-stroke-width": 1,
    },
  });
  // Ten bien (chu hoa, xanh bien)
  map.addLayer({
    id: "vn-labels-sea", type: "symbol", source: "vn-places",
    filter: ["==", ["get", "kind"], "sea"],
    layout: {
      "text-field": ["get", "name"],
      "text-font": ["Noto Sans Bold"],
      "text-size": 15, "text-letter-spacing": 0.25,
    },
    paint: {
      "text-color": "#3573b9",
      "text-halo-color": "rgba(255,255,255,0.85)", "text-halo-width": 1.5,
    },
  });
  // Quan dao (dam, kem don vi hanh chinh) + dao ven bo
  map.addLayer({
    id: "vn-labels", type: "symbol", source: "vn-places",
    filter: ["in", ["get", "kind"], ["literal", ["arch", "island"]]],
    layout: {
      "text-field": ["get", "name"],
      "text-font": ["case", ["==", ["get", "kind"], "arch"],
        ["literal", ["Noto Sans Bold"]], ["literal", ["Noto Sans Regular"]]],
      "text-size": ["case", ["==", ["get", "kind"], "arch"], 13, 11.5],
      "text-offset": [0, 0.8], "text-anchor": "top",
      "text-allow-overlap": false,
    },
    paint: {
      "text-color": "#1a3c5e",
      "text-halo-color": "rgba(255,255,255,0.9)", "text-halo-width": 1.6,
    },
  });
  // Tung dao/da thuoc Hoang Sa, Truong Sa - hien khi phong to vao quan dao
  map.addLayer({
    id: "vn-labels-isle", type: "symbol", source: "vn-places",
    filter: ["==", ["get", "kind"], "isle"],
    minzoom: 6,
    layout: {
      "text-field": ["get", "name"],
      "text-font": ["literal", ["Noto Sans Regular"]],
      "text-size": 10.5,
      "text-offset": [0, 0.7], "text-anchor": "top",
      "text-allow-overlap": false,
    },
    paint: {
      "text-color": "#1a3c5e",
      "text-halo-color": "rgba(255,255,255,0.9)", "text-halo-width": 1.5,
    },
  });
}
whenStyleReady(addVietnamLabels);

// ===================== Lop anh phu ket qua (render PNG) =====================
// Anh PNG toan vung do modeling render (grid ~275 m nen tuong duong tile ve
// chi tiet, khong can TiTiler). Goc anh theo BBOX luoi tinh (engine/terrain.py).
const GRID_BOUNDS = [
  [104.4, 11.35], [107.45, 11.35], [107.45, 8.4], [104.4, 8.4],
];

// Chuyen "/data/outputs/..." trong metadata -> tham so file cua /api/render.png
const relOutput = (p) => p.replace(/^\/data\/outputs\//, "");

function renderUrl(tifPath, style, bust = "") {
  const q = new URLSearchParams({ file: relOutput(tifPath), style });
  if (bust) q.set("v", bust);
  return `/api/render.png?${q.toString()}`;
}

// Lop dau tien dang ton tai trong danh sach -> dung lam beforeId khi addLayer
const firstLayer = (ids) => ids.find((id) => map.getLayer(id));
const LAYER_ORDER_ABOVE_FLOOD = ["salt-zone", "zones-fill", "salt-segments", "vn-islands"];

function upsertImageLayer(id, url, { opacity, beforeIds }) {
  const src = map.getSource(id);
  if (src && typeof src.updateImage === "function") {
    src.updateImage({ url, coordinates: GRID_BOUNDS });
  } else {
    if (map.getLayer(id)) map.removeLayer(id);
    if (src) map.removeSource(id);
    map.addSource(id, { type: "image", url, coordinates: GRID_BOUNDS });
    map.addLayer(
      { id, type: "raster", source: id,
        paint: { "raster-opacity": opacity, "raster-fade-duration": 0 } },
      firstLayer(beforeIds),
    );
  }
}

// ===================== Lop radar mua RainViewer =====================
// Anh radar tong hop toan cau cua RainViewer (bao gom mang radar khi tuong
// Viet Nam), cap nhat ~10 phut/lan. Metadata: weather-maps.json liet ke cac
// khung "past" (da qua, ~2h) va "nowcast" (du bao ngoai suy 30-60'). Moi khung
// la mot bo tile PNG dong: {host}{path}/{size}/{z}/{x}/{y}/{color}/{opts}.png
const RADAR_API = "https://api.rainviewer.com/public/weather-maps.json";
const RADAR_COLOR = 4;   // bang mau "Universal Blue" - mua ro tren nen sang
const RADAR_TILE = 256;

function radarTileUrl(frame) {
  // smooth=1, snow=1: anh muot va tach tuyet; color 4 = universal blue
  return `${state.radar.host}${frame.path}/${RADAR_TILE}/{z}/{x}/{y}/${RADAR_COLOR}/1_1.png`;
}

async function loadRadar(auto = false) {
  try {
    const d = await (await fetch(RADAR_API)).json();
    state.radar.host = d.host;
    const past = (d.radar?.past || []).map((f) => ({ ...f, kind: "past" }));
    const now = (d.radar?.nowcast || []).map((f) => ({ ...f, kind: "nowcast" }));
    state.radar.frames = [...past, ...now];
    if (!state.radar.frames.length) throw new Error("khong co khung radar");
    const sl = $("#radar-slider");
    sl.max = state.radar.frames.length - 1;
    // Mac dinh dung o khung moi nhat da quan trac (cuoi danh sach "past")
    state.radar.i = Math.max(0, past.length - 1);
    sl.value = state.radar.i;
    if ($("#lyr-radar").checked) showRadarFrame(state.radar.i);
    else updateRadarTimeLabel();
    // Tu lam moi metadata moi 5 phut (nguon cap ~10')
    clearInterval(state.radar.refreshTimer);
    state.radar.refreshTimer = setInterval(() => loadRadar(true), 5 * 60 * 1000);
  } catch (e) {
    if (!auto) $("#radar-time").textContent = `Không tải được radar: ${e.message}`;
  }
}

function updateRadarTimeLabel() {
  const f = state.radar.frames[state.radar.i];
  if (!f) return;
  const t = new Date(f.time * 1000).toLocaleString("vi-VN", {
    hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" });
  const tag = f.kind === "nowcast"
    ? `<b style="color:#ce93d8">DỰ BÁO</b> ${t}`
    : (state.radar.i === lastPastIndex()
        ? `<b style="color:#81c784">MỚI NHẤT</b> ${t}`
        : `Quan trắc ${t}`);
  $("#radar-time").innerHTML = tag;
}

function lastPastIndex() {
  const arr = state.radar.frames;
  for (let i = arr.length - 1; i >= 0; i--) if (arr[i].kind === "past") return i;
  return arr.length - 1;
}

function showRadarFrame(i) {
  if (!styleReady) { whenStyleReady(() => showRadarFrame(i)); return; }
  const f = state.radar.frames[i];
  if (!f) return;
  state.radar.i = i;
  $("#radar-slider").value = i;
  const url = radarTileUrl(f);
  const src = map.getSource("radar");
  if (src && typeof src.setTiles === "function") {
    src.setTiles([url]);
  } else {
    if (map.getLayer("radar")) map.removeLayer("radar");
    if (src) map.removeSource("radar");
    map.addSource("radar", { type: "raster", tiles: [url], tileSize: RADAR_TILE });
    // Radar la lop thoi tiet truc tiep -> dat tren cung (duoi nhan dia danh)
    map.addLayer({
      id: "radar", type: "raster", source: "radar",
      paint: {
        "raster-opacity": Number($("#radar-opacity").value),
        "raster-fade-duration": 0,
      },
    }, firstLayer(["vn-labels-sea", "vn-labels"]));
  }
  map.setLayoutProperty("radar", "visibility",
    $("#lyr-radar").checked ? "visible" : "none");
  updateRadarTimeLabel();
}

function toggleRadar(on) {
  $("#radar-panel").classList.toggle("hidden", !on);
  if (on) {
    if (!state.radar.frames.length) loadRadar();
    else showRadarFrame(state.radar.i);
  } else {
    stopRadarAnim();
    if (map.getLayer("radar"))
      map.setLayoutProperty("radar", "visibility", "none");
  }
}

function stopRadarAnim() {
  state.radar.playing = false;
  clearTimeout(state.radar.timer);
  const b = $("#radar-play"); if (b) b.textContent = "▶";
}

function toggleRadarAnim() {
  state.radar.playing = !state.radar.playing;
  $("#radar-play").textContent = state.radar.playing ? "⏸" : "▶";
  clearTimeout(state.radar.timer);
  if (state.radar.playing) tickRadar();
}

function tickRadar() {
  const n = state.radar.frames.length;
  const next = (state.radar.i + 1) % n;
  showRadarFrame(next);
  // Nghi lau hon o khung cuoi cung (du bao xa nhat) truoc khi lap lai
  const delay = next === n - 1 ? 1400 : 500;
  state.radar.timer = setTimeout(tickRadar, delay);
}

function updateFloodLayer() {
  if (!state.meta) return;
  if (!styleReady) { whenStyleReady(updateFloodLayer); return; }
  const tif = state.meta.tile_path_template.replace(
    "{t:02d}", String(state.t).padStart(2, "0"));
  upsertImageLayer("flood", renderUrl(tif, "depth"), {
    opacity: Number($("#p-opacity").value),
    beforeIds: LAYER_ORDER_ABOVE_FLOOD,
  });
  map.setLayoutProperty("flood", "visibility",
    $("#lyr-flood").checked ? "visible" : "none");
  updateTimeLabel();
}

// ============ Choropleth theo don vi hanh chinh (tinh / xa) ============
async function loadZones() {
  if (state.zoneLevel === "off") { applyZoneStyle(); return; }
  try {
    const data = await (await fetch(`/api/zones?level=${state.zoneLevel}`)).json();
    if (data.error) throw new Error(data.error);
    if (map.getSource("zones")) {
      map.getSource("zones").setData(data);
    } else {
      map.addSource("zones", { type: "geojson", data });
      map.addLayer({
        id: "zones-fill", type: "fill", source: "zones",
        paint: { "fill-opacity": 0.62 },
      }, firstLayer(["salt-segments", "vn-islands"]));
      map.addLayer({
        id: "zones-line", type: "line", source: "zones",
        paint: { "line-color": "rgba(255,255,255,0.55)", "line-width": 0.6 },
      }, firstLayer(["salt-segments", "vn-islands"]));
      map.on("click", "zones-fill", (e) => {
        const p = e.features[0].properties;
        const title = p.district
          ? `${p.type || "Xã"} ${p.name} — ${p.district}, ${p.province}`
          : `${p.name}`;
        new maplibregl.Popup({ maxWidth: "320px" }).setLngLat(e.lngLat).setHTML(
          `<b>${title}</b><br/>
           🌊 Ngập: sâu nhất <b>${p.max_depth_m ?? "–"} m</b> · TB ${p.mean_depth_m ?? "–"} m · <b>${p.pct_flooded ?? "–"}%</b> diện tích<br/>
           🧂 Mặn: cao nhất <b>${p.max_salinity_gl ?? "–"} g/l</b> · TB ${p.mean_salinity_gl ?? "–"} g/l`,
        ).addTo(map);
      });
    }
  } catch { /* chua co mo phong / thieu ranh gioi -> bo qua */ }
  applyZoneStyle();
}

function applyZoneStyle() {
  if (!map.getLayer("zones-fill")) return;
  const vis = state.zoneLevel === "off" ? "none" : "visible";
  map.setLayoutProperty("zones-fill", "visibility", vis);
  map.setLayoutProperty("zones-line", "visibility", vis);
  const expr = state.zoneMetric === "salt"
    ? ["interpolate", ["linear"], ["coalesce", ["get", "max_salinity_gl"], 0],
       0, "rgba(46,125,50,0.10)", 0.5, "#9e9d24", 1, "#f9a825",
       4, "#ef6c00", 10, "#d32f2f", 20, "#7b1fa2"]
    : ["interpolate", ["linear"], ["coalesce", ["get", "pct_flooded"], 0],
       0, "rgba(255,255,255,0.03)", 10, "#c6dbef", 30, "#6baed6",
       60, "#2171b5", 100, "#08306b"];
  map.setPaintProperty("zones-fill", "fill-color", expr);
}

function updateTimeLabel() {
  const iso = state.meta?.times?.[state.t];
  $("#time-label").textContent = iso
    ? new Date(iso).toLocaleString("vi-VN", {
        hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" })
    : "—";
}

// ===================== Lop xam nhap man =====================
const SALT_COLORS = [
  0, "#2e7d32", 0.5, "#9e9d24", 1, "#f9a825", 4, "#ef6c00", 10, "#d32f2f", 20, "#7b1fa2",
];

function updateSalinityLayers() {
  if (!state.salinity) return;
  if (!styleReady) { whenStyleReady(updateSalinityLayers); return; }
  const seg = state.salinity.segments;
  const fronts = state.salinity.fronts;
  if (map.getSource("salt-segments")) {
    map.getSource("salt-segments").setData(seg);
    map.getSource("salt-fronts").setData(fronts);
  } else {
    map.addSource("salt-segments", { type: "geojson", data: seg });
    map.addLayer({
      id: "salt-segments", type: "line", source: "salt-segments",
      paint: {
        "line-width": 3.5,
        "line-color": ["interpolate", ["linear"], ["get", "salinity"], ...SALT_COLORS],
      },
    }, firstLayer(["vn-islands"]));
    map.addSource("salt-fronts", { type: "geojson", data: fronts });
    map.addLayer({
      id: "salt-fronts", type: "circle", source: "salt-fronts",
      filter: ["==", ["get", "threshold_gl"], 4],
      paint: {
        "circle-radius": 6, "circle-color": "#d32f2f",
        "circle-stroke-color": "#fff", "circle-stroke-width": 2,
      },
    }, firstLayer(["vn-islands"]));
    map.on("click", "salt-segments", (e) => {
      const p = e.features[0].properties;
      new maplibregl.Popup().setLngLat(e.lngLat)
        .setHTML(`<b>${p.river}</b><br/>Độ mặn ước tính: <b>${p.salinity} g/l</b><br/>Cách cửa sông: ${p.chainage_km} km`)
        .addTo(map);
    });
    map.on("click", "salt-fronts", (e) => {
      const p = e.features[0].properties;
      new maplibregl.Popup().setLngLat(e.lngLat)
        .setHTML(`<b>Ranh mặn 4 g/l</b><br/>${p.river}<br/>Vào sâu <b>${p.distance_km} km</b> từ cửa sông`)
        .addTo(map);
    });
  }
  const vis = $("#lyr-salt").checked ? "visible" : "none";
  map.setLayoutProperty("salt-segments", "visibility", vis);
  map.setLayoutProperty("salt-fronts", "visibility", vis);
}

// ===================== Lop raster vung anh huong man =====================
// To mau dai dat ven song theo do man (g/l) - thang mau render o modeling
// (engine/render.py, SALINITY_STEPS) trung voi mau duong song.
function updateZoneLayer(tifPath) {
  if (!tifPath) return;
  if (!styleReady) { whenStyleReady(() => updateZoneLayer(tifPath)); return; }
  // zone_latest.tif bi ghi de moi lan chay -> them nhan thoi gian de khong
  // dinh cache anh cu; file du bao co run_id rieng nen nhan rong cung on
  const bust = state.forecast?.created || state.salinity?.created || "";
  upsertImageLayer("salt-zone", renderUrl(tifPath, "salinity", bust), {
    opacity: 0.8,
    beforeIds: ["zones-fill", "salt-segments", "vn-islands"],
  });
  updateZoneVisibility();
}

function updateZoneVisibility() {
  if (map.getLayer("salt-zone"))
    map.setLayoutProperty("salt-zone", "visibility",
      $("#lyr-salt-zone").checked ? "visible" : "none");
}

// ===================== Du bao xam nhap man =====================
const FC_RIVERS = ["song_hau", "ham_luong", "co_chien", "vam_co", "song_saigon"];
const FC_COLORS = { song_hau: "#64b5f6", ham_luong: "#f9a825",
                    co_chien: "#ef6c00", vam_co: "#e57373",
                    song_saigon: "#ab47bc" };

async function runForecast() {
  const btn = $("#btn-forecast");
  btn.disabled = true;
  $("#fc-status").textContent = "⏳ Đang tính dự báo 10 ngày…";
  try {
    const res = await fetch("/api/salinity/forecast?days=10");
    if (!res.ok) throw new Error((await res.json()).error || res.status);
    state.forecast = await res.json();
    state.fcDay = 0;
    const sl = $("#fc-day");
    sl.max = state.forecast.dates.length - 1;
    sl.value = 0;
    $("#fc-body").classList.remove("hidden");
    $("#fc-status").innerHTML =
      `✅ ${state.forecast.dates.length} ngày · <span class="muted">${state.forecast.calibration?.note || ""}</span>`;
    renderForecastChart();
    renderForecastStations();
    applyForecastDay(0);
  } catch (e) {
    $("#fc-status").textContent = `❌ Lỗi: ${e.message}`;
  } finally {
    btn.disabled = false;
  }
}

function applyForecastDay(i) {
  const fc = state.forecast;
  if (!fc) return;
  state.fcDay = i;
  const day = fc.timeline[i];
  $("#fc-date").textContent = formatDate(fc.dates[i]);

  // To lai mau duong song theo L cua ngay duoc chon
  const segs = {
    type: "FeatureCollection",
    features: fc.segments.features.map((f) => {
      const L = day.l_by_river_km[f.properties.river_id] || 25;
      const s = 30 * Math.exp(-f.properties.chainage_km / L);
      return { ...f, properties: { ...f.properties, salinity: +s.toFixed(2) } };
    }),
  };
  const fronts = {
    type: "FeatureCollection",
    features: fc.fronts.features.filter((f) => f.properties.day === i),
  };
  state.salinity = { segments: segs, fronts };
  updateSalinityLayers();

  // Raster vung anh huong man cua ngay
  if (fc.zone_tile_path_template)
    updateZoneLayer(fc.zone_tile_path_template.replace(
      "{d:02d}", String(i).padStart(2, "0")));
  renderForecastChart(); // ve lai con tro ngay
}

function formatDate(iso) {
  const d = new Date(iso + "T00:00:00");
  return d.toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit" });
}

// Bieu do SVG: ranh man 4 g/l (km tu cua song) theo ngay, 4 song chinh
function renderForecastChart() {
  const fc = state.forecast;
  if (!fc) return;
  const W = 296, H = 130, PAD = { l: 30, r: 6, t: 8, b: 18 };
  const n = fc.timeline.length;
  const series = FC_RIVERS.map((key) => ({
    key,
    vals: fc.timeline.map((d) => d.summary[key]?.front_4gl_km ?? 0),
  }));
  const maxV = Math.max(...series.flatMap((s) => s.vals), 10) * 1.1;
  const x = (i) => PAD.l + (i / Math.max(n - 1, 1)) * (W - PAD.l - PAD.r);
  const y = (v) => H - PAD.b - (v / maxV) * (H - PAD.t - PAD.b);
  let svg = `<svg viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg">`;
  // truc + luoi ngang
  for (const v of [0, Math.round(maxV / 2), Math.round(maxV)]) {
    svg += `<line x1="${PAD.l}" y1="${y(v)}" x2="${W - PAD.r}" y2="${y(v)}" stroke="#2b4358" stroke-width="1"/>` +
           `<text x="${PAD.l - 4}" y="${y(v) + 3}" fill="#90a4b8" font-size="8" text-anchor="end">${v}</text>`;
  }
  // con tro ngay dang chon
  svg += `<line x1="${x(state.fcDay)}" y1="${PAD.t}" x2="${x(state.fcDay)}" y2="${H - PAD.b}" stroke="#8ab4d8" stroke-dasharray="3 2"/>`;
  for (const s of series) {
    const pts = s.vals.map((v, i) => `${x(i)},${y(v)}`).join(" ");
    svg += `<polyline points="${pts}" fill="none" stroke="${FC_COLORS[s.key]}" stroke-width="1.8"/>`;
  }
  // nhan ngay dau/cuoi
  svg += `<text x="${x(0)}" y="${H - 5}" fill="#90a4b8" font-size="8">${formatDate(fc.dates[0])}</text>` +
         `<text x="${x(n - 1)}" y="${H - 5}" fill="#90a4b8" font-size="8" text-anchor="end">${formatDate(fc.dates[n - 1])}</text>`;
  svg += "</svg>";
  const names = { song_hau: "Hậu", ham_luong: "Hàm Luông", co_chien: "Cổ Chiên",
                  vam_co: "Vàm Cỏ", song_saigon: "Sài Gòn" };
  const legend = FC_RIVERS.map((k) =>
    `<span class="fc-lg"><i style="background:${FC_COLORS[k]}"></i>${names[k]}</span>`).join("");
  $("#fc-chart").innerHTML = svg + `<div class="fc-legend">${legend}</div>`;
}

// Danh sach tram: ngay du bao man vuot nguong
function renderForecastStations() {
  const fc = state.forecast;
  if (!fc?.stations?.length) { $("#fc-stations").innerHTML = ""; return; }
  const rows = fc.stations.map((st) => {
    const d4 = st.first_day_over_4gl, d1 = st.first_day_over_1gl;
    const badge = d4
      ? `<b style="color:#ef6c00">≥4 g/l từ ${formatDate(d4)}</b>`
      : d1 ? `<b style="color:#f9a825">≥1 g/l từ ${formatDate(d1)}</b>`
           : `<b style="color:#2e7d32">ngọt trong kỳ dự báo</b>`;
    return `<div class="fc-station">📍 <b>${st.name}</b> · ${st.river}` +
           `<br/><span class="muted">cách cửa sông ${st.chainage_km} km — ${badge}</span></div>`;
  });
  $("#fc-stations").innerHTML =
    `<div class="legend-title">Dự báo tại trạm đo mặn</div>` + rows.join("");
}

// ===================== Tram quan trac =====================
const STATION_TYPE_LABEL = {
  water_level: "mực nước", salinity: "độ mặn", both: "mực nước + độ mặn",
};

async function loadStations() {
  try {
    const stations = await (await fetch("/api/stations")).json();
    for (const s of stations) {
      // Marker to, kem ten tram de thay ro tren ban do
      const el = document.createElement("div");
      el.className = "station-wrap";
      el.innerHTML = `<div class="station-marker" title="Trạm ${s.name}"></div>` +
        `<div class="station-label">${s.name}</div>`;
      const popup = new maplibregl.Popup({ maxWidth: "300px" });
      popup.on("open", () => fillStationPopup(popup, s));
      new maplibregl.Marker({ element: el, anchor: "center" })
        .setLngLat([s.lon, s.lat])
        .setPopup(popup)
        .addTo(map);
    }
  } catch { /* khong chan UI */ }
}

// Khi mo popup tram: lay so lieu ngap/man hien tai tu ket qua mo phong
async function fillStationPopup(popup, s) {
  const head = `<b>📡 Trạm ${s.name}</b><br/>` +
    `<span class="muted">Quan trắc: ${STATION_TYPE_LABEL[s.type] || s.type}</span>`;
  popup.setHTML(`${head}<br/>Đang tải số liệu…`);
  try {
    const a = await (await fetch(
      `/api/alerts?lat=${s.lat}&lon=${s.lon}&t=${state.t}`)).json();
    let rows = "";
    if (s.type !== "salinity")
      rows += `<br/>🌊 Ngập hiện tại: <b>${a.flood.depth_m} m</b>` +
              ` · sâu nhất đợt: <b>${a.flood.max_depth_m} m</b>`;
    if (s.type !== "water_level")
      rows += `<br/>🧂 Độ mặn: <b style="color:${a.salinity.color}">` +
              `${a.salinity.salinity_gl} g/l</b> (${a.salinity.label})`;
    popup.setHTML(head + rows +
      `<br/><span class="muted">Theo mô phỏng lúc ${$("#time-label").textContent}</span>`);
  } catch {
    popup.setHTML(`${head}<br/><span class="muted">Chưa có kết quả mô phỏng.</span>`);
  }
}

// ===================== Chay mo phong =====================
function customParams() {
  return {
    q_factor: Number($("#p-q").value),
    tide_amp_m: Number($("#p-tide").value),
    surge_m: Number($("#p-surge").value),
    slr_m: Number($("#p-slr").value),
    rain_mm_day: Number($("#p-rain").value),
    hours: Number($("#p-hours").value),
  };
}

async function runSimulation() {
  const btn = $("#btn-run");
  btn.disabled = true;
  $("#run-status").textContent = "⏳ Đang tính toán mô phỏng (HAND-FIM)…";
  try {
    const body = state.mode === "realtime"
      ? { mode: "realtime" }
      : { mode: "custom", ...customParams() };
    const res = await fetch("/api/simulate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error((await res.json()).error || res.status);
    const data = await res.json();
    state.meta = data.flood;
    state.salinity = data.salinity;
    state.t = 0;
    setupSlider();
    // Gan lop len ban do; neu style chua nap xong (tile nen cham) thi cho
    const applyLayers = () => {
      updateFloodLayer();
      updateSalinityLayers();
      updateZoneLayer(data.salinity?.zone_tile_path);
      loadZones();
    };
    whenStyleReady(applyLayers);
    const st = data.flood.stats?.[0];
    $("#run-status").textContent =
      `✅ Xong: ${data.flood.times.length} bước thời gian` +
      (st ? ` · ngập tối đa ${data.flood.stats.reduce((a, s) => Math.max(a, s.max_depth_m), 0)} m` : "");
    refreshAlertIfAny();
  } catch (e) {
    $("#run-status").textContent = `❌ Lỗi: ${e.message}`;
  } finally {
    btn.disabled = false;
  }
}

function setupSlider() {
  const n = state.meta?.times?.length || 1;
  const sl = $("#time-slider");
  sl.max = n - 1;
  sl.value = state.t;
  updateTimeLabel();
}

// ===================== Kich ban Itzi =====================
async function loadScenarios() {
  try {
    state.scenarios = await (await fetch("/api/scenarios")).json();
  } catch { state.scenarios = []; }
  const sel = $("#scenario-select");
  sel.innerHTML = state.scenarios.length
    ? state.scenarios.map((s, i) =>
        `<option value="${i}">${s.title || s.run_id} (${s.engine})</option>`).join("")
    : `<option value="">Chưa có kịch bản nào - xem modeling/itzi/README.md</option>`;
}

function applyScenario() {
  const i = Number($("#scenario-select").value);
  if (!state.scenarios[i]) return;
  state.meta = state.scenarios[i];
  state.t = 0;
  setupSlider();
  updateFloodLayer();
  $("#run-status").textContent = `✅ Đang hiển thị kịch bản: ${state.meta.title || state.meta.run_id}`;
}

// ===================== Du lieu thoi gian thuc =====================
async function loadRealtime() {
  try {
    const rt = await (await fetch("/api/realtime")).json();
    const p = rt.derived_params;
    const st = rt.mrc?.stations || {};
    const mrcLine = st.tan_chau || st.chau_doc
      ? `Mực nước MRC:` +
        (st.tan_chau ? ` Tân Châu <b>${st.tan_chau.wl_m} m</b>` : "") +
        (st.chau_doc ? ` · Châu Đốc <b>${st.chau_doc.wl_m} m</b>` : "") +
        `<br/>`
      : "";
    $("#rt-summary").innerHTML =
      `<b>${rt.seasonal.season.toUpperCase()}</b><br/>` +
      `Dòng chảy thượng nguồn: <b>${p.q_factor}×</b>` +
      (p.q_factor_source === "mrc" ? ` <span style="font-size:10.5px;color:#81c784">(theo mực nước thực đo)</span>` : "") +
      ` · Biên độ triều: <b>${p.tide_amp_m} m</b><br/>` +
      mrcLine +
      `Mưa dự báo hôm nay (Open-Meteo): <b>${p.rain_mm_day} mm</b><br/>` +
      `<span style="font-size:11px">Nguồn: ${rt.sources_used.join(", ")}</span>`;
  } catch {
    $("#rt-summary").textContent = "Không tải được dữ liệu thời gian thực.";
  }
}

// ===================== Canh bao theo vi tri =====================
let lastAlertPos = null;

async function showAlert(lat, lon) {
  lastAlertPos = { lat, lon };
  $("#alert-body").innerHTML = `<span class="muted">Đang phân tích vị trí…</span>`;
  try {
    const a = await (await fetch(`/api/alerts?lat=${lat}&lon=${lon}&t=${state.t}`)).json();
    const badgeColor = a.overall_level >= 3 ? "#d32f2f" : a.overall_level >= 1 ? "#ef6c00" : "#2e7d32";
    $("#alert-body").innerHTML = `
      <div class="alert-card" style="background:#0d1b2a">
        <span class="badge" style="background:${badgeColor}">${a.overall_label}</span>
        <div class="muted">(${lat.toFixed(4)}, ${lon.toFixed(4)})</div>
        <h3>🌊 Ngập lụt — <span style="color:${a.flood.color}">${a.flood.label}</span></h3>
        Độ sâu hiện tại: <span class="num">${a.flood.depth_m} m</span><br/>
        Sâu nhất trong đợt: <span class="num">${a.flood.max_depth_m} m</span>
        ${a.flood.max_at ? `(lúc ${new Date(a.flood.max_at).toLocaleString("vi-VN", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" })})` : ""}
        ${a.flood.elevation_m != null ? `<br/>Cao độ nền: ${a.flood.elevation_m} m` : ""}
        <div class="advice">💡 ${a.flood.advice}</div>
        <h3>🧂 Xâm nhập mặn — <span style="color:${a.salinity.color}">${a.salinity.label}</span></h3>
        Độ mặn ước tính: <span class="num">${a.salinity.salinity_gl} g/l</span>
        ${a.salinity.river ? `<br/>Theo ${a.salinity.river} (cách ${a.salinity.river_distance_km} km)` : ""}
        <div class="advice">💡 ${a.salinity.advice}</div>
      </div>`;
    if (state.userMarker) state.userMarker.remove();
    const el = document.createElement("div");
    el.className = "user-marker";
    el.textContent = "📍";
    state.userMarker = new maplibregl.Marker({ element: el, anchor: "bottom" })
      .setLngLat([lon, lat]).addTo(map);
  } catch (e) {
    $("#alert-body").innerHTML =
      `<span class="muted">Chưa có kết quả mô phỏng để phân tích — hãy chạy mô phỏng trước. (${e.message})</span>`;
  }
}

function refreshAlertIfAny() {
  if (lastAlertPos) showAlert(lastAlertPos.lat, lastAlertPos.lon);
}

function locateUser(silent = false) {
  if (!navigator.geolocation) {
    if (!silent) alert("Trình duyệt không hỗ trợ định vị.");
    return;
  }
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const { latitude: lat, longitude: lon } = pos.coords;
      map.flyTo({ center: [lon, lat], zoom: 10 });
      showAlert(lat, lon);
    },
    () => {
      if (!silent)
        $("#alert-body").innerHTML =
          `<span class="muted">Không lấy được vị trí (bạn đã từ chối quyền định vị?). Hãy bấm trực tiếp vào bản đồ.</span>`;
    },
    { enableHighAccuracy: false, timeout: 8000 },
  );
}

// ===================== Su kien UI =====================
document.querySelectorAll(".mode-tab").forEach((btn) =>
  btn.addEventListener("click", () => {
    document.querySelectorAll(".mode-tab").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    state.mode = btn.dataset.mode;
    $("#realtime-info").classList.toggle("hidden", state.mode !== "realtime");
    $("#custom-controls").classList.toggle("hidden", state.mode !== "custom");
    $("#scenario-controls").classList.toggle("hidden", state.mode !== "scenario");
    $("#btn-run").classList.toggle("hidden", state.mode === "scenario");
    if (state.mode === "scenario") applyScenario();
  }));

// Cap nhat gia tri hien thi cua slider tham so
const UNITS = { "p-q": (v) => `${v}×`, "p-tide": (v) => `${v} m`, "p-surge": (v) => `${v} m`,
  "p-slr": (v) => `${Number(v).toFixed(2)} m`, "p-rain": (v) => `${v} mm`, "p-hours": (v) => `${v} h` };
for (const [id, fmt] of Object.entries(UNITS)) {
  const el = $(`#${id}`);
  el.addEventListener("input", () => (el.nextElementSibling.value = fmt(el.value)));
}

$("#btn-run").addEventListener("click", runSimulation);
$("#scenario-select").addEventListener("change", applyScenario);
$("#btn-locate").addEventListener("click", () => locateUser(false));

$("#time-slider").addEventListener("input", (e) => {
  state.t = Number(e.target.value);
  updateFloodLayer();
});

$("#btn-play").addEventListener("click", () => {
  state.playing = !state.playing;
  $("#btn-play").textContent = state.playing ? "⏸" : "▶";
  if (state.playing) {
    state.playTimer = setInterval(() => {
      const n = state.meta?.times?.length || 1;
      state.t = (state.t + 1) % n;
      $("#time-slider").value = state.t;
      updateFloodLayer();
    }, 900);
  } else clearInterval(state.playTimer);
});

$("#p-opacity").addEventListener("input", (e) => {
  if (map.getLayer("flood"))
    map.setPaintProperty("flood", "raster-opacity", Number(e.target.value));
});
$("#lyr-flood").addEventListener("change", updateFloodLayer);
$("#lyr-salt").addEventListener("change", updateSalinityLayers);
$("#lyr-salt-zone").addEventListener("change", updateZoneVisibility);

// ---- Radar mua RainViewer
$("#lyr-radar").addEventListener("change", (e) => toggleRadar(e.target.checked));
$("#radar-slider").addEventListener("input", (e) => {
  stopRadarAnim();
  showRadarFrame(Number(e.target.value));
});
$("#radar-play").addEventListener("click", toggleRadarAnim);
$("#radar-opacity").addEventListener("input", (e) => {
  if (map.getLayer("radar"))
    map.setPaintProperty("radar", "raster-opacity", Number(e.target.value));
});

$("#btn-forecast").addEventListener("click", runForecast);
$("#fc-day").addEventListener("input", (e) =>
  applyForecastDay(Number(e.target.value)));

$("#zone-level").addEventListener("change", (e) => {
  state.zoneLevel = e.target.value;
  loadZones();
});
document.querySelectorAll('input[name="zone-metric"]').forEach((r) =>
  r.addEventListener("change", () => {
    state.zoneMetric = document.querySelector('input[name="zone-metric"]:checked').value;
    applyZoneStyle();
  }));

map.on("click", (e) => {
  // bo qua click trung layer (da co popup rieng)
  const hit = map.queryRenderedFeatures(e.point,
    { layers: ["salt-segments", "salt-fronts"].filter((l) => map.getLayer(l)) });
  if (!hit.length) showAlert(e.lngLat.lat, e.lngLat.lng);
});

// ===================== Khoi dong =====================
let booted = false;
async function boot() {
  if (booted) return;
  booted = true;
  loadStations();
  loadRealtime();
  loadScenarios();
  loadRadar(true);   // tai truoc metadata radar (lop tat mac dinh)
  // Tu dong chay mo phong thoi gian thuc khi mo trang, roi tu xac dinh vi tri
  await runSimulation();
  locateUser(true);
}

map.on("load", boot);
// Du phong: ban do nen cham/bi chan thi van khoi dong phan du lieu;
// cac lop ban do se duoc gan lai khi style san sang (xem runSimulation)
setTimeout(() => { if (!booted) boot(); }, 8000);
