"""Lay hinh hoc song that tu OpenStreetMap (Overpass API) va neo (snap)
polyline mo phong vao dung long song.

Cach lam: voi moi song, tai tat ca way waterway=river/canal co ten khop
(regex dung '.' thay ky tu co dau de tranh loi Unicode normalization cua
Overpass), roi gom diem OSM theo tung doan 2 km doc polyline tho (chainage),
lay trong tam moi doan -> duong tam song bam sat thuc te, khong zigzag khi
song phan nhanh quanh cu lao.

Ket qua: modeling/engine/rivers_osm.json (commit vao repo, khong can goi
Overpass luc runtime). Chay lai khi muon cap nhat:
    py -3 modeling/scripts/fetch_rivers_osm.py
"""
import json
import os
import sys
import time
import urllib.parse
import urllib.request

import numpy as np

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from engine.rivers import RIVERS  # noqa: E402

OVERPASS = "https://overpass-api.de/api/interpreter"
UA = "mekong-flood-sim/1.0 (contact: liemnh@hcmuaf.edu.vn)"
KM_PER_DEG = 111.32

# Regex ten song trong OSM - dung '.' cho ky tu co dau
NAME_RE = {
    "song_hau": r"S.ng H.u",
    "song_tien": r"S.ng Ti.n|S.ng M. Tho|S.ng C.a Ti.u",
    "ham_luong": r"H.m Lu.ng",
    "co_chien": r"C. Chi.n",
    "vam_co": r"V.m C.",
    "cai_lon": r"S.ng C.i L.n",
    "ganh_hao": r"G.nh H.o",
    "ong_doc": r"S.ng .ng ..c",
}

BIN_KM = 2.0        # do phan giai duong tam song
CORRIDOR_KM = 8.0   # chi nhan diem OSM cach polyline tho < 8 km
MARGIN_DEG = 0.15   # noi rong bbox quanh polyline tho


def fetch_ways(name_re, bbox):
    s, w, n, e = bbox
    q = (f'[out:json][timeout:90];way["waterway"~"^(river|canal)$"]'
         f'["name"~"{name_re}"]({s},{w},{n},{e});out geom;')
    req = urllib.request.Request(
        OVERPASS, data=urllib.parse.urlencode({"data": q}).encode(),
        headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=120) as r:
        return json.load(r)["elements"]


def densify(points, step_km=0.5):
    """Polyline tho -> diem tham chieu deu ~step_km kem chainage tu cua song."""
    out, chain = [], 0.0
    for (x0, y0), (x1, y1) in zip(points[:-1], points[1:]):
        seg = np.hypot((x1 - x0) * KM_PER_DEG * np.cos(np.radians(y0)),
                       (y1 - y0) * KM_PER_DEG)
        n = max(1, int(seg / step_km))
        for i in range(n):
            t = i / n
            out.append((x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, chain + seg * t))
        chain += seg
    out.append((*points[-1], chain))
    return np.array(out)  # cols: lon, lat, chain_km


def snap_river(key, river):
    pts = river["points"]
    lons = [p[0] for p in pts]; lats = [p[1] for p in pts]
    bbox = (min(lats) - MARGIN_DEG, min(lons) - MARGIN_DEG,
            max(lats) + MARGIN_DEG, max(lons) + MARGIN_DEG)
    ways = fetch_ways(NAME_RE[key], bbox)
    osm = np.array([(g["lon"], g["lat"]) for w in ways
                    for g in w.get("geometry", [])])
    print(f"  {key}: {len(ways)} ways, {len(osm)} diem OSM", end="")
    if len(osm) < 30:
        print("  -> QUA IT, giu polyline tho")
        return None

    ref = densify(pts)
    lat0 = np.radians(np.mean(lats))
    # Toa do phang (km) de tinh khoang cach
    def to_xy(a):
        return np.column_stack([a[:, 0] * KM_PER_DEG * np.cos(lat0),
                                a[:, 1] * KM_PER_DEG])
    ref_xy, osm_xy = to_xy(ref), to_xy(osm)
    # Voi moi diem OSM: diem tham chieu gan nhat -> (khoang cach, chainage)
    d2 = ((osm_xy[:, None, :] - ref_xy[None, :, :]) ** 2).sum(axis=2)
    near = d2.argmin(axis=1)
    dist = np.sqrt(d2[np.arange(len(osm)), near])
    chain = ref[near, 2]
    keep = dist < CORRIDOR_KM
    osm, chain = osm[keep], chain[keep]
    if len(osm) < 30:
        print("  -> QUA IT sau loc corridor, giu polyline tho")
        return None

    # Trong tam theo tung doan chainage
    total = ref[-1, 2]
    nbin = int(total / BIN_KM) + 1
    idx = np.clip((chain / BIN_KM).astype(int), 0, nbin - 1)
    sums = np.zeros((nbin, 2)); cnt = np.zeros(nbin)
    np.add.at(sums, idx, osm); np.add.at(cnt, idx, 1)
    have = cnt > 0
    cent = np.full((nbin, 2), np.nan)
    cent[have] = sums[have] / cnt[have][:, None]
    # Lap doan thieu bang noi suy tuyen tinh theo chainage
    xs = np.arange(nbin) * BIN_KM
    for c in range(2):
        cent[:, c] = np.interp(xs, xs[have], cent[have, c])
    # Lam muot nhe (trung binh truot 3)
    k = np.ones(3) / 3
    for c in range(2):
        cent[1:-1, c] = np.convolve(cent[:, c], k, mode="valid")
    print(f" -> {nbin} diem tam song ({total:.0f} km)")
    return [[round(float(x), 5), round(float(y), 5)] for x, y in cent]


def main():
    out = {}
    for key, river in RIVERS.items():
        for attempt in range(3):
            try:
                snapped = snap_river(key, river)
                break
            except Exception as ex:
                print(f"  {key}: loi {ex}, thu lai...")
                time.sleep(10)
                snapped = None
        if snapped:
            out[key] = {"points": snapped, "source": "osm-overpass"}
        time.sleep(3)  # lich su voi Overpass
    dest = os.path.join(os.path.dirname(__file__), "..", "engine", "rivers_osm.json")
    with open(dest, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False)
    print(f"Da ghi {len(out)}/{len(RIVERS)} song -> {os.path.abspath(dest)}")


if __name__ == "__main__":
    main()
