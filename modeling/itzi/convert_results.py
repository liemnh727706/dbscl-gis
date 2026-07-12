"""Xuat ket qua Itzi (GRASS strds water_depth) thanh chuoi GeoTIFF + metadata.json
de web hien thi nhu mot "kich ban".

Chay BEN TRONG grass session (grass ... --exec python convert_results.py ...)
hoac voi grass-session. Yeu cau: gdal_translate co san.
"""
import argparse
import json
import os
import subprocess
from datetime import datetime, timezone


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--strds", required=True, help="ten strds, vd flood_out_water_depth")
    ap.add_argument("--name", required=True, help="ma kich ban, vd lu_2011")
    ap.add_argument("--title", required=True, help="ten hien thi")
    ap.add_argument("--out", required=True, help="thu muc data/outputs/scenarios")
    args = ap.parse_args()

    out_dir = os.path.join(args.out, args.name)
    os.makedirs(out_dir, exist_ok=True)

    # Liet ke cac raster trong strds
    r = subprocess.run(
        ["t.rast.list", f"input={args.strds}", "columns=name,start_time",
         "format=csv"], capture_output=True, text=True, check=True)
    rows = [l.split(",") for l in r.stdout.strip().splitlines()[1:]]

    times, files = [], []
    for i, (rast, start_time) in enumerate(rows):
        fname = f"depth_t{i:02d}.tif"
        # Xuat ra EPSG:4326 GTiff tiled de TiTiler doc
        subprocess.run(["r.out.gdal", f"input={rast}",
                        f"output={os.path.join(out_dir, fname)}",
                        "format=GTiff", "createopt=TILED=YES,COMPRESS=DEFLATE",
                        "-f"], check=True)
        times.append(start_time.strip())
        files.append(fname)

    meta = {
        "run_id": args.name, "type": "flood", "engine": "itzi",
        "title": args.title,
        "created": datetime.now(timezone.utc).isoformat(),
        "times": times, "files": files,
        "tile_path_template": f"/data/outputs/scenarios/{args.name}/depth_t{{t:02d}}.tif",
    }
    with open(os.path.join(out_dir, "metadata.json"), "w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=False, indent=1)
    print(f"Da xuat {len(files)} buoc thoi gian -> {out_dir}")


if __name__ == "__main__":
    main()
