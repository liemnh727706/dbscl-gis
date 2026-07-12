"""Mo hinh xam nhap man 1D doc cac nhanh song chinh DBSCL.

Do man giam theo ham mu tu cua song len thuong nguon (Savenije 2005, dang
don gian hoa):
    S(x) = S_bien * exp(-x / L)
Chieu dai xam nhap L phu thuoc:
  - Dong chay thuong nguon Q (mua kho Q nho -> L lon)
  - Nuoc bien dang SLR va bien do trieu
He so duoc hieu chinh de mua kho dien hinh ranh man 4 g/l vao sau ~45-60 km
(tuong tu so lieu han man 2016, 2020 tren song Ham Luong, Co Chien, Hau).

Ket qua: GeoJSON cac doan song kem do man + diem ranh man 4/1 g/l.
"""
import json
import os
from datetime import datetime, timezone

import numpy as np

from .rivers import RIVERS

S_SEA = 30.0        # g/l tai cua song
L0_KM = 25.0        # chieu dai e-fold co ban (mua kho, q_factor=1)
SEG_KM = 2.0        # do phan giai doan song
KM_PER_DEG_LAT = 111.32


def intrusion_length(q_factor: float, slr_m: float, tide_amp_m: float) -> float:
    q = max(0.2, q_factor)
    L = L0_KM * (1.0 / q) ** 0.7
    L *= 1.0 + 2.0 * max(0.0, slr_m)            # SLR day man vao sau
    L *= 1.0 + 0.25 * (tide_amp_m - 1.4) / 1.4  # trieu manh -> vao sau hon
    return max(3.0, L)


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


def compute_salinity(params: dict, data_dir: str) -> dict:
    q = float(params.get("q_factor", 1.0))
    slr = float(params.get("slr_m", 0.0))
    tide_amp = float(params.get("tide_amp_m", 1.4))
    L = intrusion_length(q, slr, tide_amp)

    features = []
    fronts = []  # ranh man
    summary = {}
    for key, river in RIVERS.items():
        pts = _densify(river["points"])
        # Doan song to mau theo do man
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
        # Vi tri ranh man 4 g/l va 1 g/l
        river_fronts = {}
        for thresh in (4.0, 1.0):
            x_km = L * np.log(S_SEA / thresh)
            river_fronts[f"front_{int(thresh)}gl_km"] = round(float(x_km), 1)
            # tim diem tren polyline
            for (xa, ya, ca), (xb, yb, cb) in zip(pts[:-1], pts[1:]):
                if ca <= x_km <= cb:
                    t = (x_km - ca) / max(cb - ca, 1e-6)
                    fronts.append({
                        "type": "Feature",
                        "geometry": {"type": "Point",
                                     "coordinates": [round(xa + (xb - xa) * t, 5),
                                                     round(ya + (yb - ya) * t, 5)]},
                        "properties": {"river": river["name"], "river_id": key,
                                       "threshold_gl": thresh,
                                       "distance_km": round(float(x_km), 1)},
                    })
                    break
        summary[key] = {"name": river["name"], **river_fronts}

    result = {
        "type": "salinity",
        "created": datetime.now(timezone.utc).isoformat(),
        "params": {"q_factor": q, "slr_m": slr, "tide_amp_m": tide_amp},
        "intrusion_length_km": round(L, 1),
        "summary": summary,
        "segments": {"type": "FeatureCollection", "features": features},
        "fronts": {"type": "FeatureCollection", "features": fronts},
    }
    os.makedirs(os.path.join(data_dir, "outputs"), exist_ok=True)
    with open(os.path.join(data_dir, "outputs", "latest_salinity.json"), "w",
              encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False)
    return result


def sample_salinity(data_dir: str, lat: float, lon: float):
    """Do man uoc tinh tai 1 diem: lay theo diem song gan nhat trong ban kinh
    15 km (nuoc mat ven song/kenh lay tu song chinh)."""
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
    if best is None or best["distance_km"] > 15.0:
        return {"salinity_gl": 0.0, "river": None, "distance_km": None,
                "note": "Xa song chinh, uoc tinh do man thap"}
    best["distance_km"] = round(best["distance_km"], 1)
    return best
