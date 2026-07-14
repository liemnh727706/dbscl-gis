"""Tai DEM Copernicus GLO-30 (30 m) cho vung mo phong -> data/dem/dem.tif

Nguon mac dinh: AWS Open Data (bucket cong khai cua Copernicus, KHONG can
API key): https://registry.opendata.aws/copernicus-dem/
Tai cac o 1x1 do trong BBOX, ghep va lay mau lai ~0.001 do (~110 m) - du
chi tiet cho luoi tinh 0.0025 do, file gon (~15-40 MB).

Neu dat bien moi truong OPENTOPO_KEY thi dung OpenTopography API thay the.

Cach dung:
    py -3 modeling/scripts/download_dem.py
Sau do khoi dong lai modeling service - he thong tu phat hien dem.tif,
rebuild HAND tu DEM that (terrain_cache.npz).

Luu y: GLO-30 la DSM (do ca tan cay/nha cua) - vung rung ngap man co the
cao hon mat dat vai met.
"""
import os
import sys
import urllib.request

BBOX = (104.4, 8.4, 107.45, 11.35)  # phai trung engine/terrain.py
OUT_RES = 0.001                      # ~110 m
AWS = ("https://copernicus-dem-30m.s3.amazonaws.com/"
       "Copernicus_DSM_COG_10_N{lat:02d}_00_E{lon:03d}_00_DEM/"
       "Copernicus_DSM_COG_10_N{lat:02d}_00_E{lon:03d}_00_DEM.tif")

ROOT = os.path.join(os.path.dirname(__file__), "..", "..")
OUT = os.path.join(ROOT, "data", "dem", "dem.tif")


def download_opentopo(key):
    url = ("https://portal.opentopography.org/API/globaldem"
           f"?demtype=COP30&south={BBOX[1]}&north={BBOX[3]}"
           f"&west={BBOX[0]}&east={BBOX[2]}&outputFormat=GTiff&API_Key={key}")
    print("Dang tai qua OpenTopography...")
    urllib.request.urlretrieve(url, OUT)


def download_aws(tmp_dir):
    """Tai cac o GLO-30 trong bbox tu AWS, ghep + lay mau lai ve OUT."""
    import numpy as np
    import rasterio
    from rasterio.merge import merge
    from rasterio.enums import Resampling

    os.makedirs(tmp_dir, exist_ok=True)
    paths = []
    for lat in range(int(BBOX[1]), int(BBOX[3]) + 1):
        for lon in range(int(BBOX[0]), int(BBOX[2]) + 1):
            url = AWS.format(lat=lat, lon=lon)
            dest = os.path.join(tmp_dir, f"N{lat:02d}_E{lon:03d}.tif")
            if os.path.exists(dest):
                paths.append(dest); continue
            try:
                print(f"  tai N{lat:02d} E{lon:03d}...", end=" ", flush=True)
                urllib.request.urlretrieve(url, dest)
                print(f"{os.path.getsize(dest) / 1e6:.0f} MB")
                paths.append(dest)
            except Exception as ex:  # o toan bien -> khong ton tai
                print(f"bo qua ({ex})")
                if os.path.exists(dest):
                    os.remove(dest)
    if not paths:
        sys.exit("Khong tai duoc o DEM nao")

    print(f"Ghep {len(paths)} o -> {OUT_RES} do...")
    srcs = [rasterio.open(p) for p in paths]
    mosaic, transform = merge(
        srcs, bounds=BBOX, res=OUT_RES, resampling=Resampling.average,
        nodata=0.0)
    for s in srcs:
        s.close()
    dem = np.where(np.isfinite(mosaic[0]), mosaic[0], 0).astype("float32")
    profile = dict(
        driver="GTiff", dtype="float32", count=1,
        width=dem.shape[1], height=dem.shape[0],
        crs="EPSG:4326", transform=transform, nodata=None,
        tiled=True, blockxsize=256, blockysize=256,
        compress="deflate", predictor=2)
    with rasterio.open(OUT, "w", **profile) as dst:
        dst.write(dem, 1)


def main():
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    key = os.environ.get("OPENTOPO_KEY")
    if key:
        download_opentopo(key)
    else:
        tmp = os.environ.get("DEM_TMP",
                             os.path.join(ROOT, "data", "dem", "tiles"))
        download_aws(tmp)
    print(f"Xong: {os.path.abspath(OUT)} "
          f"({os.path.getsize(OUT) / 1e6:.1f} MB)")
    cache = os.path.join(os.path.dirname(OUT), "terrain_cache.npz")
    if os.path.exists(cache):
        os.remove(cache)
        print("Da xoa terrain_cache.npz - khoi dong lai modeling de rebuild.")


if __name__ == "__main__":
    main()
