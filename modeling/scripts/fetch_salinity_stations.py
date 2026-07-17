"""Tai danh muc tram do man noi dong DBSCL tu CSDL Thuy loi (Cuc Thuy loi).

Nguon: GeoServer cong khai cua thuyloivietnam.gov.vn/dwh
  https://gs.vbeta.net/geoserver/dubaonguonnuoc  (WFS, khong can key)
  lop: dubaonguonnuoc:tramdomnnoidongscl (115 tram, ma KTTV that)

Ket qua: modeling/engine/stations_scl.json (commit vao repo, khong goi mang
luc runtime). Chay lai khi muon cap nhat danh muc tram:
    py -3 modeling/scripts/fetch_salinity_stations.py
"""
import json
import os
import urllib.request

WFS = os.environ.get(
    "THUYLOI_WFS_URL",
    "https://gs.vbeta.net/geoserver/dubaonguonnuoc/wfs")
LAYER = "dubaonguonnuoc:tramdomnnoidongscl"

# Khung DBSCL (loc tram catalog nam ngoai, vd Bien Ho - Campuchia)
LON_MIN, LON_MAX, LAT_MIN, LAT_MAX = 104.0, 107.6, 8.0, 11.6


def fetch():
    q = (f"{WFS}?service=WFS&version=2.0.0&request=GetFeature"
         f"&typeNames={LAYER}&outputFormat=application/json&srsName=EPSG:4326")
    req = urllib.request.Request(q, headers={"accept": "application/json"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)


def main():
    fc = fetch()
    out = []
    for f in fc.get("features", []):
        p = f.get("properties", {})
        g = f.get("geometry") or {}
        coords = g.get("coordinates")
        lon = p.get("x") if p.get("x") is not None else (coords[0] if coords else None)
        lat = p.get("y") if p.get("y") is not None else (coords[1] if coords else None)
        if lon is None or lat is None:
            continue
        lon, lat = float(lon), float(lat)
        if not (LON_MIN < lon < LON_MAX and LAT_MIN < lat < LAT_MAX):
            continue
        out.append({
            "id": p.get("ma") or f"MN{p.get('stt')}",
            "name": p.get("tram"),
            "lat": round(lat, 5),
            "lon": round(lon, 5),
            "type": "salinity",
            "subregion": p.get("tieuvung") or p.get("mavung"),
            "source": "thuyloi-dwh",
        })
    out.sort(key=lambda s: s["id"])
    dest = os.path.join(os.path.dirname(__file__), "..", "engine",
                        "stations_scl.json")
    with open(dest, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=0)
    print(f"Da ghi {len(out)} tram do man DBSCL -> {os.path.abspath(dest)}")


if __name__ == "__main__":
    main()
