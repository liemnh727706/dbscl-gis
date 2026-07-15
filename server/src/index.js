// API backend - He thong mo phong ngap lut & xam nhap man DBSCL
import express from "express";
import { cached } from "./cache.js";
import { fetchRainfall } from "./providers/openMeteo.js";
import { fetchMrcLevels } from "./providers/mrc.js";
import { fetchKttv } from "./providers/kttv.js";
import { seasonalState } from "./providers/synthetic.js";
import { modelGet, modelPost } from "./model.js";
import { buildAlert } from "./alerts.js";

const app = express();
app.use(express.json());

const ok = (res, data) => res.json(data);
const fail = (res, err, code = 500) =>
  res.status(code).json({ error: String(err.message || err) });

// ------------------------------------------------------- health
app.get("/api/health", async (_req, res) => {
  let model = null;
  try { model = await modelGet("/health"); } catch { /* modeling chua san sang */ }
  ok(res, { status: "ok", model });
});

// ------------------------------------------------------- du lieu thoi gian thuc
// Gop cac nguon: Open-Meteo (mua), MRC + KTTV (muc nuoc/do man, best-effort),
// synthetic-seasonal (luon co, dung lam nen + fallback)
app.get("/api/realtime", async (_req, res) => {
  try {
    const seasonal = seasonalState();
    const [rain, mrc, kttv] = await Promise.all([
      cached("rain", fetchRainfall).catch(() => null),
      cached("mrc", fetchMrcLevels).catch(() => null),
      cached("kttv", fetchKttv).catch(() => null),
    ]);
    const rain_mm_day = rain?.avg_rain_mm_day ?? seasonal.rain_mm_day_typical;
    ok(res, {
      time: new Date().toISOString(),
      derived_params: {
        // Uu tien he so dong chay suy tu MUC NUOC MRC thuc do
        // (Tan Chau/Chau Doc); khong co thi dung quy luat mua
        q_factor: mrc?.q_factor_obs ?? seasonal.q_factor,
        q_factor_source: mrc?.q_factor_obs != null ? "mrc" : "seasonal",
        tide_amp_m: seasonal.tide_amp_m,
        rain_mm_day: +Number(rain_mm_day).toFixed(1),
        slr_m: 0,
        surge_m: 0,
      },
      seasonal,
      rainfall: rain,
      mrc,
      kttv,
      sources_used: [
        rain ? "open-meteo" : null, mrc ? "mrc" : null,
        kttv ? "kttv" : null, "synthetic-seasonal",
      ].filter(Boolean),
    });
  } catch (e) { fail(res, e); }
});

// ------------------------------------------------------- chay mo phong
// mode=realtime: tham so tu du lieu thoi gian thuc; mode=custom: nguoi dung chinh
app.post("/api/simulate", async (req, res) => {
  try {
    const { mode = "custom", ...user } = req.body || {};
    let p;
    if (mode === "realtime") {
      const seasonal = seasonalState();
      const [rain, mrc] = await Promise.all([
        cached("rain", fetchRainfall).catch(() => null),
        cached("mrc", fetchMrcLevels).catch(() => null),
      ]);
      p = {
        hours: Number(user.hours) || 24,
        q_factor: mrc?.q_factor_obs ?? seasonal.q_factor,
        tide_amp_m: seasonal.tide_amp_m,
        rain_mm_day: rain?.avg_rain_mm_day ?? seasonal.rain_mm_day_typical,
        slr_m: 0, surge_m: 0,
      };
    } else {
      p = {
        hours: Number(user.hours) || 24,
        q_factor: Number(user.q_factor) || 1,
        tide_amp_m: Number(user.tide_amp_m) ?? 1.4,
        rain_mm_day: Number(user.rain_mm_day) || 0,
        slr_m: Number(user.slr_m) || 0,
        surge_m: Number(user.surge_m) || 0,
      };
    }
    const [flood, salinity] = await Promise.all([
      modelPost("/flood/run", p),
      modelPost("/salinity/run", {
        q_factor: p.q_factor, slr_m: p.slr_m, tide_amp_m: p.tide_amp_m,
      }),
    ]);
    ok(res, { mode, params: p, flood, salinity });
  } catch (e) { fail(res, e); }
});

// ------------------------------------------------------- ket qua & du lieu phu tro
app.get("/api/flood/latest", (_req, res) =>
  modelGet("/flood/latest").then((d) => ok(res, d)).catch((e) => fail(res, e, 404)));

app.get("/api/salinity/latest", (_req, res) =>
  modelGet("/salinity/latest").then((d) => ok(res, d)).catch((e) => fail(res, e, 404)));

