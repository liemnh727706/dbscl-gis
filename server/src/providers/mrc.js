// MRC (Mekong River Commission) - muc nuoc song Mekong
// Cong khai tai https://monitoring.mrcmekong.org nhung API khong on dinh /
// khong tai lieu hoa. Thu goi endpoint noi bo cua trang; loi -> tra null de
// he thong dung nguon synthetic.
const MRC_URL =
  process.env.MRC_API_URL ||
  "https://monitoring.mrcmekong.org/api/v1/stations/telemetry";

export async function fetchMrcLevels() {
  try {
    const res = await fetch(MRC_URL, {
      signal: AbortSignal.timeout(8000),
      headers: { accept: "application/json" },
    });
    if (!res.ok) return null;
    const data = await res.json();
    return { source: "mrc", fetched: new Date().toISOString(), raw: data };
  } catch {
    return null;
  }
}
