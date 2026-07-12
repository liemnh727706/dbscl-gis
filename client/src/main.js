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
};

const $ = (sel) => document.querySelector(sel);

// ===================== Khoi tao ban do =====================
const map = new maplibregl.Map({
  container: "map",
  center: [105.7, 9.95],
  zoom: 7.6,
  style: {
    version: 8,
    glyphs: "https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf",
    sources: {
      osm: {
        type: "raster",
        tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
        tileSize: 256,
        attribution: "© OpenStreetMap contributors",
      },
    },
    layers: [{ id: "osm", type: "raster", source: "osm" }],
  },
});
map.addControl(new maplibregl.NavigationControl(), "top-right");
map.addControl(new maplibregl.ScaleControl({ unit: "metric" }));
window._map = map; // debug console

// ===================== Lop raster ngap (TiTiler) =====================
function floodTileUrl(t) {
  const path = state.meta.tile_path_template.replace(
    "{t:02d}", String(t).padStart(2, "0"));
  const q = new URLSearchParams({
    url: path, rescale: "0,3", colormap_name: "blues",
  });
  return `/tiles/cog/tiles/WebMercatorQuad/{z}/{x}/{y}@1x.png?${q.toString()}`;
}

function updateFloodLayer() {
  if (!state.meta) return;
  const tiles = [floodTileUrl(state.t)];
  const src = map.getSource("flood");
  if (src && typeof src.setTiles === "function") {
    src.setTiles(tiles);
  } else {
    if (map.getLayer("flood")) map.removeLayer("flood");
    if (src) map.removeSource("flood");
    map.addSource("flood", { type: "raster", tiles, tileSize: 256 });
    map.addLayer(
      { id: "flood", type: "raster", source: "flood",
        paint: { "raster-opacity": Number($("#p-opacity").value) } },
      map.getLayer("salt-segments") ? "salt-segments" : undefined,
    );
  }
  map.setLayoutProperty("flood", "visibility",
    $("#lyr-flood").checked ? "visible" : "none");
  updateTimeLabel();
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
    });
    map.addSource("salt-fronts", { type: "geojson", data: fronts });
    map.addLayer({
      id: "salt-fronts", type: "circle", source: "salt-fronts",
      filter: ["==", ["get", "threshold_gl"], 4],
      paint: {
        "circle-radius": 6, "circle-color": "#d32f2f",
        "circle-stroke-color": "#fff", "circle-stroke-width": 2,
      },
    });
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

// ===================== Tram quan trac =====================
async function loadStations() {
  try {
    const stations = await (await fetch("/api/stations")).json();
    for (const s of stations) {
      const el = document.createElement("div");
      el.className = "station-marker";
      new maplibregl.Marker({ element: el })
        .setLngLat([s.lon, s.lat])
        .setPopup(new maplibregl.Popup().setHTML(
          `<b>Trạm ${s.name}</b><br/>Loại: ${
            s.type === "water_level" ? "mực nước" : s.type === "salinity" ? "độ mặn" : "mực nước + độ mặn"
          }`))
        .addTo(map);
    }
  } catch { /* khong chan UI */ }
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
    updateFloodLayer();
    updateSalinityLayers();
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
    $("#rt-summary").innerHTML =
      `<b>${rt.seasonal.season.toUpperCase()}</b><br/>` +
      `Dòng chảy thượng nguồn: <b>${p.q_factor}×</b> · Biên độ triều: <b>${p.tide_amp_m} m</b><br/>` +
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

map.on("click", (e) => {
  // bo qua click trung layer (da co popup rieng)
  const hit = map.queryRenderedFeatures(e.point,
    { layers: ["salt-segments", "salt-fronts"].filter((l) => map.getLayer(l)) });
  if (!hit.length) showAlert(e.lngLat.lat, e.lngLat.lng);
});

// ===================== Khoi dong =====================
map.on("load", async () => {
  loadStations();
  loadRealtime();
  loadScenarios();
  // Tu dong chay mo phong thoi gian thuc khi mo trang, roi tu xac dinh vi tri
  await runSimulation();
  locateUser(true);
});
