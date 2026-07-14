"""Lay hinh hoc song that tu OpenStreetMap (Overpass API) bang dinh tuyen
do thi tren mang luoi song.

Cach lam (v2 - thay cho phuong phap trong tam theo bin cu, von cho duong tam
roi len dat lien khi song tach nhanh quanh cu lao):
  1. Voi moi song, tai (a) cac way waterway=river/canal co ten khop regex va
     (b) toan bo way waterway=river trong bbox (lam doan noi khi doan song
     doi ten / khong ten).
  2. Xay do thi node-canh tu hinh hoc way, chi giu node trong hanh lang
     CORRIDOR_KM quanh polyline tho. Canh uu tien way co ten khop
     (COST_NAMED), way song khac bi phat (COST_RIVER); node gan nhau giua
     hai way khong chia se node duoc "bac cau" voi phat lon (COST_BRIDGE).
  3. Dijkstra tu cua song len thuong nguon -> duong di bam DUNG long song
     that (moi diem deu nam tren hinh hoc way OSM), khong con doan cat qua
     dat lien.
  4. Resample ~1 km/diem, ghi modeling/engine/rivers_osm.json.

Chay lai khi muon cap nhat (can Internet toi overpass-api.de):
    py -3 modeling/scripts/fetch_rivers_osm.py
"""
import heapq
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request

import numpy as np
from scipy.spatial import cKDTree

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from engine.rivers import RIVERS  # noqa: E402

OVERPASS = os.environ.get("OVERPASS_URL",
                          "https://overpass-api.de/api/interpreter")
UA = "mekong-flood-sim/1.0 (contact: liemnh@hcmuaf.edu.vn)"
KM_PER_DEG = 111.32

# Regex ten song trong OSM - dung '.' cho ky tu co dau
NAME_RE = {
    "song_hau": r"S.ng H.u|Bassac",
    "song_tien": r"S.ng Ti.n|S.ng M. Tho|C.a Ti.u|C.a ..i",
    "ham_luong": r"H.m Lu.ng",
    "co_chien": r"C. Chi.n",
    "vam_co": r"V.m C.",
    "cai_lon": r"C.i L.n",
    "ganh_hao": r"G.nh H.o",
    "ong_doc": r".ng ..c",
    # Sai Gon & Dong Nai cung do ra cua Soai Rap qua song Nha Be
    "song_saigon": r"S.i G.n|Nh. B.|So.i R.p",
    "song_dongnai": r"S.ng ..ng Nai|Nh. B.|So.i R.p",
}

CORRIDOR_KM = 10.0    # chi giu node cach polyline tho < 10 km
MARGIN_DEG = 0.15     # noi rong bbox quanh polyline tho
COST_NAMED = 1.0      # trong so canh: way co ten khop
COST_RIVER = 4.0      # way waterway=river khac (doan noi)
COST_CANAL = 12.0     # way canal co ten khop (Vam Co co doan canal)
BRIDGE_M = 250.0      # noi 2 node < 250 m khong chung way
COST_BRIDGE = 25.0
STEP_KM = 1.0         # do phan giai ket qua


def overpass(query):
    req = urllib.request.Request(
        OVERPASS, data=urllib.parse.urlencode({"data": query}).encode(),
        headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=180) as r:
        return json.load(r)["elements"]


def fetch_ways(key, bbox):
    s, w, n, e = bbox
    named = overpass(
        f'[out:json][timeout:120];way["waterway"~"^(river|canal)$"]'
        f'["name"~"{NAME_RE[key]}"]({s},{w},{n},{e});out geom;')
    # Lop song khong ten chi de noi doan - vung day dac (TP.HCM) hay lam
    # Overpass 504; loi thi bo qua, do thi song co ten thuong da du lien thong
    try:
        rivers = overpass(
            f'[out:json][timeout:120];way["waterway"="river"]'
            f'({s},{w},{n},{e});out geom;')
    except Exception as ex:
        print(f"    (bo qua lop song khong ten: {ex})")
        rivers = []
    seen, out = set(), []
    for w_ in named + rivers:
        if w_["id"] not in seen:
            seen.add(w_["id"])
            out.append(w_)
    return out


