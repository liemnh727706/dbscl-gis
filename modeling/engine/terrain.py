"""Xay dung luoi dia hinh cho DBSCL: DEM, HAND, khoang cach toi song/bien.

- Neu co file {DATA_DIR}/dem/dem.tif (DEM thuc, vd Copernicus GLO-30 tai bang
  scripts/download_dem.py) -> resample ve luoi tinh toan.
- Neu khong -> sinh DEM tong hop (synthetic) co dang dia hinh dong bang:
  thap dan ve phia bien, long song duoc "khac" vao DEM. Du dung de demo.

HAND (Height Above Nearest Drainage) duoc xap xi bang:
  HAND = DEM - DEM(cell song gan nhat)
Voi dong bang phang va mang song day dac, day la xap xi hop ly va rat nhanh.
Ket qua duoc cache vao {DATA_DIR}/dem/terrain_cache.npz.
"""
import hashlib
import json
import os

import numpy as np
from scipy import ndimage

from .rivers import RIVERS, COASTLINE

# Pham vi luoi: toan DBSCL
BBOX = (104.4, 8.4, 107.0, 11.3)   # lon_min, lat_min, lon_max, lat_max
RES = 0.0025                        # ~275 m/cell
KM_PER_DEG_LAT = 111.32

CACHE_VERSION = 9  # doi khi thuat toan build thay doi

def _rivers_hash():
    """Hash hinh hoc song de cache tu vo hieu khi rivers_osm.json cap nhat."""
    blob = json.dumps({k: r["points"] for k, r in RIVERS.items()}, sort_keys=True)
    return hashlib.sha256(blob.encode()).hexdigest()[:16]


