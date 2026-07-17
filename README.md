# 🌊 Hệ thống mô phỏng ngập lụt & xâm nhập mặn ĐBSCL

Ứng dụng web mô phỏng **ngập lụt** và **xâm nhập mặn** lưu vực sông Mekong tại
Đồng bằng sông Cửu Long **và lưu vực hạ lưu Đồng Nai – Sài Gòn** (TP.HCM,
Biên Hòa, Nhà Bè…), hiển thị trên bản đồ theo thời gian (time slider),
chạy theo **dữ liệu thời gian thực** hoặc **kịch bản người dùng tự điều chỉnh**,
và **cảnh báo chi tiết tại vị trí người dùng**. Gồm 10 nhánh sông chính,
18 tỉnh/thành với thống kê ngập – mặn đến cấp xã/phường.

## Kiến trúc

```
┌─────────────┐   /api    ┌──────────────┐   HTTP   ┌────────────────────┐
│   Client     │─────────▶│ Node.js API   │─────────▶│ Modeling (Python)   │
│ MapLibre GL  │           │ Express       │          │ FastAPI             │
│ time slider  │           │ · Open-Meteo  │          │ · HAND-FIM (ngập)   │
│ geolocation  │           │ · MRC/KTTV    │          │ · Mô hình mặn 1D    │
└─────────────┘           │ · cảnh báo    │          │ · render PNG        │
                           └──────────────┘          └─────────┬──────────┘
   lớp ngập/mặn = ảnh PNG phủ bản đồ (/api/render.png)          │ GeoTIFF
                                                                ▼
                                                       /data/outputs/...
```

