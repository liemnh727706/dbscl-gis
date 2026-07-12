# Chạy kịch bản Itzï (offline)

[Itzï](https://github.com/ItziModel/itzi) là mô hình thủy động lực 2D (phương
trình nước nông) chạy trên GRASS GIS. Do tính toán nặng (nhiều giờ cho vùng
lớn), Itzï được chạy **offline** để tạo sẵn các kịch bản; kết quả đưa vào
`data/outputs/scenarios/<tên>/` và hiển thị trên web y như kết quả HAND-FIM.

## Cài đặt (Ubuntu / WSL)

```bash
sudo apt install grass grass-dev
pip install itzi
```

## Quy trình

1. Chuẩn bị DEM thật: `python ../scripts/download_dem.py` (cần OPENTOPO_KEY)
2. Tạo location GRASS và import dữ liệu:

```bash
grass -c EPSG:32648 ~/grassdata/mekong --exec bash
r.import input=../../data/dem/dem.tif output=dem resolution=value resolution_value=90
# Mưa: raster hằng số hoặc chuỗi thời gian từ dữ liệu GPM/Open-Meteo
r.mapcalc "rain_100mm = 100"    # mm/h thử nghiệm, thay bằng dữ liệu thật
```

3. Chạy Itzï với file cấu hình mẫu [scenario_flood.ini](scenario_flood.ini):

```bash
itzi run scenario_flood.ini
```

4. Xuất kết quả sang chuỗi GeoTIFF cho web:

```bash
python convert_results.py --mapset ~/grassdata/mekong --strds flood_out_water_depth \
    --name "lu_2011" --title "Kịch bản lũ 2011 (Itzï)" \
    --out ../../data/outputs/scenarios
```

Sau đó kịch bản tự xuất hiện trong menu "Kịch bản" trên web.
