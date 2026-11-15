"""3D model of a landing site: a square patch of ground around a point, heights and imagery.

The patch is laid out on the ground around the site (azimuthal equidistant projection): rows run
north to south, columns west to east, so "north" in the model is true north at the site, the same
north the sky directions (azimuth) are measured from. That works at the poles as well.

Heights come from the LOLA global DEM at 118 m per pixel (USGS Astrogeology, 256 pixels per
degree). The file is a 8.5 GB uncompressed GeoTIFF with one image row per strip, so only the rows
the patch needs are read with HTTP range requests. If that fails, the coarse LDEM16 grid the app
already prepares (moon_terrain.py, ~1.9 km) is used instead.

Imagery is the LROC WAC/NAC mosaic from QuickMap (the same tiles as the globe), resampled onto the
patch: the global map in the middle latitudes, the polar stereographic maps near the poles.
"""

import json
import math
import threading
from concurrent.futures import ThreadPoolExecutor
from io import BytesIO
from pathlib import Path
from uuid import uuid4

import numpy as np
import requests
from PIL import Image
from scipy.ndimage import map_coordinates

from app.core.config import settings
from app.services import moon_terrain, quickmap_surface

RADIUS_M = 1_737_400.0
SPAN_KM = 40.0  # side of the patch
GRID = 241  # height samples per side (odd: one sits exactly on the site), ~167 m apart
TEXTURE_PX = 896  # imagery per side, ~45 m per pixel
POLAR_LAT = 70  # from here poleward the imagery comes from the polar maps

DEM_URL = (
    "https://asc-pds-services.s3.us-west-2.amazonaws.com/mosaic/"
    "Lunar_LRO_LOLA_Global_LDEM_118m_Mar2014.tif"
)
DEM_ID = "LOLA-LDEM-118m-USGS-2014"
# layout of that file (checked once against its TIFF header, see _check_layout)
DEM_WIDTH = 92160
DEM_HEIGHT = 46080
DEM_PPD = 256  # pixels per degree, the first pixel's corner at 180° W, 90° N
DEM_FIRST_ROW = 738233  # byte offset of row 0; rows follow back to back
DEM_ROW_BYTES = DEM_WIDTH * 2  # signed 16-bit
DEM_SCALE = 0.5  # metres per count, heights relative to the 1737.4 km sphere
DEM_NODATA = -32768

ROOT = settings.cache_dir / "site_model_v1"
_locks = tuple(threading.Lock() for _ in range(64))
_layout_ok = False
_layout_lock = threading.Lock()


def _atomic(path: Path, data: bytes):
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_name(f"{path.name}.{uuid4().hex}.part")
    try:
        temp.write_bytes(data)
        temp.replace(path)
    finally:
        temp.unlink(missing_ok=True)


def _key(lat: float, lon: float) -> str:
    return f"{lat:+.4f}_{lon:+.4f}"


def _lock(key: str):
    return _locks[hash(key) % len(_locks)]


def normalize(lat: float, lon: float) -> tuple[float, float]:
    """Latitude clamped off the exact pole (north is undefined there), longitude in [-180, 180)."""
    lat = max(-89.999, min(89.999, round(float(lat), 4)))
    lon = round(((float(lon) + 180) % 360) - 180, 4)
    return lat, lon


def ground_grid(lat0: float, lon0: float, n: int, span_km: float = SPAN_KM):
    """Latitude/longitude (degrees) of an n × n grid laid on the ground around the site.

    Row 0 is the north edge, column 0 the west edge; cell centres at ±span/2 (corners included).
    Distances along the ground, directions from true north at the site.
    """
    half = span_km * 500.0
    t = np.linspace(-half, half, n)
    east, north = np.meshgrid(t, -t)  # rows north → south
    dist = np.hypot(east, north) / RADIUS_M  # angular distance
    bearing = np.arctan2(east, north)
    a0, b0 = math.radians(lat0), math.radians(lon0)
    sin_lat = np.sin(a0) * np.cos(dist) + np.cos(a0) * np.sin(dist) * np.cos(bearing)
    lat = np.arcsin(np.clip(sin_lat, -1, 1))
    lon = b0 + np.arctan2(
        np.sin(bearing) * np.sin(dist) * np.cos(a0),
        np.cos(dist) - np.sin(a0) * sin_lat,
    )
    lon = (np.degrees(lon) + 180) % 360 - 180
    return np.degrees(lat), lon


# ---------------------------------------------------------------- heights


_local = threading.local()