| Thành phần | Công nghệ | Vai trò |
|---|---|---|
| Frontend | [MapLibre GL JS](https://github.com/maplibre/maplibre-gl-js) + Vite | Bản đồ, time slider, lớp ngập/mặn, cảnh báo vị trí |
| Backend API | Node.js + Express | Dữ liệu thời gian thực, điều phối mô phỏng, sinh cảnh báo tiếng Việt |
| Modeling | Python FastAPI | **HAND-FIM** (theo phương pháp [NOAA OWP](https://github.com/NOAA-OWP/inundation-mapping)) tính raster độ sâu ngập theo giờ; mô hình xâm nhập mặn 1D (Savenije) theo 8 nhánh sông chính; render PNG phủ bản đồ (lưới ~275 m nên 1 ảnh toàn vùng tương đương tile động, không cần tile server) |
| Kịch bản nặng | [Itzï](https://github.com/ItziModel/itzi) (offline) | Mô hình thủy động lực 2D, tính sẵn kịch bản (lũ 2011, SLR…) |

## Chạy nhanh (Docker, khuyến nghị)

```bash
docker compose up --build
# Mở http://localhost
```

Lần chạy đầu hệ thống tự sinh **DEM tổng hợp** (địa hình đồng bằng mô phỏng)
nên demo được ngay không cần tải dữ liệu. Trang web tự động:
1. Lấy dữ liệu thời gian thực (mưa Open-Meteo, quy luật mùa lũ/mặn, triều)
2. Chạy mô phỏng 24h đầu tiên
3. Xin quyền định vị và hiển thị cảnh báo tại vị trí của bạn

## Chạy dev (không Docker)

```bash
# 1. Modeling API (Python >= 3.10)
cd modeling && pip install -r requirements.txt
DATA_DIR=../data uvicorn app:app --port 8000

# 2. Node API
cd server && npm install
MODEL_API_URL=http://localhost:8000 npm run dev

# 3. Client
cd client && npm install && npm run dev   # http://localhost:5173
```

## Dùng DEM thật (khuyến nghị khi triển khai)

```bash
python modeling/scripts/download_dem.py    # Copernicus GLO-30 từ AWS Open Data
docker compose restart modeling            # tự rebuild HAND từ DEM thật
```

Không cần API key (bucket AWS công khai của Copernicus); nếu đặt
`OPENTOPO_KEY` sẽ dùng OpenTopography thay thế. Repo đã kèm sẵn
`data/dem/terrain_cache.npz` **build từ DEM thật** nên server deploy dùng
ngay độ chính xác DEM thật mà không phải tải lại (~430 MB ô gốc).

> ⚠️ GLO-30 là **DSM** (đo cả mái nhà, tán cây): khu đô thị/rừng ngập mặn
> đọc cao hơn mặt đất vài mét → ngập nội đô bị ước tính thấp; đồng ruộng
> trống chính xác. Nâng cấp tương lai: FABDEM (đã bóc nhà/cây, cần đăng ký
> giấy phép phi thương mại).

## Nguồn dữ liệu thời gian thực

| Nguồn | Dữ liệu | Trạng thái |
|---|---|---|
| Open-Meteo | Mưa dự báo 6 điểm ĐBSCL | ✅ hoạt động, không cần key |
| RainViewer | Ảnh radar mưa tổng hợp (gồm mạng radar KTTV Việt Nam), cập nhật ~10 phút/lần + ngoại suy 30–60′ | ✅ hoạt động, không cần key — lớp phủ động trên bản đồ, có hoạt ảnh theo thời gian |
| Quy luật mùa (synthetic) | Q thượng nguồn, biên độ triều, chu kỳ triều cường | ✅ luôn hoạt động (nền/fallback) |
| MRC Mekong | Mực nước sông Mekong (telemetry 15 phút: Tân Châu, Châu Đốc, Cần Thơ, Mỹ Thuận, Kratie…) | ✅ hoạt động, không cần key — hệ số dòng chảy Q suy từ mực nước thực đo; đổi endpoint bằng `MRC_API_URL` |
| VNDMS (Cục QLĐĐ & PCTT) | Độ mặn trạm quan trắc tự động (nguồn: Cục QL & XDCT thủy lợi, KTTV) | ⚙️ đã có provider + parser GeoJSON (`server/src/providers/vndms.js`); endpoint độ mặn **không công khai** (401 / chỉ hoạt động mùa khô 12–5) → kích hoạt bằng `VNDMS_SALINITY_URL` (+ `VNDMS_TOKEN` nếu cần) |
| KTTV Việt Nam | Mực nước + độ mặn trạm đo | ⚙️ nguồn cấp riêng: đặt `KTTV_API_URL`, `KTTV_API_KEY` và chỉnh `parse()` trong `server/src/providers/kttv.js` |

## Mức cảnh báo

- **Ngập**: An toàn < 0,05 m < Nhẹ < 0,3 m < Trung bình < 0,7 m < Sâu < 1,5 m < Rất sâu
- **Mặn**: Ngọt < 0,5 g/l < Nhẹ < 1 g/l < Trung bình < 4 g/l (ngưỡng cây trồng) < Cao < 10 g/l < Rất cao

Kèm khuyến cáo hành động chi tiết (sơ tán, bảo vệ nguồn nước, cây trồng…) trong
[server/src/alerts.js](server/src/alerts.js).

## Kịch bản Itzï (offline)

Xem [modeling/itzi/README.md](modeling/itzi/README.md) — chạy mô hình thủy động
lực 2D trên GRASS GIS, xuất kết quả vào `data/outputs/scenarios/<tên>/` để web
hiển thị trong tab **Kịch bản**.

## Triển khai Ubuntu (Oracle Cloud ARM)

```bash
sudo apt update && sudo apt install -y docker.io docker-compose-v2
git clone <repo> && cd mekong-flood
docker compose up -d --build
# mở cổng 80 trong Security List / iptables của Oracle Cloud
```

## Ghi chú mô hình

- **HAND-FIM**: `depth = stage(sông gần nhất) − HAND`, stage gồm triều (suy giảm
  e-fold 90 km lên thượng nguồn), lũ thượng nguồn, SLR, nước dâng, cộng ngập úng
  do mưa ở vùng trũng. Nhanh (~giây/bước) nên chạy realtime được.
- **Mặn 1D**: `S(x) = 30·exp(−x/L_sông)`, L phụ thuộc Q, SLR, triều, nhân thêm
  hệ số riêng từng sông (`l_factor`, hiệu chỉnh theo hạn mặn 2016/2020: Vàm Cỏ
  sâu nhất ~110–130 km, Hàm Luông 75–90 km, Hậu/Tiền 55–65 km).
- **Vùng ảnh hưởng mặn ven sông**: raster GeoTIFF tô màu dải đất dọc sông theo
  độ mặn — `S_cell = S_sông(điểm sông gần nhất) · exp(−d/8 km)`, cắt tại 15 km
  (nước mặn theo kênh rạch lan vào nội đồng) — hiển thị bằng ảnh PNG render
  từ modeling (`/api/render.png`) với thang màu trùng thang độ mặn của lớp sông.
- **Dự báo xâm nhập mặn**: `GET /api/salinity/forecast?days=N` — server tổng
  hợp tham số từng ngày (quy luật mùa chiếu tới ngày tương lai + dữ liệu thực
  đo khi có; đặt `KTTV_API_URL` để hiệu chỉnh theo trạm đo), modeling tính
  L/ranh mặn/raster vùng cho từng ngày và ước ngày ranh 4 g/l & 1 g/l chạm
  các trạm đo mặn. Client có panel dự báo: slider ngày, biểu đồ ranh mặn
  4 g/l theo ngày của 4 sông chính, danh sách "mặn tới trạm từ ngày…".
- **Hình học sông**: đường tâm 8 nhánh sông chính lấy từ **OpenStreetMap**
  bằng định tuyến đồ thị (Dijkstra) trên mạng lưới way sông — mọi điểm đều
  nằm đúng trên lòng sông thật, không cắt qua đất liền khi sông tách nhánh
  quanh cù lao (file `modeling/engine/rivers_osm.json`, sinh bằng
  `modeling/scripts/fetch_rivers_osm.py` — chạy lại khi muốn cập nhật).
- Mô hình đơn giản hóa phục vụ **mô phỏng/giáo dục/cảnh báo sơ bộ**, không thay
  thế bản tin dự báo chính thức của cơ quan KTTV.
