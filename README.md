# 🌊 Hệ thống mô phỏng ngập lụt & xâm nhập mặn ĐBSCL

Ứng dụng web mô phỏng **ngập lụt** và **xâm nhập mặn** lưu vực sông Mekong tại
Đồng bằng sông Cửu Long, hiển thị trên bản đồ theo thời gian (time slider),
chạy theo **dữ liệu thời gian thực** hoặc **kịch bản người dùng tự điều chỉnh**,
và **cảnh báo chi tiết tại vị trí người dùng**.

## Kiến trúc

```
┌─────────────┐   /api    ┌──────────────┐   HTTP   ┌────────────────────┐
│   Client     │─────────▶│ Node.js API   │─────────▶│ Modeling (Python)   │
│ MapLibre GL  │           │ Express       │          │ FastAPI             │
│ time slider  │           │ · Open-Meteo  │          │ · HAND-FIM (ngập)   │
│ geolocation  │           │ · MRC/KTTV    │          │ · Mô hình mặn 1D    │
└──────┬──────┘           │ · cảnh báo    │          │ · DEM/HAND builder  │
       │ /tiles           └──────────────┘          └─────────┬──────────┘
       ▼                                                       │ GeoTIFF
┌─────────────┐                    đọc COG/GTiff               ▼
│   TiTiler    │◀──────────────────────────────────── /data/outputs/...
└─────────────┘
```

| Thành phần | Công nghệ | Vai trò |
|---|---|---|
| Frontend | [MapLibre GL JS](https://github.com/maplibre/maplibre-gl-js) + Vite | Bản đồ, time slider, lớp ngập/mặn, cảnh báo vị trí |
| Backend API | Node.js + Express | Dữ liệu thời gian thực, điều phối mô phỏng, sinh cảnh báo tiếng Việt |
| Modeling | Python FastAPI | **HAND-FIM** (theo phương pháp [NOAA OWP](https://github.com/NOAA-OWP/inundation-mapping)) tính raster độ sâu ngập theo giờ; mô hình xâm nhập mặn 1D (Savenije) theo 8 nhánh sông chính |
| Tile server | [TiTiler](https://github.com/developmentseed/titiler) | Phục vụ chuỗi raster ngập dạng tile động |
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

# 3. TiTiler (cần cho hiển thị lớp ngập)
docker run -p 8000:8000 -v $(pwd)/data:/data ghcr.io/developmentseed/titiler:latest
#  (nếu chạy TiTiler cùng máy, đổi cổng modeling sang 8001 và chỉnh MODEL_API_URL)

# 4. Client
cd client && npm install && npm run dev   # http://localhost:5173
```

## Dùng DEM thật (khuyến nghị khi triển khai)

```bash
export OPENTOPO_KEY=<key miễn phí từ portal.opentopography.org>
python modeling/scripts/download_dem.py    # tải Copernicus GLO-30 → data/dem/dem.tif
docker compose restart modeling            # tự rebuild HAND từ DEM thật
```

## Nguồn dữ liệu thời gian thực

| Nguồn | Dữ liệu | Trạng thái |
|---|---|---|
| Open-Meteo | Mưa dự báo 6 điểm ĐBSCL | ✅ hoạt động, không cần key |
| Quy luật mùa (synthetic) | Q thượng nguồn, biên độ triều, chu kỳ triều cường | ✅ luôn hoạt động (nền/fallback) |
| MRC Mekong | Mực nước sông Mekong | ⚙️ best-effort, cấu hình `MRC_API_URL` |
| KTTV Việt Nam | Mực nước + độ mặn trạm đo | ⚙️ cần nguồn truy cập: đặt `KTTV_API_URL`, `KTTV_API_KEY` và chỉnh `server/src/providers/kttv.js` |

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
- **Mặn 1D**: `S(x) = 30·exp(−x/L)`, L phụ thuộc Q, SLR, triều — hiệu chỉnh theo
  ranh mặn 4 g/l điển hình mùa khô (45–60 km, tương tự đợt hạn mặn 2016/2020).
- Mô hình đơn giản hóa phục vụ **mô phỏng/giáo dục/cảnh báo sơ bộ**, không thay
  thế bản tin dự báo chính thức của cơ quan KTTV.