def _session() -> requests.Session:
    if not hasattr(_local, "session"):
        _local.session = requests.Session()
    return _local.session


def _range(start: int, end: int) -> bytes:
    """Bytes start..end (inclusive) of the DEM file."""
    response = _session().get(DEM_URL, headers={"Range": f"bytes={start}-{end}"}, timeout=(10, 60))
    response.raise_for_status()
    if response.status_code != 206 or len(response.content) != end - start + 1:
        raise ValueError("The DEM server ignored the byte range")
    return response.content


def _check_layout():
    """Reads the TIFF header once and makes sure the file is still laid out as assumed above."""
    global _layout_ok
    with _layout_lock:
        if _layout_ok:
            return
        head = _range(0, 4095)
        ok = head[:4] == b"II+\x00"  # little-endian BigTIFF
        if ok:
            # first strip offset: tag 273, in the IFD at byte 16 (BigTIFF: 20-byte entries)
            ifd = int.from_bytes(head[8:16], "little")
            count = int.from_bytes(head[ifd : ifd + 8], "little")
            tags = {}
            for i in range(count):
                e = head[ifd + 8 + i * 20 : ifd + 28 + i * 20]
                tags[int.from_bytes(e[:2], "little")] = int.from_bytes(e[12:20], "little")
            first = int.from_bytes(_range(tags[273], tags[273] + 7), "little")
            ok = (
                tags.get(256) == DEM_WIDTH
                and tags.get(257) == DEM_HEIGHT
                and tags.get(258) == 16
                and tags.get(259) == 1  # uncompressed
                and tags.get(278) == 1  # one row per strip
                and first == DEM_FIRST_ROW
            )
        if not ok:
            raise ValueError("Unexpected layout of the LOLA 118 m DEM file")
        _layout_ok = True


def _read_rows(first_row: int, last_row: int, first_col: int, cols: int) -> np.ndarray:
    """DEM counts for rows first..last and `cols` columns from first_col (wrapping at 180°)."""
    _check_layout()
    first_col %= DEM_WIDTH
    pieces = [(first_col, min(cols, DEM_WIDTH - first_col))]
    if pieces[0][1] < cols:
        pieces.append((0, cols - pieces[0][1]))

    def row(r):
        base = DEM_FIRST_ROW + r * DEM_ROW_BYTES
        parts = [
            np.frombuffer(_range(base + c * 2, base + (c + k) * 2 - 1), dtype="<i2")
            for c, k in pieces
        ]
        return np.concatenate(parts)

    with ThreadPoolExecutor(max_workers=16) as pool:
        return np.stack(list(pool.map(row, range(first_row, last_row + 1))))


def _heights_118m(lat: np.ndarray, lon: np.ndarray) -> np.ndarray:
    """Heights (m) at each point from the 118 m DEM, bilinear between pixel centres."""
    y = (90 - lat) * DEM_PPD - 0.5
    x = (lon + 180) * DEM_PPD - 0.5
    r0 = max(0, int(math.floor(y.min())))
    r1 = min(DEM_HEIGHT - 1, int(math.floor(y.max())) + 1)
    # columns: the narrowest window that holds every point, allowing for the ±180° seam
    xs = np.sort(np.mod(x, DEM_WIDTH).ravel())
    gaps = np.diff(np.concatenate([xs, xs[:1] + DEM_WIDTH]))
    widest = int(np.argmax(gaps))
    start = xs[(widest + 1) % xs.size]
    width = DEM_WIDTH - gaps[widest]
    if width > DEM_WIDTH * 0.9:  # around a pole: every longitude
        c0, cols = 0, DEM_WIDTH
    else:
        c0, cols = int(math.floor(start)) - 1, int(math.ceil(width)) + 3
    window = _read_rows(r0, r1, c0, cols).astype(np.float32)
    if np.any(window == DEM_NODATA):
        raise ValueError("The DEM has no data here")
    if cols == DEM_WIDTH:
        # whole rows: wrap at the seam by padding one column each side
        window = np.concatenate([window[:, -1:], window, window[:, :1]], axis=1)
        c0 = -1
    px = np.mod(x - c0, DEM_WIDTH)
    py = np.clip(y, r0, r1) - r0
    return map_coordinates(window, [py.ravel(), px.ravel()], order=1, mode="nearest").reshape(lat.shape) * DEM_SCALE


