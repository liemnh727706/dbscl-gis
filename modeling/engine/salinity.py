"""Mo hinh xam nhap man 1D doc cac nhanh song chinh DBSCL.

Do man giam theo ham mu tu cua song len thuong nguon (Savenije 2005, dang
don gian hoa):
    S(x) = S_bien * exp(-x / L_song)
Chieu dai xam nhap L phu thuoc:
  - Dong chay thuong nguon Q (mua kho Q nho -> L lon)
  - Nuoc bien dang SLR va bien do trieu
  - He so rieng tung song (l_factor, hieu chinh theo han man 2016/2020:
    Vam Co sau nhat, Ham Luong > Co Chien > Hau/Tien)
He so duoc hieu chinh de mua kho dien hinh ranh man 4 g/l vao sau ~45-60 km
tren song Hau/Tien (tuong tu so lieu 2016, 2020).

Ket qua:
  - GeoJSON cac doan song kem do man + diem ranh man 4/1 g/l
  - Raster GeoTIFF "vung anh huong man" doc song: cell dat lay do man cua
    diem song gan nhat, suy giam ngang exp(-d/LATERAL_KM) (nuoc man theo
    kenh rach lan vao dong ruong ven song) -> TiTiler to mau truc quan.
  - Du bao nhieu ngay: chuoi L/ranh man/raster theo tung ngay + uoc tinh
    ngay ranh man cham cac tram do man.
"""
import json
import os
import uuid
from datetime import datetime, timezone

import numpy as np
import rasterio

from .rivers import RIVERS, STATIONS

S_SEA = 30.0        # g/l tai cua song
L0_KM = 25.0        # chieu dai e-fold co ban (mua kho, q_factor=1)
SEG_KM = 2.0        # do phan giai doan song (GeoJSON)
KM_PER_DEG_LAT = 111.32
LATERAL_KM = 8.0    # suy giam ngang khi xa song (vung anh huong ven song)
ZONE_MAX_KM = 15.0  # ngoai khoang cach nay coi nhu khong anh huong truc tiep
S_MIN = 0.1         # duoi nguong nay coi nhu ngot (nodata tren raster)


def intrusion_length(q_factor: float, slr_m: float, tide_amp_m: float) -> float:
    """Chieu dai e-fold chung L (km); L tung song = L * l_factor."""
    q = max(0.2, q_factor)
    L = L0_KM * (1.0 / q) ** 0.7
    L *= 1.0 + 2.0 * max(0.0, slr_m)            # SLR day man vao sau
    L *= 1.0 + 0.25 * (tide_amp_m - 1.4) / 1.4  # trieu manh -> vao sau hon
    return max(3.0, L)


def l_by_river(L: float) -> dict:
    return {key: L * r.get("l_factor", 1.0) for key, r in RIVERS.items()}


def _densify(points, seg_km=SEG_KM):
    """Chia polyline (tu cua song) thanh cac diem cach ~seg_km, kem chainage."""
    out = []  # (lon, lat, chain_km)
    chain = 0.0
    for (x0, y0), (x1, y1) in zip(points[:-1], points[1:]):
        seg = np.hypot((x1 - x0) * KM_PER_DEG_LAT * np.cos(np.radians(y0)),
                       (y1 - y0) * KM_PER_DEG_LAT)
        n = max(1, int(seg / seg_km))
        for i in range(n):
            t = i / n
            out.append((x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, chain + seg * t))
        chain += seg
    x1, y1 = points[-1]
    out.append((x1, y1, chain))
    return out


def _segments_features(Lr: dict):
    """GeoJSON doan song to mau theo do man voi bang L tung song."""
    features = []
    for key, river in RIVERS.items():
        pts = _densify(river["points"])
        L = Lr[key]
        for (x0, y0, c0), (x1, y1, c1) in zip(pts[:-1], pts[1:]):
            s = S_SEA * np.exp(-((c0 + c1) / 2) / L)
            if s < 0.05:
                s = 0.0
            features.append({
                "type": "Feature",
                "geometry": {"type": "LineString",
                             "coordinates": [[round(x0, 5), round(y0, 5)],
                                             [round(x1, 5), round(y1, 5)]]},
                "properties": {"river": river["name"], "river_id": key,
                               "salinity": round(float(s), 2),
                               "chainage_km": round((c0 + c1) / 2, 1)},
            })
    return features


