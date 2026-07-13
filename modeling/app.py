"""Modeling API - dich vu tinh toan ngap lut (HAND-FIM) va xam nhap man.

Duoc goi boi Node.js backend, khong expose truc tiep ra ngoai.
"""
import glob
import json
import os

from fastapi import FastAPI, HTTPException, Query
from pydantic import BaseModel, Field

from engine.terrain import get_terrain
from engine.flood import compute_flood, sample_depth, load_latest_meta
from engine.salinity import compute_salinity, compute_forecast, sample_salinity
from engine.rivers import STATIONS

DATA_DIR = os.environ.get("DATA_DIR", "/data")

app = FastAPI(title="Mekong Flood Modeling API")


class FloodParams(BaseModel):
    hours: int = Field(24, ge=1, le=240)
    tide_amp_m: float = Field(1.4, ge=0, le=3)
    surge_m: float = Field(0.0, ge=0, le=2)
    slr_m: float = Field(0.0, ge=0, le=2)
    q_factor: float = Field(1.0, ge=0.2, le=5)
    rain_mm_day: float = Field(0.0, ge=0, le=500)
    start_iso: str | None = None


class SalinityParams(BaseModel):
    q_factor: float = Field(1.0, ge=0.2, le=5)
    slr_m: float = Field(0.0, ge=0, le=2)
    tide_amp_m: float = Field(1.4, ge=0, le=3)


class ForecastDay(BaseModel):
    date: str
    q_factor: float = Field(1.0, ge=0.2, le=5)
    tide_amp_m: float = Field(1.4, ge=0, le=3)
    slr_m: float = Field(0.0, ge=0, le=2)


class ForecastParams(BaseModel):
    days: list[ForecastDay] = Field(..., min_length=1, max_length=30)


@app.on_event("startup")
def _warm():
    get_terrain(DATA_DIR)  # build/load terrain cache ngay khi khoi dong


@app.get("/health")
def health():
    t = get_terrain(DATA_DIR)
    return {"status": "ok", "grid": [t.ny, t.nx], "real_dem": t.real_dem}


@app.post("/flood/run")
def flood_run(p: FloodParams):
    t = get_terrain(DATA_DIR)
    return compute_flood(t, p.model_dump(), DATA_DIR)


@app.get("/flood/latest")
def flood_latest():
    meta = load_latest_meta(DATA_DIR)
    if not meta:
        raise HTTPException(404, "Chua co ket qua mo phong nao")
    return meta


@app.get("/flood/sample")
def flood_sample(lat: float = Query(...), lon: float = Query(...),
                 run_id: str | None = None, t: int = 0):
    meta = load_latest_meta(DATA_DIR)
    if run_id is None:
        if not meta:
            raise HTTPException(404, "Chua co ket qua mo phong")
        run_id = meta["run_id"]
    depth = sample_depth(DATA_DIR, run_id, t, lat, lon)
    if depth is None:
        raise HTTPException(404, "Khong tim thay raster")
    terrain = get_terrain(DATA_DIR)
    rc = terrain.rowcol(lat, lon)
    extra = {}
    if rc:
        extra = {"elevation_m": round(float(terrain.dem[rc]), 2),
                 "hand_m": round(float(terrain.hand[rc]), 2),
                 "river_dist_km": round(float(terrain.river_dist_km[rc]), 1)}
    # do sau lon nhat trong ca chuoi thoi gian tai diem nay
    max_depth, max_t = depth, t
    if meta and meta["run_id"] == run_id:
        for i in range(len(meta["files"])):
            d = sample_depth(DATA_DIR, run_id, i, lat, lon)
            if d is not None and d > max_depth:
                max_depth, max_t = d, i
    return {"depth_m": round(depth, 2), "max_depth_m": round(max_depth, 2),
            "max_t_index": max_t, "run_id": run_id, "t_index": t, **extra}


@app.post("/salinity/run")
def salinity_run(p: SalinityParams):
    return compute_salinity(p.model_dump(), DATA_DIR, get_terrain(DATA_DIR))


@app.post("/salinity/forecast")
def salinity_forecast(p: ForecastParams):
    return compute_forecast([d.model_dump() for d in p.days], DATA_DIR,
                            get_terrain(DATA_DIR))


@app.get("/salinity/forecast/latest")
def salinity_forecast_latest():
    path = os.path.join(DATA_DIR, "outputs", "latest_salinity_forecast.json")
    if not os.path.exists(path):
        raise HTTPException(404, "Chua co du bao man nao")
    with open(path, encoding="utf-8") as f:
        return json.load(f)


@app.get("/salinity/latest")
def salinity_latest():
    p = os.path.join(DATA_DIR, "outputs", "latest_salinity.json")
    if not os.path.exists(p):
        raise HTTPException(404, "Chua co ket qua do man")
    with open(p, encoding="utf-8") as f:
        return json.load(f)


@app.get("/salinity/sample")
def salinity_sample_ep(lat: float, lon: float):
    r = sample_salinity(DATA_DIR, lat, lon)
    if r is None:
        raise HTTPException(404, "Chua co ket qua do man")
    return r


@app.get("/stations")
def stations():
    return STATIONS


@app.get("/scenarios")
def scenarios():
    """Liet ke kich ban Itzi da tinh san trong data/outputs/scenarios/."""
    out = []
    for meta_path in sorted(glob.glob(
            os.path.join(DATA_DIR, "outputs", "scenarios", "*", "metadata.json"))):
        with open(meta_path, encoding="utf-8") as f:
            out.append(json.load(f))
    return out