// Du bao xam nhap man N ngay toi: quy luat mua chieu toi tung ngay tuong lai,
// NEO vao so lieu thuc do (muc nuoc MRC Tan Chau/Chau Doc -> q_factor_obs):
// ngay 0 dung ty le quan sat/quy luat, lech chinh tat dan e-fold ~5 ngay
// (persistence). KTTV (do man tram) dung them khi cau hinh duoc nguon.
app.get("/api/salinity/forecast", async (req, res) => {
  try {
    const n = Math.min(Math.max(Number(req.query.days) || 10, 1), 30);
    const slr = Number(req.query.slr_m) || 0;
    const [kttv, mrc] = await Promise.all([
      cached("kttv", fetchKttv).catch(() => null),
      cached("mrc", fetchMrcLevels).catch(() => null),
    ]);
    const seasonalNow = seasonalState();
    // Ty le hieu chinh tu quan sat (1 = khong doi neu thieu MRC)
    const ratio = mrc?.q_factor_obs != null && seasonalNow.q_factor > 0
      ? mrc.q_factor_obs / seasonalNow.q_factor : 1;
    const days = [];
    for (let i = 0; i < n; i++) {
      const date = new Date(Date.now() + i * 864e5);
      const s = seasonalState(date);
      const adj = 1 + (ratio - 1) * Math.exp(-i / 5);
      days.push({
        date: date.toISOString().slice(0, 10),
        q_factor: +Math.min(Math.max(s.q_factor * adj, 0.2), 5).toFixed(2),
        tide_amp_m: s.tide_amp_m,
        slr_m: slr,
      });
    }
    const fc = await modelPost("/salinity/forecast", { days });
    const tc = mrc?.stations?.tan_chau;
    ok(res, {
      ...fc,
      calibration: mrc
        ? { source: "mrc-telemetry",
            q_factor_obs: mrc.q_factor_obs,
            adjust_ratio: +ratio.toFixed(3),
            note: `Đã hiệu chỉnh theo mực nước MRC thời gian thực` +
                  (tc ? ` (Tân Châu ${tc.wl_m} m)` : "") +
                  (kttv ? ", kết hợp trạm KTTV" : ""),
          }
        : { source: "synthetic-seasonal",
            note: "Không lấy được số liệu MRC — dùng quy luật mùa; kiểm tra kết nối hoặc MRC_API_URL." },
    });
  } catch (e) { fail(res, e); }
});

// Anh PNG phu ban do (do sau ngap / vung man) - proxy nhi phan toi modeling
app.get("/api/render.png", async (req, res) => {
  try {
    const q = new URLSearchParams(req.query).toString();
    const r = await fetch(
      `${process.env.MODEL_API_URL || "http://localhost:8000"}/render.png?${q}`,
      { signal: AbortSignal.timeout(60000) });
    if (!r.ok) return res.status(r.status).end();
    res.set("content-type", "image/png");
    res.set("cache-control", "public, max-age=86400");
    res.send(Buffer.from(await r.arrayBuffer()));
  } catch (e) { fail(res, e); }
});

// Choropleth theo don vi hanh chinh: ?level=province|commune
app.get("/api/zones", (req, res) => {
  const level = req.query.level === "commune" ? "commune" : "province";
  modelGet(`/zones?level=${level}`).then((d) => ok(res, d)).catch((e) => fail(res, e));
});

app.get("/api/stations", (_req, res) =>
  modelGet("/stations").then((d) => ok(res, d)).catch((e) => fail(res, e)));

app.get("/api/scenarios", (_req, res) =>
  modelGet("/scenarios").then((d) => ok(res, d)).catch((e) => fail(res, e)));

// ------------------------------------------------------- canh bao theo vi tri
app.get("/api/alerts", async (req, res) => {
  try {
    const lat = Number(req.query.lat), lon = Number(req.query.lon);
    const t = Number(req.query.t) || 0;
    if (!isFinite(lat) || !isFinite(lon)) return fail(res, "Thiếu lat/lon", 400);
    const [flood, salinity, meta] = await Promise.all([
      modelGet(`/flood/sample?lat=${lat}&lon=${lon}&t=${t}`).catch(() => null),
      modelGet(`/salinity/sample?lat=${lat}&lon=${lon}`).catch(() => null),
      modelGet("/flood/latest").catch(() => null),
    ]);
    ok(res, buildAlert({ lat, lon, flood, salinity, meta }));
  } catch (e) { fail(res, e); }
});

const port = Number(process.env.PORT || 3000);
app.listen(port, () => console.log(`[server] API chạy tại cổng ${port}`));
