"""Thong ke ngap lut / xam nhap man theo don vi hanh chinh (tinh, xa/phuong).

Ranh gioi tu data/static/provinces.json + communes.json (GADM, sinh boi
scripts/fetch_admin_boundaries.py). Moi don vi duoc rasterize len luoi tinh
toan 1 lan (cache .npz), sau do thong ke tu raster do sau ngap max +
raster do man cua lan mo phong gan nhat:
    - max_depth_m, mean_depth_m, pct_flooded (% dien tich ngap > 5 cm)
    - max_salinity_gl, mean_salinity_gl
Ket qua tra ve GeoJSON de ve choropleth tren ban do.
"""
import json
import os

import numpy as np

LEVELS = {"province": "provinces.json", "commune": "communes.json"}
FLOOD_THRESH = 0.05  # m


def _static_path(data_dir, level):
    return os.path.join(data_dir, "static", LEVELS[level])


def _load_geojson(data_dir, level):
    with open(_static_path(data_dir, level), encoding="utf-8") as f:
        return json.load(f)


def _zone_grid(terrain, data_dir, level):
    """Raster id don vi (int32, -1 = ngoai vung). Cache theo mtime file ranh gioi."""
    src = _static_path(data_dir, level)
    cache = os.path.join(data_dir, "static", f"zonegrid_{level}.npz")
    mtime = os.path.getmtime(src)
    if os.path.exists(cache):
        z = np.load(cache)
        if float(z["mtime"]) == mtime and z["grid"].shape == (terrain.ny, terrain.nx):
            return z["grid"]
    from rasterio import features
    gj = _load_geojson(data_dir, level)
    shapes = [(f["geometry"], i) for i, f in enumerate(gj["features"])]
    grid = features.rasterize(
        shapes, out_shape=(terrain.ny, terrain.nx), transform=terrain.transform,
        fill=-1, dtype="int32")
    np.savez_compressed(cache, grid=grid, mtime=mtime)
    return grid


def _read_raster(path):
    if not path or not os.path.exists(path):
        return None
    import rasterio
    with rasterio.open(path) as src:
        return src.read(1)


def zonal_stats(terrain, data_dir, level, depth_max_path, salinity_path):
    """GeoJSON ranh gioi kem thong ke ngap/man cua lan mo phong gan nhat."""
    gj = _load_geojson(data_dir, level)
    grid = _zone_grid(terrain, data_dir, level)
    n = len(gj["features"])
    flat = grid.ravel()
    inside = flat >= 0
    idx = flat[inside]
    counts = np.bincount(idx, minlength=n).astype(float)
    counts[counts == 0] = 1  # tranh chia 0 cho don vi qua nho so voi luoi

    def agg(raster):
        v = raster.ravel()[inside]
        vmax = np.zeros(n); np.maximum.at(vmax, idx, v)
        vmean = np.bincount(idx, weights=v, minlength=n) / counts
        return vmax, vmean

    depth = _read_raster(depth_max_path)
    salt = _read_raster(salinity_path)
    d_max = d_mean = pct = s_max = s_mean = None
    if depth is not None:
        d_max, d_mean = agg(depth)
        wet = (depth > FLOOD_THRESH).astype(float)
        pct = 100.0 * np.bincount(idx, weights=wet.ravel()[inside], minlength=n) / counts
    if salt is not None:
        s_max, s_mean = agg(salt)

    for i, f in enumerate(gj["features"]):
        p = f["properties"]
        if depth is not None:
            p["max_depth_m"] = round(float(d_max[i]), 2)
            p["mean_depth_m"] = round(float(d_mean[i]), 2)
            p["pct_flooded"] = round(float(pct[i]), 1)
        if salt is not None:
            p["max_salinity_gl"] = round(float(s_max[i]), 2)
            p["mean_salinity_gl"] = round(float(s_mean[i]), 2)
    return gj
