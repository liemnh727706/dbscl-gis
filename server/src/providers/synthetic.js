// Du lieu tong hop theo mua - fallback khi nguon thuc khong truy cap duoc,
// dong thoi cung cap chu ky trieu de mo phong "thoi gian thuc" luon chay duoc.
//
// Quy luat khi hau DBSCL:
//  - Mua lu: thang 7-11, dinh lu thang 9-10 (Tan Chau 3.5-4.5 m)
//  - Mua kho / xam nhap man: thang 12-5, dinh man thang 2-4
//  - Trieu Bien Dong: ban nhat trieu, bien do 2.5-3.5 m; trieu cuong ram/mung 1

const TIDE_PERIOD_H = 12.42;

export function seasonalState(date = new Date()) {
  const month = date.getMonth() + 1;
  const doy = Math.floor((date - new Date(date.getFullYear(), 0, 0)) / 864e5);

  // He so dong chay thuong nguon: 1 (kiet, thang 3) -> 4.5 (dinh lu, cuoi thang 9)
  const flood = Math.exp(-((doy - 273) ** 2) / (2 * 55 ** 2)); // Gauss quanh 30/9
  const q_factor = 1 + 3.5 * flood;

  // Bien do trieu + chu ky trieu cuong ~14.7 ngay (spring-neap)
  const springNeap = 0.5 + 0.5 * Math.cos((2 * Math.PI * doy) / 14.76);
  const tide_amp_m = 1.1 + 0.7 * springNeap;

  // Muc nuoc trieu tuc thoi tai cua song
  const hours = date.getTime() / 36e5;
  const tide_now_m =
    tide_amp_m * Math.sin((2 * Math.PI * hours) / TIDE_PERIOD_H) +
    0.35 * tide_amp_m * Math.sin((Math.PI * hours) / TIDE_PERIOD_H);

  // Muc nuoc tram (m) uoc tinh theo mua
  const stations = {
    tan_chau: +(1.2 + 3.1 * flood).toFixed(2),
    chau_doc: +(1.1 + 2.7 * flood).toFixed(2),
    can_tho: +(0.9 + 0.9 * flood + 0.35 * tide_now_m).toFixed(2),
    my_tho: +(0.6 + 0.4 * flood + 0.7 * tide_now_m).toFixed(2),
  };

  const dry = month >= 12 || month <= 5;
  return {
    source: "synthetic-seasonal",
    time: date.toISOString(),
    season: dry ? "mùa khô (xâm nhập mặn)" : "mùa mưa lũ",
    q_factor: +q_factor.toFixed(2),
    tide_amp_m: +tide_amp_m.toFixed(2),
    tide_now_m: +tide_now_m.toFixed(2),
    water_levels_m: stations,
    rain_mm_day_typical: dry ? 2 : 12,
  };
}