def _fronts_features(Lr: dict, day: int | None = None):
    """Diem ranh man 4/1 g/l tung song; kem summary {river: {front_..}}."""
    fronts, summary = [], {}
    for key, river in RIVERS.items():
        pts = _densify(river["points"])
        L = Lr[key]
        river_fronts = {}
        for thresh in (4.0, 1.0):
            x_km = L * np.log(S_SEA / thresh)
            river_fronts[f"front_{int(thresh)}gl_km"] = round(float(x_km), 1)
            for (xa, ya, ca), (xb, yb, cb) in zip(pts[:-1], pts[1:]):
                if ca <= x_km <= cb:
                    t = (x_km - ca) / max(cb - ca, 1e-6)
                    props = {"river": river["name"], "river_id": key,
                             "threshold_gl": thresh,
                             "distance_km": round(float(x_km), 1)}
                    if day is not None:
                        props["day"] = day
                    fronts.append({
                        "type": "Feature",
                        "geometry": {"type": "Point",
                                     "coordinates": [round(xa + (xb - xa) * t, 5),
                                                     round(ya + (yb - ya) * t, 5)]},
                        "properties": props,
                    })
                    break
        summary[key] = {"name": river["name"], **river_fronts}
    return fronts, summary


# ----------------------------------------------------------------- zone raster
def compute_zone_raster(terrain, Lr: dict, path: str):
    """Raster do man vung ven song (g/l): S(chainage cell song gan nhat)
    * exp(-dist/LATERAL_KM), cat tai ZONE_MAX_KM. Tra ve stats."""
    L_arr = np.array([Lr.get(name, L0_KM) for name in terrain.river_names],
                     dtype=np.float32)
    rid = np.clip(terrain.river_id, 0, len(L_arr) - 1)
    s = S_SEA * np.exp(-terrain.river_chainage_km / L_arr[rid])
    s = s * np.exp(-terrain.river_dist_km / LATERAL_KM)
    s = np.where(terrain.river_dist_km <= ZONE_MAX_KM, s, 0.0)
    s = np.where(s >= S_MIN, s, 0.0).astype(np.float32)

    profile = dict(
        driver="GTiff", dtype="float32", count=1, width=terrain.nx,
        height=terrain.ny, crs="EPSG:4326", transform=terrain.transform,
        nodata=0.0, tiled=True, blockxsize=256, blockysize=256,
        compress="deflate", predictor=2,
    )
    with rasterio.open(path, "w", **profile) as dst:
        dst.write(s, 1)
        dst.build_overviews([2, 4, 8, 16], rasterio.enums.Resampling.average)
    cell_km2 = 0.0025 * 111.32 * 0.0025 * 111.32 * 0.97
    return {
        "area_over_4gl_km2": round(float((s >= 4.0).sum()) * cell_km2, 0),
        "area_over_1gl_km2": round(float((s >= 1.0).sum()) * cell_km2, 0),
    }


# ------------------------------------------------------------------ 1 thoi diem
def compute_salinity(params: dict, data_dir: str, terrain=None) -> dict:
    q = float(params.get("q_factor", 1.0))
    slr = float(params.get("slr_m", 0.0))
    tide_amp = float(params.get("tide_amp_m", 1.4))
    L = intrusion_length(q, slr, tide_amp)
    Lr = l_by_river(L)

    features = _segments_features(Lr)
    fronts, summary = _fronts_features(Lr)

    result = {
        "type": "salinity",
        "created": datetime.now(timezone.utc).isoformat(),
        "params": {"q_factor": q, "slr_m": slr, "tide_amp_m": tide_amp},
        "intrusion_length_km": round(L, 1),
        "l_by_river_km": {k: round(v, 1) for k, v in Lr.items()},
        "summary": summary,
        "segments": {"type": "FeatureCollection", "features": features},
        "fronts": {"type": "FeatureCollection", "features": fronts},
    }

    # Raster vung anh huong man (neu co terrain)
    if terrain is not None:
        zone_dir = os.path.join(data_dir, "outputs", "salinity")
        os.makedirs(zone_dir, exist_ok=True)
        zone_path = os.path.join(zone_dir, "zone_latest.tif")
        result["zone_stats"] = compute_zone_raster(terrain, Lr, zone_path)
        result["zone_tile_path"] = "/data/outputs/salinity/zone_latest.tif"

    os.makedirs(os.path.join(data_dir, "outputs"), exist_ok=True)
    with open(os.path.join(data_dir, "outputs", "latest_salinity.json"), "w",
              encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False)
    return result


# ------------------------------------------------------------------- du bao
def _station_chainage():
    """Chainage (km tu cua song) cua cac tram do man, tinh tren polyline."""
    out = {}
    for st in STATIONS:
        if st.get("type") not in ("salinity", "both"):
            continue
        river = RIVERS.get(st["river"])
        if not river:
            continue
        pts = _densify(river["points"], seg_km=1.0)
        d2 = [((x - st["lon"]) * KM_PER_DEG_LAT * 0.97) ** 2
              + ((y - st["lat"]) * KM_PER_DEG_LAT) ** 2 for x, y, _ in pts]
        i = int(np.argmin(d2))
        out[st["id"]] = {"station": st, "chainage_km": round(pts[i][2], 1),
                         "off_river_km": round(float(np.sqrt(d2[i])), 1)}
    return out