def _heights_ldem16(lat: np.ndarray, lon: np.ndarray) -> np.ndarray:
    """Fallback: the coarse global grid the globe uses (1/16°)."""
    metadata, binary = moon_terrain.prepare()
    info = json.loads(Path(metadata).read_text("utf-8"))
    w, h = info["width"], info["height"]
    grid = np.memmap(binary, dtype="<u2", mode="r", shape=(h, w))
    low, high = info["minimum_elevation_m"], info["maximum_elevation_m"]
    y = np.clip((90 - lat) / 180 * h - 0.5, 0, h - 1)
    x = np.mod((lon + 180) / 360 * w - 0.5, w)
    r0, r1 = int(y.min()), min(h - 1, int(y.max()) + 1)
    rows = np.asarray(grid[r0 : r1 + 1], dtype=np.float32)
    rows = np.concatenate([rows, rows[:, :1]], axis=1)  # wrap at the seam
    counts = map_coordinates(rows, [(y - r0).ravel(), x.ravel()], order=1, mode="nearest")
    return (low + counts / 65535 * (high - low)).reshape(lat.shape)


def get_heights(lat0: float, lon0: float) -> Path:
    """JSON with the patch heights (cached on disk)."""
    lat0, lon0 = normalize(lat0, lon0)
    key = _key(lat0, lon0)
    path = ROOT / "heights" / f"{key}.json"
    with _lock("h" + key):
        if path.exists():
            return path
        lat, lon = ground_grid(lat0, lon0, GRID)
        try:
            heights, dataset, spacing = _heights_118m(lat, lon), DEM_ID, 118.45
        except (requests.RequestException, OSError, ValueError, KeyError):
            heights, dataset, spacing = _heights_ldem16(lat, lon), moon_terrain.DATASET, 1895.0
        if not np.all(np.isfinite(heights)):
            raise ValueError("Invalid heights in the patch")
        body = {
            "lat": lat0,
            "lon": lon0,
            "span_km": SPAN_KM,
            "n": GRID,
            "dataset_id": dataset,
            "dem_spacing_m": spacing,
            "reference_radius_m": RADIUS_M,
            "center_m": round(float(heights[GRID // 2, GRID // 2]), 1),
            "min_m": round(float(heights.min()), 1),
            "max_m": round(float(heights.max()), 1),
            # row-major, north row first, west column first; metres above the reference sphere
            "heights_m": [round(float(v), 1) for v in heights.ravel()],
        }
        _atomic(path, json.dumps(body, separators=(",", ":")).encode("utf-8"))
    return path


# ---------------------------------------------------------------- imagery


def _imagery(lat0: float, lon0: float) -> Image.Image:
    n = TEXTURE_PX
    # pixel centres: the grid of corners shifted by half a pixel
    half_px = SPAN_KM / n / 2
    lat, lon = ground_grid(lat0, lon0, n, SPAN_KM - 2 * half_px)
    spacing = SPAN_KM * 1000 / n
    if abs(lat0) >= POLAR_LAT:
        sign = 1 if lat0 > 0 else -1
        radius = 2 * RADIUS_M * np.tan(np.radians(45 - np.abs(lat) / 2))
        x = radius * np.sin(np.radians(lon))
        y = -sign * radius * np.cos(np.radians(lon))
        source = "moon_north" if sign > 0 else "moon_south"
    else:
        x, y = lon * quickmap_surface.DEG_M, lat * quickmap_surface.DEG_M
        source = "moon"
    if source == "moon" and np.ptp(lon) > 180:
        # the patch straddles the ±180° seam: sample each side on its own (a single bounding box
        # would span the whole map)
        pixels = np.zeros((*lon.shape, 3), dtype=np.float32)
        for side in (lon < 0, lon >= 0):
            pixels[side] = quickmap_surface._sample_grid(source, x[side], y[side], spacing)
    else:
        pixels = quickmap_surface._sample_grid(source, x, y, spacing)
    # dark mare would be nearly black once lit in the scene: brighten (never darken) so the
    # brightest 1 % of the patch reaches ~235
    gain = np.clip(235 / max(1.0, float(np.percentile(pixels, 99))), 1, 3)
    return Image.fromarray(np.clip(pixels * gain + 0.5, 0, 255).astype(np.uint8))


def get_imagery(lat0: float, lon0: float) -> Path:
    """JPEG of the patch from above: north up, east right (cached on disk)."""
    lat0, lon0 = normalize(lat0, lon0)
    key = _key(lat0, lon0)
    path = ROOT / "imagery" / f"{key}.jpg"
    with _lock("i" + key):
        if path.exists():
            return path
        image = _imagery(lat0, lon0)
        out = BytesIO()
        image.save(out, "JPEG", quality=90)
        _atomic(path, out.getvalue())
    return path
