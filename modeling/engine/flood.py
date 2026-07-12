"""Tinh raster do sau ngap theo thoi gian bang phuong phap HAND-FIM.

Y tuong (theo NOAA OWP inundation-mapping):
  depth(cell, t) = stage(cell song gan nhat, t) - HAND(cell)
Muc nuoc stage doc song duoc noi suy tu:
  - Trieu bien (song ban nhat trieu ~12.42h) suy giam dan len thuong nguon
  - Nuoc lu thuong nguon (Q) tang dan len thuong nguon
  - Nuoc bien dang (SLR) + trieu cuong (surge)
  - Mua gay ngap ung cuc bo o vung HAND thap
Ket qua: chuoi GeoTIFF (tiled + overview, TiTiler doc truc tiep) + metadata.json
"""
import json
import os
import uuid
from datetime import datetime, timedelta, timezone

import numpy as np
import rasterio

from .terrain import Terrain, RES

TIDE_PERIOD_H = 12.42          # chu ky ban nhat trieu
TIDAL_DECAY_KM = 90.0          # trieu suy giam e-fold ~90 km len thuong nguon
UPSTREAM_RAMP_KM = 220.0       # nuoc lu dang dan tu bien len Tan Chau/Chau Doc
# Suy giam muc nuoc khi lan xa song: xung trieu (~6h) khong kip lan xa
# (tat dan e-fold ~8 km), nuoc lu/SLR keo dai nhieu ngay nen lan rong
# (Dong Thap Muoi, TGLX) chi ton that ma sat nhe
TIDE_LAND_DECAY_KM = 8.0       # trieu tat dan khi xa song (nhan exp)
SLOW_ATTEN_M_PER_KM = 0.015    # thanh phan cham: lu thuong nguon, SLR, nuoc dang
MIN_DEPTH = 0.02               # duoi nguong nay coi nhu kho (nodata)


def compute_flood(terrain: Terrain, params: dict, data_dir: str) -> dict:
    """params:
      hours          : so gio mo phong (mac dinh 24)
      tide_amp_m     : bien do trieu (m, mac dinh 1.4 - trieu Bien Dong)
      surge_m        : nuoc dang do trieu cuong/bao (m)
      slr_m          : nuoc bien dang (m)
      q_factor       : he so dong chay thuong nguon (1 = mua kho, 3-5 = dinh lu)
      rain_mm_day    : luong mua (mm/ngay)
      start_iso      : thoi diem bat dau (ISO, mac dinh now UTC)
    """
    hours = int(params.get("hours", 24))
    tide_amp = float(params.get("tide_amp_m", 1.4))
    surge = float(params.get("surge_m", 0.0))
    slr = float(params.get("slr_m", 0.0))
    q = max(0.2, float(params.get("q_factor", 1.0)))
    rain = float(params.get("rain_mm_day", 0.0))
    start = params.get("start_iso")
    t0 = datetime.fromisoformat(start) if start else datetime.now(timezone.utc)

    run_id = datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S") + "-" + uuid.uuid4().hex[:6]
    out_dir = os.path.join(data_dir, "outputs", "runs", run_id)
    os.makedirs(out_dir, exist_ok=True)

    chain = terrain.river_chainage_km      # km tu cua song, tai cell song gan nhat
    dist = terrain.river_dist_km           # km toi song gan nhat
    hand = terrain.hand

    # Thanh phan khong doi theo t
    upstream_stage = 3.5 * (q - 0.2) / 4.8 * np.clip(chain / UPSTREAM_RAMP_KM, 0, 1)
    tidal_reach = np.exp(-chain / TIDAL_DECAY_KM)
    slr_reach = np.exp(-chain / 400.0)              # SLR/nuoc dang lan gan het song
    slow_stage = (slr + surge) * slr_reach + upstream_stage - SLOW_ATTEN_M_PER_KM * dist
    tide_damp = tidal_reach * np.exp(-dist / TIDE_LAND_DECAY_KM)
    runoff_zone = np.clip(1.0 - hand / 2.0, 0, 1)   # vung tru mua: HAND < 2 m

    times, files, stats = [], [], []
    profile = dict(
        driver="GTiff", dtype="float32", count=1, width=terrain.nx,
        height=terrain.ny, crs="EPSG:4326", transform=terrain.transform,
        nodata=0.0, tiled=True, blockxsize=256, blockysize=256,
        compress="deflate", predictor=2,
    )

    for h in range(hours):
        t = t0 + timedelta(hours=h)
        phase = 2 * np.pi * (t.timestamp() / 3600.0) / TIDE_PERIOD_H
        tide = tide_amp * np.sin(phase) + 0.35 * tide_amp * np.sin(phase / 2.0)
        depth = tide * tide_damp + slow_stage - hand
        # Ngap ung do mua: tich luy dan trong 12h dau, he so dong chay 0.6
        if rain > 0:
            pond = (rain / 1000.0) * 0.6 * min(h + 1, 12) / 12.0 * runoff_zone
            depth = depth + pond
        depth = np.where(depth > MIN_DEPTH, depth, 0).astype(np.float32)

        fname = f"depth_t{h:02d}.tif"
        path = os.path.join(out_dir, fname)
        with rasterio.open(path, "w", **profile) as dst:
            dst.write(depth, 1)
            dst.build_overviews([2, 4, 8, 16], rasterio.enums.Resampling.average)
        wet = depth > MIN_DEPTH
        cell_km2 = (RES * 111.32) * (RES * 111.32 * 0.97)
        stats.append({
            "max_depth_m": round(float(depth.max()), 2),
            "flooded_km2": round(float(wet.sum()) * cell_km2, 0),
        })
        times.append(t.isoformat())
        files.append(fname)

    meta = {
        "run_id": run_id, "type": "flood", "engine": "hand-fim",
        "params": {"hours": hours, "tide_amp_m": tide_amp, "surge_m": surge,
                   "slr_m": slr, "q_factor": q, "rain_mm_day": rain},
        "created": datetime.now(timezone.utc).isoformat(),
        "times": times, "files": files, "stats": stats,
        "tile_path_template": f"/data/outputs/runs/{run_id}/depth_t{{t:02d}}.tif",
        "real_dem": terrain.real_dem,
    }
    with open(os.path.join(out_dir, "metadata.json"), "w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=False, indent=1)
    with open(os.path.join(data_dir, "outputs", "latest_flood.json"), "w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=False)
    return meta


def sample_depth(data_dir: str, run_id: str, t_index: int, lat: float, lon: float):
    """Doc do sau ngap tai 1 diem tu raster cua run da tinh."""
    path = os.path.join(data_dir, "outputs", "runs", run_id, f"depth_t{t_index:02d}.tif")
    if not os.path.exists(path):
        return None
    with rasterio.open(path) as src:
        val = next(src.sample([(lon, lat)]))[0]
    return float(val)


def load_latest_meta(data_dir: str):
    p = os.path.join(data_dir, "outputs", "latest_flood.json")
    if not os.path.exists(p):
        return None
    with open(p, encoding="utf-8") as f:
        return json.load(f)