class Terrain:
    def __init__(self, data_dir: str):
        self.data_dir = data_dir
        self.lon_min, self.lat_min, self.lon_max, self.lat_max = BBOX
        self.nx = int(round((self.lon_max - self.lon_min) / RES))
        self.ny = int(round((self.lat_max - self.lat_min) / RES))
        # transform kieu rasterio (north-up): hang 0 = lat_max
        from rasterio.transform import from_origin
        self.transform = from_origin(self.lon_min, self.lat_max, RES, RES)
        self._build_or_load()

    # ------------------------------------------------------------------
    def rowcol(self, lat: float, lon: float):
        col = int((lon - self.lon_min) / RES)
        row = int((self.lat_max - lat) / RES)
        if 0 <= row < self.ny and 0 <= col < self.nx:
            return row, col
        return None

    # ------------------------------------------------------------------
    def _build_or_load(self):
        cache = os.path.join(self.data_dir, "dem", "terrain_cache.npz")
        dem_tif = os.path.join(self.data_dir, "dem", "dem.tif")
        use_real = os.path.exists(dem_tif)
        if os.path.exists(cache):
            z = np.load(cache)
            if (int(z.get("version", 0)) == CACHE_VERSION
                    and str(z.get("rivers_hash", "")) == _rivers_hash()
                    and bool(z["real_dem"]) == use_real):
                self.dem = z["dem"]; self.hand = z["hand"]
                self.river_dist_km = z["river_dist_km"]
                self.river_chainage_km = z["river_chainage_km"]
                self.river_id = z["river_id"]
                self.sea_dist_km = z["sea_dist_km"]
                self.river_names = list(z["river_names"])
                self.real_dem = use_real
                return
        self._build(use_real, dem_tif)
        os.makedirs(os.path.dirname(cache), exist_ok=True)
        np.savez_compressed(
            cache, version=CACHE_VERSION, rivers_hash=_rivers_hash(),
            real_dem=use_real, dem=self.dem,
            hand=self.hand, river_dist_km=self.river_dist_km,
            river_chainage_km=self.river_chainage_km, river_id=self.river_id,
            sea_dist_km=self.sea_dist_km, river_names=np.array(self.river_names),
        )

    # ------------------------------------------------------------------
    def _rasterize_lines(self, lines):
        """Danh dau cell nam tren cac polyline. Tra ve mask boolean."""
        mask = np.zeros((self.ny, self.nx), dtype=bool)
        for pts in lines:
            for (x0, y0), (x1, y1) in zip(pts[:-1], pts[1:]):
                n = max(2, int(max(abs(x1 - x0), abs(y1 - y0)) / (RES * 0.5)))
                for t in np.linspace(0, 1, n):
                    rc = self.rowcol(y0 + (y1 - y0) * t, x0 + (x1 - x0) * t)
                    if rc:
                        mask[rc] = True
        return mask

    def _river_cells(self):
        """Mask song + chainage (km tu cua song) + id song cho tung cell song."""
        mask = np.zeros((self.ny, self.nx), dtype=bool)
        chain = np.zeros((self.ny, self.nx), dtype=np.float32)
        rid = np.full((self.ny, self.nx), -1, dtype=np.int16)
        self.river_names = list(RIVERS.keys())
        for i, key in enumerate(self.river_names):
            pts = RIVERS[key]["points"]
            dist = 0.0
            for (x0, y0), (x1, y1) in zip(pts[:-1], pts[1:]):
                seg_km = np.hypot((x1 - x0) * KM_PER_DEG_LAT * np.cos(np.radians(y0)),
                                  (y1 - y0) * KM_PER_DEG_LAT)
                n = max(2, int(max(abs(x1 - x0), abs(y1 - y0)) / (RES * 0.5)))
                for t in np.linspace(0, 1, n):
                    rc = self.rowcol(y0 + (y1 - y0) * t, x0 + (x1 - x0) * t)
                    if rc:
                        mask[rc] = True
                        chain[rc] = dist + seg_km * t
                        rid[rc] = i
                dist += seg_km
        return mask, chain, rid

    # ------------------------------------------------------------------
    def _build(self, use_real: bool, dem_tif: str):
        ny, nx = self.ny, self.nx
        cell_km = RES * KM_PER_DEG_LAT

        river_mask, chainage, rid = self._river_cells()
        coast_mask = self._rasterize_lines([COASTLINE])

        # Khoang cach toi bien / toi song (km) + chi so cell song gan nhat
        sea_dist = ndimage.distance_transform_edt(~coast_mask) * cell_km
        river_dist, idx = ndimage.distance_transform_edt(
            ~river_mask, return_indices=True)
        river_dist = (river_dist * cell_km).astype(np.float32)
        near_r, near_c = idx[0], idx[1]

        if use_real:
            dem = self._load_real_dem(dem_tif)
        else:
            dem = self._synthetic_dem(sea_dist, river_mask)

        # HAND: do cao so voi MAT NUOC song gan nhat.
        # DEM tong hop khac long song xuong -2 m (day song) -> tham chieu phai
        # la mat nuoc ~0 m; DEM ve tinh (COP30) do mat nuoc nen giu nguyen gia
        # tri duong. Do do clip tham chieu ve >= 0.
        ref_at_river = np.maximum(dem[near_r, near_c], 0.0)
        hand = np.maximum(dem - ref_at_river, 0).astype(np.float32)

        self.dem = dem.astype(np.float32)
        self.hand = hand
        self.river_dist_km = river_dist
        self.river_chainage_km = chainage[near_r, near_c].astype(np.float32)
        self.river_id = rid[near_r, near_c].astype(np.int16)
        self.sea_dist_km = sea_dist.astype(np.float32)
        self.real_dem = use_real

    def _load_real_dem(self, path: str):
        import rasterio
        from rasterio.warp import reproject, Resampling
        dem = np.empty((self.ny, self.nx), dtype=np.float32)
        with rasterio.open(path) as src:
            reproject(
                rasterio.band(src, 1), dem,
                dst_transform=self.transform, dst_crs="EPSG:4326",
                resampling=Resampling.bilinear)
        dem = np.where(np.isfinite(dem), dem, 0.0)
        return np.clip(dem, -5, 50)

    def _synthetic_dem(self, sea_dist, river_mask):
        """DEM tong hop: dong bang thap (0.3-3.5 m), cao dan vao noi dia,
        vung nui That Son (An Giang) nho ve phia tay bac, long song ~ -2 m."""
        rng = np.random.default_rng(42)
        ny, nx = self.ny, self.nx
        # DBSCL phan lon chi cao 0.2-2.0 m; vung trung Dong Thap Muoi / Tu giac
        # Long Xuyen ngap sau mua lu la dung thuc te
        base = 0.2 + 1.8 * np.clip(sea_dist / 150.0, 0, 1) ** 1.4
        noise = ndimage.gaussian_filter(rng.normal(0, 1, (ny, nx)), 6) * 0.45
        lon = self.lon_min + (np.arange(nx) + 0.5) * RES
        lat = self.lat_max - (np.arange(ny) + 0.5) * RES
        LON, LAT = np.meshgrid(lon, lat)
        # Nui That Son (An Giang) - cum nui nho ~10 km
        bump = 4.0 * np.exp(-(((LON - 104.93) ** 2 + (LAT - 10.52) ** 2) / (2 * 0.07 ** 2)))
        # Hai vung trung ngap lu dien hinh: Dong Thap Muoi va Tu giac Long Xuyen
        dtm = -0.9 * np.exp(-(((LON - 105.65) ** 2) / (2 * 0.38 ** 2)
                              + ((LAT - 10.65) ** 2) / (2 * 0.22 ** 2)))
        tglx = -0.7 * np.exp(-(((LON - 105.00) ** 2) / (2 * 0.28 ** 2)
                               + ((LAT - 10.42) ** 2) / (2 * 0.20 ** 2)))
        dem = (base + noise + bump + dtm + tglx).astype(np.float32)
        # Giong dat ven song (natural levee) + long song
        levee_zone = ndimage.distance_transform_edt(~river_mask) * RES * KM_PER_DEG_LAT
        dem += np.where(levee_zone < 2.0, 0.6 * (1 - levee_zone / 2.0), 0).astype(np.float32)
        dem[river_mask] = -2.0
        return np.clip(dem, -3, 8)


_terrain = None

def get_terrain(data_dir: str) -> Terrain:
    global _terrain
    if _terrain is None:
        _terrain = Terrain(data_dir)
    return _terrain
