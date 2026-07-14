"""Tai ranh gioi hanh chinh GADM 4.1, loc 13 tinh DBSCL, don gian hoa toa do.

Ket qua (commit vao repo, dung cho choropleth + thong ke theo don vi):
    data/static/provinces.json  - 13 tinh
    data/static/communes.json   - ~1500 xa/phuong

Luu y: GADM 4.1 la ranh gioi TRUOC sap nhap 2025 (13 tinh, xa cu). Khi co
GeoJSON ranh gioi moi (34 tinh), chi can thay 2 file tren - he thong tu dung.

Chay:  py -3 modeling/scripts/fetch_admin_boundaries.py [thu_muc_cache]
"""
import io
import json
import os
import sys
import unicodedata
import urllib.request
import zipfile

URL = "https://geodata.ucdavis.edu/gadm/gadm4.1/json/gadm41_VNM_{lvl}.json.zip"

DELTA_PROVINCES = {
    "angiang", "baclieu", "bentre", "camau", "cantho", "dongthap",
    "haugiang", "kiengiang", "longan", "soctrang", "tiengiang",
    "travinh", "vinhlong",
    # Luu vuc Dong Nai - Sai Gon (mo rong)
    "hochiminh", "dongnai", "binhduong", "tayninh", "baria-vungtau",
}


def no_accent(s):
    s = s.replace("Đ", "D").replace("đ", "d")
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode().lower()
    return s.replace(" ", "")  # GADM VN viet dinh lien: "AnGiang", "CanTho"


def add_spaces(s):
    """GADM VN dinh lien tu: 'AnGiang' -> 'An Giang', 'MỹHòa' -> 'Mỹ Hòa'."""
    if not s:
        return s
    out = [s[0]]
    for ch in s[1:]:
        if ch.isupper() and (out[-1].islower() or out[-1].isdigit()):
            out.append(" ")
        out.append(ch)
    return "".join(out)


def load_gadm(lvl, cache_dir):
    cached = os.path.join(cache_dir, f"gadm41_VNM_{lvl}.json")
    if os.path.exists(cached):
        with open(cached, encoding="utf-8") as f:
            return json.load(f)
    print(f"Tai GADM level {lvl}...")
    req = urllib.request.Request(URL.format(lvl=lvl),
                                 headers={"User-Agent": "mekong-flood-sim/1.0"})
    with urllib.request.urlopen(req, timeout=300) as r:
        zf = zipfile.ZipFile(io.BytesIO(r.read()))
    return json.loads(zf.read(zf.namelist()[0]).decode("utf-8"))


def simplify_coords(coords, ndigits=4):
    """Lam tron toa do + bo diem trung lien tiep (giam ~60% dung luong)."""
    if isinstance(coords[0], (int, float)):
        return [round(coords[0], ndigits), round(coords[1], ndigits)]
    out = []
    for c in coords:
        s = simplify_coords(c, ndigits)
        if not out or s != out[-1]:
            out.append(s)
    return out


def convert(gj, lvl):
    feats = []
    for f in gj["features"]:
        p = f["properties"]
        if no_accent(p.get("NAME_1", "")) not in DELTA_PROVINCES:
            continue
        props = {"province": add_spaces(p.get("NAME_1"))}
        if lvl == 3:
            props.update({
                "district": add_spaces(p.get("NAME_2")),
                "name": add_spaces(p.get("NAME_3")),
                "type": p.get("TYPE_3", ""),
                "gid": p.get("GID_3"),
            })
        else:
            props.update({"name": add_spaces(p.get("NAME_1")), "gid": p.get("GID_1")})
        feats.append({
            "type": "Feature",
            "properties": props,
            "geometry": {
                "type": f["geometry"]["type"],
                "coordinates": simplify_coords(f["geometry"]["coordinates"]),
            },
        })
    return {"type": "FeatureCollection", "features": feats}


def main():
    cache_dir = sys.argv[1] if len(sys.argv) > 1 else "."
    out_dir = os.path.join(os.path.dirname(__file__), "..", "..", "data", "static")
    os.makedirs(out_dir, exist_ok=True)
    for lvl, fname in [(1, "provinces.json"), (3, "communes.json")]:
        gj = convert(load_gadm(lvl, cache_dir), lvl)
        dest = os.path.join(out_dir, fname)
        with open(dest, "w", encoding="utf-8") as f:
            json.dump(gj, f, ensure_ascii=False, separators=(",", ":"))
        mb = os.path.getsize(dest) / 1e6
        print(f"{fname}: {len(gj['features'])} don vi, {mb:.1f} MB")


if __name__ == "__main__":
    main()
