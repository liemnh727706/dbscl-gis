"""Mang luoi song chinh DBSCL - polyline WGS84.

Moi song: danh sach diem tu CUA SONG (bien) nguoc len THUONG NGUON.
Toa do khai bao duoi day chi la duong tho (gan dung); neu ton tai file
rivers_osm.json (sinh boi scripts/fetch_rivers_osm.py tu du lieu
OpenStreetMap) thi diem cua tung song duoc THAY BANG duong tam song that
de khop voi vi tri long song tren ban do.
"""
import json as _json
import os as _os

# (lon, lat) tu cua song nguoc len thuong nguon
#
# l_factor: he so chieu dai xam nhap man RIENG TUNG SONG (nhan vao L chung),
# hieu chinh theo so lieu cac dot han man 2016 va 2019-2020 (KTTV, Vien KH
# Thuy loi mien Nam): Vam Co vao sau nhat (~100-130 km), Ham Luong 75-90 km,
# Co Chien ~65-70 km, Hau/Tien 55-65 km; vung ban dao Ca Mau (Ganh Hao,
# Ong Doc, Cai Lon) gan nhu man quanh nam do khong co nguon ngot thuong nguon.
RIVERS = {
    "song_hau": {
        "name": "Sông Hậu (cửa Trần Đề / Định An)",
        "mouth": "Biển Đông",
        "l_factor": 1.0,
        "points": [
            (106.55, 9.52), (106.40, 9.62), (106.20, 9.72), (106.05, 9.82),
            (105.95, 9.92), (105.85, 10.00), (105.78, 10.03),  # Can Tho
            (105.62, 10.18), (105.50, 10.28), (105.42, 10.38),  # Long Xuyen
            (105.30, 10.52), (105.20, 10.62), (105.11, 10.70),  # Chau Doc
        ],
    },
    "song_tien": {
        "name": "Sông Tiền (cửa Tiểu / cửa Đại)",
        "mouth": "Biển Đông",
        "l_factor": 1.0,
        "points": [
            (106.73, 10.18), (106.60, 10.25), (106.47, 10.31),
            (106.36, 10.36),  # My Tho
            (106.15, 10.32), (106.00, 10.28), (105.90, 10.27),  # My Thuan
            (105.75, 10.30),  # Sa Dec
            (105.63, 10.46),  # Cao Lanh
            (105.47, 10.62), (105.34, 10.78),  # Hong Ngu
            (105.24, 10.80),  # Tan Chau
        ],
    },
    "ham_luong": {
        "name": "Sông Hàm Luông",
        "mouth": "Biển Đông",
        "l_factor": 1.35,
        "points": [
            (106.62, 9.98), (106.52, 10.08), (106.42, 10.16),
            (106.37, 10.23),  # Ben Tre
            (106.20, 10.28), (106.05, 10.29), (105.92, 10.28),
        ],
    },
    "co_chien": {
        "name": "Sông Cổ Chiên",
        "mouth": "Biển Đông",
        "l_factor": 1.15,
        "points": [
            (106.55, 9.80), (106.45, 9.88), (106.34, 9.95),  # Tra Vinh
            (106.20, 10.05), (106.10, 10.15), (105.97, 10.25),  # Vinh Long
        ],
    },
    "vam_co": {
        "name": "Sông Vàm Cỏ",
        "mouth": "Cửa Soài Rạp",
        "l_factor": 1.75,
        "points": [
            (106.74, 10.42), (106.60, 10.46), (106.50, 10.50),
            (106.41, 10.53),  # Tan An
            (106.25, 10.60), (106.10, 10.68), (105.95, 10.75),
        ],
    },
    "cai_lon": {
        "name": "Sông Cái Lớn",
        "mouth": "Vịnh Rạch Giá (Biển Tây)",
        "l_factor": 1.3,
        "points": [
            (105.10, 9.83), (105.20, 9.78), (105.28, 9.73),  # Go Quao
            (105.40, 9.68), (105.55, 9.65),
        ],
    },
    "ganh_hao": {
        "name": "Sông Gành Hào",
        "mouth": "Biển Đông (Cà Mau)",
        "l_factor": 1.5,
        "points": [
            (105.42, 9.03), (105.33, 9.08), (105.24, 9.13),
            (105.15, 9.18),  # Ca Mau
        ],
    },
    "ong_doc": {
        "name": "Sông Ông Đốc",
        "mouth": "Biển Tây (Cà Mau)",
        "l_factor": 1.5,
        "points": [
            (104.83, 9.24), (104.95, 9.22), (105.05, 9.20), (105.15, 9.18),
        ],
    },
}

# Neo polyline vao long song that tu OSM (neu da fetch)
_OSM_FILE = _os.path.join(_os.path.dirname(__file__), "rivers_osm.json")
if _os.path.exists(_OSM_FILE):
    with open(_OSM_FILE, encoding="utf-8") as _f:
        _osm = _json.load(_f)
    for _key, _data in _osm.items():
        if _key in RIVERS and len(_data.get("points", [])) >= 5:
            RIVERS[_key]["points"] = [tuple(_p) for _p in _data["points"]]
            RIVERS[_key]["geometry_source"] = _data.get("source", "osm")

# Duong bo bien don gian hoa (Bien Tay -> mui Ca Mau -> Bien Dong -> Go Cong)
COASTLINE = [
    (104.48, 10.38), (104.80, 10.15), (105.08, 10.00), (104.90, 9.55),
    (104.80, 9.20), (104.72, 8.60), (105.00, 8.72), (105.42, 9.02),
    (105.72, 9.28), (106.15, 9.50), (106.55, 9.52), (106.62, 9.98),
    (106.70, 10.10), (106.78, 10.35), (106.80, 10.45),
]

# Tram quan trac chinh (dung cho noi suy & hien thi)
STATIONS = [
    {"id": "tan_chau",  "name": "Tân Châu",  "lat": 10.80, "lon": 105.24, "river": "song_tien", "type": "water_level"},
    {"id": "chau_doc",  "name": "Châu Đốc",  "lat": 10.70, "lon": 105.11, "river": "song_hau",  "type": "water_level"},
    {"id": "can_tho",   "name": "Cần Thơ",   "lat": 10.03, "lon": 105.78, "river": "song_hau",  "type": "water_level"},
    {"id": "my_tho",    "name": "Mỹ Tho",    "lat": 10.36, "lon": 106.36, "river": "song_tien", "type": "both"},
    {"id": "ben_tre",   "name": "Bến Tre",   "lat": 10.23, "lon": 106.37, "river": "ham_luong", "type": "salinity"},
    {"id": "tra_vinh",  "name": "Trà Vinh",  "lat": 9.95,  "lon": 106.34, "river": "co_chien",  "type": "salinity"},
    {"id": "soc_trang", "name": "Sóc Trăng (Trần Đề)", "lat": 9.60, "lon": 106.35, "river": "song_hau", "type": "salinity"},
    {"id": "rach_gia",  "name": "Rạch Giá",  "lat": 9.83,  "lon": 105.10, "river": "cai_lon",   "type": "salinity"},
    {"id": "ca_mau",    "name": "Cà Mau",    "lat": 9.18,  "lon": 105.15, "river": "ganh_hao",  "type": "salinity"},
]