def densify(points, step_km=0.5):
    out = []
    for (x0, y0), (x1, y1) in zip(points[:-1], points[1:]):
        seg = np.hypot((x1 - x0) * KM_PER_DEG * np.cos(np.radians(y0)),
                       (y1 - y0) * KM_PER_DEG)
        n = max(1, int(seg / step_km))
        for i in range(n):
            t = i / n
            out.append((x0 + (x1 - x0) * t, y0 + (y1 - y0) * t))
    out.append(tuple(points[-1]))
    return np.array(out)


def snap_river(key, river):
    pts = river["points"]
    lons = [p[0] for p in pts]; lats = [p[1] for p in pts]
    bbox = (min(lats) - MARGIN_DEG, min(lons) - MARGIN_DEG,
            max(lats) + MARGIN_DEG, max(lons) + MARGIN_DEG)
    ways = fetch_ways(key, bbox)
    name_re = re.compile(NAME_RE[key])
    lat0 = np.radians(np.mean(lats))
    kx = KM_PER_DEG * np.cos(lat0)

    def to_xy(lon, lat):
        return (lon * kx, lat * KM_PER_DEG)

    ref = densify(pts)
    ref_tree = cKDTree(np.column_stack([ref[:, 0] * kx, ref[:, 1] * KM_PER_DEG]))

    # ---- Xay do thi: node id -> toa do; canh (u,v) -> chi phi
    coords, adj = {}, {}

    def add_edge(u, v, cost_km):
        adj.setdefault(u, {}); adj.setdefault(v, {})
        if v not in adj[u] or adj[u][v] > cost_km:
            adj[u][v] = cost_km; adj[v][u] = cost_km

    named_nodes = set()
    n_named_ways = 0
    for w_ in ways:
        tags = w_.get("tags", {})
        name = tags.get("name", "")
        is_named = bool(name_re.search(name))
        ww = tags.get("waterway", "river")
        # canal chi nhan khi ten khop (Vam Co co doan gan voi kenh)
        if ww == "river":
            mult = COST_NAMED if is_named else COST_RIVER
        elif is_named:
            mult = COST_CANAL
        else:
            continue
        nodes = w_.get("nodes", [])
        geom = w_.get("geometry", [])
        if len(nodes) != len(geom) or len(nodes) < 2:
            continue
        # loc hanh lang: bo way ma MOI diem deu xa polyline tho
        xy = np.array([to_xy(g["lon"], g["lat"]) for g in geom])
        d, _ = ref_tree.query(xy)
        if d.min() > CORRIDOR_KM:
            continue
        n_named_ways += is_named
        for nid, g in zip(nodes, geom):
            coords[nid] = (g["lon"], g["lat"])
        if is_named:
            named_nodes.update(nodes)
        for (a, ga), (b, gb) in zip(zip(nodes[:-1], geom[:-1]),
                                    zip(nodes[1:], geom[1:])):
            seg = np.hypot((gb["lon"] - ga["lon"]) * kx,
                           (gb["lat"] - ga["lat"]) * KM_PER_DEG)
            add_edge(a, b, seg * mult)

    if len(coords) < 50:
        print(f"  {key}: chi {len(coords)} node trong hanh lang -> giu polyline tho")
        return None

    # ---- Bac cau cac dau way gan nhau nhung khong chia se node
    ids = list(coords.keys())
    xy = np.array([to_xy(*coords[i]) for i in ids])
    tree = cKDTree(xy)
    for i, j in tree.query_pairs(BRIDGE_M / 1000.0):
        u, v = ids[i], ids[j]
        if v not in adj.get(u, {}):
            d = float(np.hypot(*(xy[i] - xy[j])))
            add_edge(u, v, d * COST_BRIDGE + 0.5)

    # ---- Diem dau/cuoi: uu tien node thuoc way co ten NEU no o gan diem
    # tham chieu (< 4 km); khong thi lay node bat ky gan nhat (tranh truong hop
    # way co ten chi phu 1 doan ngan lam ca src lan dst snap ve cung mot cho)
    idx_named = [i for i, nid in enumerate(ids) if nid in named_nodes]

    def nearest_node(lonlat):
        px, py = to_xy(*lonlat)
        if idx_named:
            best = min(idx_named,
                       key=lambda i: (xy[i][0] - px) ** 2 + (xy[i][1] - py) ** 2)
            if (xy[best][0] - px) ** 2 + (xy[best][1] - py) ** 2 < 4.0 ** 2:
                return ids[best]
        best = min(range(len(ids)),
                   key=lambda i: (xy[i][0] - px) ** 2 + (xy[i][1] - py) ** 2)
        return ids[best]

    src = nearest_node(pts[0])       # cua song
    dst = nearest_node(pts[-1])      # thuong nguon

    # ---- Dijkstra
    dist = {src: 0.0}; prev = {}; pq = [(0.0, src)]; done = set()
    while pq:
        d, u = heapq.heappop(pq)
        if u in done:
            continue
        done.add(u)
        if u == dst:
            break
        for v, c in adj.get(u, {}).items():
            nd = d + c
            if nd < dist.get(v, 1e18):
                dist[v] = nd; prev[v] = u
                heapq.heappush(pq, (nd, v))
    if dst != src and dst not in prev:
        # Khong toi duoc dich: lay nut DA TOI DUOC gan diem thuong nguon nhat
        # (di duoc bao xa hay bay nhieu; kiem tra 50% chieu dai o main() se
        # loai neu qua ngan)
        ux, uy = to_xy(*pts[-1])
        reached = [n for n in done if n in prev or n == src]
        if reached:
            id_xy = {nid: to_xy(*coords[nid]) for nid in reached}
            dst2 = min(reached, key=lambda n: (id_xy[n][0] - ux) ** 2
                                              + (id_xy[n][1] - uy) ** 2)
            d2_km = np.hypot(id_xy[dst2][0] - ux, id_xy[dst2][1] - uy)
            if dst2 != src:
                print(f"  {key}: dich goc khong lien thong, dung nut gan nhat"
                      f" toi duoc (cach thuong nguon {d2_km:.1f} km)")
                dst = dst2
    if dst != src and dst not in prev:
        print(f"  {key}: KHONG tim duoc duong cua song->thuong nguon, giu polyline tho")
        return None
    path = [dst]
    while path[-1] != src:
        path.append(prev[path[-1]])
    path.reverse()
    line = np.array([coords[n] for n in path])  # tu cua song len thuong nguon

    # ---- Resample ~STEP_KM
    seg = np.hypot(np.diff(line[:, 0]) * kx, np.diff(line[:, 1]) * KM_PER_DEG)
    chain = np.concatenate([[0.0], np.cumsum(seg)])
    total = float(chain[-1])
    xs = np.arange(0.0, total, STEP_KM)
    out = np.column_stack([np.interp(xs, chain, line[:, 0]),
                           np.interp(xs, chain, line[:, 1])])
    out = np.vstack([out, line[-1]])
    print(f"  {key}: {n_named_ways} way ten khop, {len(coords)} node, "
          f"duong di {total:.0f} km, {len(out)} diem")
    return {"points": [[round(float(x), 5), round(float(y), 5)] for x, y in out],
            "source": "osm-graph", "length_km": round(total, 1)}