def compute_forecast(days: list[dict], data_dir: str, terrain=None) -> dict:
    """Du bao xam nhap man theo ngay.

    days: [{date, q_factor, tide_amp_m, slr_m}, ...] - tham so tung ngay
    (server tong hop tu du lieu thuc: quy luat mua + du bao mua + hieu chinh
    theo so lieu do man/muc nuoc thu duoc neu co).
    """
    run_id = datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S") + "-" + uuid.uuid4().hex[:6]
    out_dir = os.path.join(data_dir, "outputs", "salinity", run_id)
    os.makedirs(out_dir, exist_ok=True)

    timeline, all_fronts, files = [], [], []
    seg_features = None
    for i, d in enumerate(days):
        L = intrusion_length(float(d.get("q_factor", 1.0)),
                             float(d.get("slr_m", 0.0)),
                             float(d.get("tide_amp_m", 1.4)))
        Lr = l_by_river(L)
        fronts, summary = _fronts_features(Lr, day=i)
        all_fronts.extend(fronts)
        entry = {
            "date": d.get("date"),
            "params": {k: round(float(d.get(k, 0.0)), 3)
                       for k in ("q_factor", "tide_amp_m", "slr_m")},
            "intrusion_length_km": round(L, 1),
            "l_by_river_km": {k: round(v, 1) for k, v in Lr.items()},
            "summary": summary,
        }
        if terrain is not None:
            fname = f"zone_d{i:02d}.tif"
            entry["zone_stats"] = compute_zone_raster(
                terrain, Lr, os.path.join(out_dir, fname))
            files.append(fname)
        timeline.append(entry)
        if seg_features is None:
            seg_features = _segments_features(Lr)  # hinh hoc + chainage ngay 0

    # Uoc tinh ngay ranh man cham tung tram do man
    stations = []
    st_chain = _station_chainage()
    for sid, info in st_chain.items():
        chain = info["chainage_km"]
        rkey = info["station"]["river"]
        series = []
        arrival4 = arrival1 = None
        for i, entry in enumerate(timeline):
            Lr_day = entry["l_by_river_km"].get(rkey, L0_KM)
            s = S_SEA * float(np.exp(-chain / Lr_day))
            series.append(round(s, 2))
            date = entry["date"]
            if arrival4 is None and s >= 4.0:
                arrival4 = date
            if arrival1 is None and s >= 1.0:
                arrival1 = date
        stations.append({
            "id": sid, "name": info["station"]["name"],
            "river": RIVERS[rkey]["name"], "chainage_km": chain,
            "salinity_gl_by_day": series,
            "first_day_over_4gl": arrival4,
            "first_day_over_1gl": arrival1,
        })

    meta = {
        "type": "salinity_forecast", "run_id": run_id,
        "created": datetime.now(timezone.utc).isoformat(),
        "dates": [d.get("date") for d in days],
        "timeline": timeline,
        "stations": stations,
        "segments": {"type": "FeatureCollection", "features": seg_features or []},
        "fronts": {"type": "FeatureCollection", "features": all_fronts},
        "files": files,
        "zone_tile_path_template":
            f"/data/outputs/salinity/{run_id}/zone_d{{d:02d}}.tif" if files else None,
    }
    with open(os.path.join(out_dir, "metadata.json"), "w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=False)
    with open(os.path.join(data_dir, "outputs", "latest_salinity_forecast.json"),
              "w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=False)
    return meta


# ------------------------------------------------------------------- sampling
def sample_salinity(data_dir: str, lat: float, lon: float):
    """Do man uoc tinh tai 1 diem: theo diem song gan nhat, suy giam ngang
    exp(-d/LATERAL_KM) nhu raster vung anh huong (nhat quan canh bao/ban do)."""
    p = os.path.join(data_dir, "outputs", "latest_salinity.json")
    if not os.path.exists(p):
        return None
    with open(p, encoding="utf-8") as f:
        res = json.load(f)
    best = None
    for feat in res["segments"]["features"]:
        (x0, y0), (x1, y1) = feat["geometry"]["coordinates"]
        xm, ym = (x0 + x1) / 2, (y0 + y1) / 2
        d = np.hypot((xm - lon) * KM_PER_DEG_LAT * np.cos(np.radians(lat)),
                     (ym - lat) * KM_PER_DEG_LAT)
        if best is None or d < best["distance_km"]:
            best = {"distance_km": float(d),
                    "salinity_gl": feat["properties"]["salinity"],
                    "river": feat["properties"]["river"]}
    if best is None or best["distance_km"] > ZONE_MAX_KM:
        return {"salinity_gl": 0.0, "river": None, "distance_km": None,
                "note": "Xa song chinh, uoc tinh do man thap"}
    best["salinity_gl"] = round(
        best["salinity_gl"] * float(np.exp(-best["distance_km"] / LATERAL_KM)), 2)
    best["distance_km"] = round(best["distance_km"], 1)
    return best
