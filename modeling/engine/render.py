"""Render GeoTIFF ket qua mo phong thanh anh PNG RGBA phu ban do.

Thay the TiTiler: luoi tinh toan chi ~275 m/cell nen mot anh PNG toan vung
(1040x1160) co cung do chi tiet voi dynamic tile ma khong can them dich vu
Java/Python rieng - chay duoc ca khi test local lan tren server nho.

Style:
  depth    - do sau ngap (m): trong suot < 0.05 m, gradient xanh duong 0-3 m
  salinity - do man (g/l): thang mau bac trung voi duong song tren client
"""
import io
import os
import zlib

import numpy as np
import rasterio

# (nguong duoi, r, g, b, a) - ap dung cho gia tri >= nguong, tang dan
SALINITY_STEPS = [
    (0.1, 46, 125, 50, 130),
    (0.5, 158, 157, 36, 145),
    (1.0, 249, 168, 37, 160),
    (4.0, 239, 108, 0, 175),
    (10.0, 211, 47, 47, 185),
    (20.0, 123, 31, 162, 195),
]

# Gradient xanh duong cho do sau ngap: (do sau m, r, g, b, a)
DEPTH_STOPS = [
    (0.05, 198, 219, 239, 90),
    (0.30, 107, 174, 214, 140),
    (0.70, 66, 146, 198, 175),
    (1.50, 33, 113, 181, 205),
    (3.00, 8, 48, 107, 225),
]


def _colorize_depth(v):
    rgba = np.zeros((*v.shape, 4), dtype=np.uint8)
    wet = v >= DEPTH_STOPS[0][0]
    if not wet.any():
        return rgba
    depths = np.array([s[0] for s in DEPTH_STOPS])
    chans = np.array([s[1:] for s in DEPTH_STOPS], dtype=float)  # (n,4)
    vv = np.clip(v[wet], depths[0], depths[-1])
    for c in range(4):
        rgba[..., c][wet] = np.interp(vv, depths, chans[:, c]).astype(np.uint8)
    return rgba


def _colorize_salinity(v):
    rgba = np.zeros((*v.shape, 4), dtype=np.uint8)
    for thresh, r, g, b, a in SALINITY_STEPS:
        m = v >= thresh
        rgba[m] = (r, g, b, a)
    return rgba


STYLES = {"depth": _colorize_depth, "salinity": _colorize_salinity}


def _encode_png(rgba: np.ndarray) -> bytes:
    """PNG RGBA 8-bit thuan python (zlib) - khong phu thuoc GDAL PNG driver."""
    h, w, _ = rgba.shape
    raw = b"".join(b"\x00" + rgba[i].tobytes() for i in range(h))

    def chunk(tag, data):
        c = tag + data
        return (len(data).to_bytes(4, "big") + c
                + zlib.crc32(c).to_bytes(4, "big"))

    ihdr = (w.to_bytes(4, "big") + h.to_bytes(4, "big")
            + bytes([8, 6, 0, 0, 0]))  # 8-bit, RGBA
    out = io.BytesIO()
    out.write(b"\x89PNG\r\n\x1a\n")
    out.write(chunk(b"IHDR", ihdr))
    out.write(chunk(b"IDAT", zlib.compress(raw, 6)))
    out.write(chunk(b"IEND", b""))
    return out.getvalue()


def render_png(tif_path: str, style: str) -> bytes:
    if style not in STYLES:
        raise ValueError(f"style phai la mot trong {list(STYLES)}")
    with rasterio.open(tif_path) as src:
        v = src.read(1)
    v = np.where(np.isfinite(v), v, 0)
    return _encode_png(STYLES[style](v))


def safe_output_path(data_dir: str, rel_file: str) -> str:
    """Chi cho phep doc file .tif nam trong {data_dir}/outputs."""
    out_root = os.path.realpath(os.path.join(data_dir, "outputs"))
    path = os.path.realpath(os.path.join(out_root, rel_file))
    if not path.startswith(out_root + os.sep) or not path.endswith(".tif"):
        raise PermissionError("duong dan khong hop le")
    return path