def main():
    # Chi dinh song can cap nhat: py fetch_rivers_osm.py ham_luong vam_co
    # (mac dinh: tat ca). Ket qua MERGE vao file cu, khong ghi de song da co.
    keys = sys.argv[1:] or list(RIVERS.keys())
    dest = os.path.join(os.path.dirname(__file__), "..", "engine", "rivers_osm.json")
    out = {}
    if os.path.exists(dest):
        with open(dest, encoding="utf-8") as f:
            out = json.load(f)
    n_ok = 0
    for key in keys:
        river = RIVERS[key]
        print(f"{river['name']}:")
        snapped = None
        for attempt in range(5):
            try:
                snapped = snap_river(key, river)
                break
            except Exception as ex:
                wait = 30 * (attempt + 1)
                print(f"  {key}: loi {ex}, thu lai sau {wait}s...")
                time.sleep(wait)
        # loai ket qua bat thuong (duong qua ngan so voi polyline tho)
        if snapped:
            rough_km = float(np.sum(np.hypot(
                np.diff([p[0] for p in river["points"]]) * KM_PER_DEG * 0.97,
                np.diff([p[1] for p in river["points"]]) * KM_PER_DEG)))
            if snapped["length_km"] < 0.5 * rough_km:
                print(f"  {key}: duong di {snapped['length_km']} km < 50% "
                      f"polyline tho ({rough_km:.0f} km) -> BO, giu du lieu cu")
                snapped = None
        if snapped:
            out[key] = snapped
            n_ok += 1
        time.sleep(20)  # lich su voi Overpass (tranh 429)
    with open(dest, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False)
    print(f"Cap nhat {n_ok}/{len(keys)} song, file co {len(out)} song "
          f"-> {os.path.abspath(dest)}")


if __name__ == "__main__":
    main()
