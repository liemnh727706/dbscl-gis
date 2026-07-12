// Tao noi dung canh bao tieng Viet theo do sau ngap va do man tai vi tri nguoi dung

export function floodLevel(depth) {
  if (depth < 0.05) return { level: 0, code: "an_toan", label: "An toàn", color: "#2e7d32" };
  if (depth < 0.3) return { level: 1, code: "thap", label: "Ngập nhẹ", color: "#f9a825" };
  if (depth < 0.7) return { level: 2, code: "trung_binh", label: "Ngập trung bình", color: "#ef6c00" };
  if (depth < 1.5) return { level: 3, code: "cao", label: "Ngập sâu", color: "#d32f2f" };
  return { level: 4, code: "rat_cao", label: "Ngập rất sâu - NGUY HIỂM", color: "#7b1fa2" };
}

export function salinityLevel(s) {
  if (s < 0.5) return { level: 0, code: "ngot", label: "Nước ngọt", color: "#2e7d32" };
  if (s < 1) return { level: 1, code: "nhe", label: "Nhiễm mặn nhẹ", color: "#9e9d24" };
  if (s < 4) return { level: 2, code: "trung_binh", label: "Nhiễm mặn trung bình", color: "#ef6c00" };
  if (s < 10) return { level: 3, code: "cao", label: "Nhiễm mặn cao", color: "#d32f2f" };
  return { level: 4, code: "rat_cao", label: "Mặn như nước lợ/biển", color: "#7b1fa2" };
}

const FLOOD_ADVICE = [
  "Không có nguy cơ ngập tại vị trí của bạn theo kịch bản hiện tại.",
  "Nước có thể tràn nhẹ vào đường trũng, sân vườn. Kê cao đồ điện, theo dõi triều cường.",
  "Đường ngập 30-70 cm: xe máy dễ chết máy, di chuyển khó khăn. Ngắt điện tầng trệt khi nước vào nhà, di dời tài sản lên cao.",
  "Ngập sâu 0,7-1,5 m: KHÔNG di chuyển bằng xe máy/ô tô. Sơ tán người già, trẻ em đến nơi cao. Đề phòng điện giật, rắn, nước cuốn.",
  "Ngập trên 1,5 m: NGUY HIỂM ĐẾN TÍNH MẠNG. Sơ tán ngay theo hướng dẫn chính quyền, gọi cứu hộ 112 nếu bị cô lập.",
];

const SALT_ADVICE = [
  "Nguồn nước tại khu vực vẫn ngọt, sử dụng bình thường.",
  "Độ mặn 0,5-1 g/l: không dùng tưới cây nhạy mặn (sầu riêng, chôm chôm). Trữ nước ngọt.",
  "Độ mặn 1-4 g/l: KHÔNG dùng tưới lúa và cây ăn trái. Nước sinh hoạt cần xử lý; ưu tiên nước máy/nước mưa dự trữ.",
  "Độ mặn 4-10 g/l: không dùng cho sinh hoạt và mọi cây trồng. Đóng cống ngăn mặn, chuyển đổi tạm sang nuôi trồng nước lợ.",
  "Độ mặn >10 g/l: nước lợ/mặn hoàn toàn. Chỉ phù hợp nuôi tôm nước lợ; bảo vệ nghiêm nguồn nước ngọt dự trữ.",
];

export function buildAlert({ lat, lon, flood, salinity, meta }) {
  const depth = flood?.depth_m ?? 0;
  const maxDepth = flood?.max_depth_m ?? depth;
  const s = salinity?.salinity_gl ?? 0;
  const fl = floodLevel(depth);
  const flMax = floodLevel(maxDepth);
  const sl = salinityLevel(s);

  const overall = Math.max(fl.level, sl.level);
  return {
    location: { lat, lon },
    time: new Date().toISOString(),
    overall_level: overall,
    overall_label: overall === 0 ? "AN TOÀN" : overall >= 3 ? "CẢNH BÁO KHẨN" : "CẢNH BÁO",
    flood: {
      depth_m: depth,
      max_depth_m: maxDepth,
      max_at: flood?.max_t_index != null && meta?.times ? meta.times[flood.max_t_index] : null,
      elevation_m: flood?.elevation_m,
      ...fl,
      max_level_label: flMax.label,
      advice: FLOOD_ADVICE[flMax.level],
    },
    salinity: {
      salinity_gl: s,
      river: salinity?.river ?? null,
      river_distance_km: salinity?.distance_km ?? null,
      ...sl,
      advice: SALT_ADVICE[sl.level],
    },
  };
}
