"""Tai DEM Copernicus GLO-30 cho DBSCL tu OpenTopography (mien phi, can API key).

Dang ky key tai: https://portal.opentopography.org/ (menu MyOpenTopo > API key)

Cach dung:
    OPENTOPO_KEY=xxxx python scripts/download_dem.py
Ket qua: data/dem/dem.tif  ->  he thong tu dong dung DEM that thay cho DEM
tong hop o lan khoi dong sau (xoa data/dem/terrain_cache.npz de rebuild).
"""
import os
import sys
import urllib.request

BBOX = (104.4, 8.4, 107.0, 11.3)  # lon_min, lat_min, lon_max, lat_max
OUT = os.path.join(os.path.dirname(__file__), "..", "..", "data", "dem", "dem.tif")


def main():
    key = os.environ.get("OPENTOPO_KEY")
    if not key:
        sys.exit("Thieu bien moi truong OPENTOPO_KEY (dang ky mien phi tai portal.opentopography.org)")
    url = (
        "https://portal.opentopography.org/API/globaldem"
        f"?demtype=COP30&south={BBOX[1]}&north={BBOX[3]}"
        f"&west={BBOX[0]}&east={BBOX[2]}&outputFormat=GTiff&API_Key={key}"
    )
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    print("Dang tai Copernicus GLO-30 DEM (~200-400 MB)...")
    urllib.request.urlretrieve(url, OUT)
    print(f"Xong: {os.path.abspath(OUT)}")
    cache = os.path.join(os.path.dirname(OUT), "terrain_cache.npz")
    if os.path.exists(cache):
        os.remove(cache)
        print("Da xoa terrain_cache.npz - se rebuild voi DEM that.")


if __name__ == "__main__":
    main()
