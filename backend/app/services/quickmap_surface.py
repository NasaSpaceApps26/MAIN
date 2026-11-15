"""QuickMap imagery adapter with consistent global/polar mapping."""

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
from app.services.surface_tiles import (
    SOURCES as ORIGINAL_SOURCES,
    Layer,
    NoData,
    TileSource,
)

RADIUS_M = 1_737_400
DEG_M = math.pi * RADIUS_M / 180

NATIVE_PX = 512
OUTPUT_PX = 256

BASE_WIDTH = 4096
CAP_PX = 1024
CAP_LAT = 60
BLEND_DEGREES = 6

POLAR_SPAN = 2_191_860
POLAR_ORIGIN = (-1_095_930, 1_095_930)

TILE_SERVER = "https://lroc-tiles.quickmap.io"
LAYER_NAME = "wac_nac_nacroi"

# New cache: previously generated images used the wrong tile grid.
CACHE_ROOT = settings.cache_dir / "quickmap_imagery_v2"

GRIDS = {
    "moon": {
        "projection": "lunar-fulleqc",
        "origin": (
            -5458203.0763469,
            2729101.5381735,
        ),
        "extent": (
            -5458203.0763469,
            -2729101.5381735,
            5458203.0763469,
            2729101.5381735,
        ),
    },
    "moon_north": {
        "projection": "lunar-sterenp",
        "origin": (-931070, 931070),
        "extent": (
            -931070,
            -931070,
            931070,
            931070,
        ),
    },
    "moon_south": {
        "projection": "lunar-steresp",
        "origin": (-931070, 931070),
        "extent": (
            -931070,
            -931070,
            931070,
            931070,
        ),
    },
}

SOURCES = {
    "earth": ORIGINAL_SOURCES["earth"],
    "moon": TileSource(
        projection="latlon",
        tile_px=256,
        level0_span=180,
        min_level=3,
        layers=(Layer("", 3, 15),),
    ),
    "moon_north": TileSource(
        projection="polar",
        tile_px=256,
        level0_span=POLAR_SPAN,
        min_level=3,
        layers=(Layer("", 3, 14),),
    ),
    "moon_south": TileSource(
        projection="polar",
        tile_px=256,
        level0_span=POLAR_SPAN,
        min_level=3,
        layers=(Layer("", 3, 14),),
    ),
}

_local = threading.local()

_native_locks = tuple(
    threading.RLock()
    for _ in range(128)
)
_output_locks = tuple(
    threading.Lock()
    for _ in range(128)
)

_download_slots = threading.BoundedSemaphore(6)
_render_slots = threading.BoundedSemaphore(2)


def _session():
    if not hasattr(_local, "session"):
        _local.session = requests.Session()

    return _local.session


def _save(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)

    tmp = path.with_name(
        f"{path.name}.{uuid4().hex}.part"
    )

    try:
        tmp.write_bytes(data)
        tmp.replace(path)
    finally:
        tmp.unlink(missing_ok=True)


def _jpeg(image):
    output = BytesIO()
    image.convert("RGB").save(
        output,
        "JPEG",
        quality=92,
    )
    return output.getvalue()


def _native_tile(source_id, z, col, row):
    grid = GRIDS[source_id]

    path = (
        CACHE_ROOT
        / "native"
        / source_id
        / str(z)
        / str(row)
        / f"{col}.jpg"
    )

    lock = _native_locks[
        hash(str(path)) % len(_native_locks)
    ]

    with lock:
        if not path.exists():
            url = (
                f"{TILE_SERVER}/tiles/{LAYER_NAME}/"
                f"{grid['projection']}/"
                f"{z}/{col}/{row}.jpg"
            )

            with _download_slots:
                response = _session().get(
                    url,
                    timeout=(10, 35),
                )
                response.raise_for_status()

            with Image.open(
                BytesIO(response.content)
            ) as image:
                if image.size != (
                    NATIVE_PX,
                    NATIVE_PX,
                ):
                    raise ValueError(
                        "Unexpected QuickMap tile size"
                    )

                image.load()

            _save(path, response.content)

    with Image.open(path) as image:
        return image.convert("RGB")


def _render(source_id, bounds, width, height):
    """Read a rectangular region from QuickMap's actual XYZ grid."""
    left, bottom, right, top = bounds
    grid = GRIDS[source_id]

    target = min(
        (right - left) / width,
        (top - bottom) / height,
    )

    extent = grid["extent"]

    # The imagery grid is derived from the projection extent.
    # QuickMap's view-resolution list is not the imagery tile grid.
    root_span = max(
        extent[2] - extent[0],
        extent[3] - extent[1],
    )
    root_resolution = root_span / NATIVE_PX

    z = max(
        0,
        math.ceil(
            math.log2(root_resolution / target)
            - 1e-12
        ),
    )
    z = min(z, 22)

    resolution = root_resolution / 2**z
    span = root_span / 2**z

    ox, oy = grid["origin"]
    ex_left, ex_bottom, ex_right, ex_top = extent

    cols = math.ceil(
        (ex_right - ex_left) / span
    )
    rows = math.ceil(
        (ex_top - ex_bottom) / span
    )

    first_col = max(
        0,
        math.floor((left - ox) / span),
    )
    last_col = min(
        cols - 1,
        math.ceil((right - ox) / span) - 1,
    )
    first_row = max(
        0,
        math.floor((oy - top) / span),
    )
    last_row = min(
        rows - 1,
        math.ceil((oy - bottom) / span) - 1,
    )

    if first_col > last_col or first_row > last_row:
        raise NoData

    cells = [
        (col, row)
        for row in range(first_row, last_row + 1)
        for col in range(first_col, last_col + 1)
    ]

    canvas = Image.new(
        "RGB",
        (
            (last_col - first_col + 1) * NATIVE_PX,
            (last_row - first_row + 1) * NATIVE_PX,
        ),
    )

    def fetch(cell):
        col, row = cell

        return (
            col,
            row,
            _native_tile(source_id, z, col, row),
        )

    try:
        with ThreadPoolExecutor(max_workers=6) as pool:
            for col, row, image in pool.map(fetch, cells):
                canvas.paste(
                    image,
                    (
                        (col - first_col) * NATIVE_PX,
                        (row - first_row) * NATIVE_PX,
                    ),
                )
                image.close()

        canvas_left = ox + first_col * span
        canvas_top = oy - first_row * span

        box = (
            (left - canvas_left) / resolution,
            (canvas_top - top) / resolution,
            (right - canvas_left) / resolution,
            (canvas_top - bottom) / resolution,
        )

        return canvas.transform(
            (width, height),
            Image.Transform.EXTENT,
            box,
            resample=Image.Resampling.BILINEAR,
        )
    finally:
        canvas.close()


def _sample_grid(source_id, x, y, spacing):
    """Sample projected imagery at arbitrary coordinates."""
    left = float(np.min(x)) - spacing
    right = float(np.max(x)) + spacing
    bottom = float(np.min(y)) - spacing
    top = float(np.max(y)) + spacing

    width = max(
        2,
        min(
            8192,
            math.ceil((right - left) / spacing),
        ),
    )
    height = max(
        2,
        min(
            4096,
            math.ceil((top - bottom) / spacing),
        ),
    )

    image = _render(
        source_id,
        (left, bottom, right, top),
        width,
        height,
    )

    try:
        pixels = np.asarray(
            image,
            dtype=np.float32,
        )
    finally:
        image.close()

    px = (
        (x - left) / (right - left) * width
        - 0.5
    )
    py = (
        (top - y) / (top - bottom) * height
        - 0.5
    )

    coords = [
        py.ravel(),
        px.ravel(),
    ]

    channels = [
        map_coordinates(
            pixels[..., channel],
            coords,
            order=1,
            mode="nearest",
        )
        for channel in range(3)
    ]

    return np.stack(
        channels,
        axis=-1,
    ).reshape(*x.shape, 3)


def _blend_weight(abs_lat):
    weight = np.clip(
        (abs_lat - CAP_LAT) / BLEND_DEGREES,
        0,
        1,
    )
    return weight * weight * (3 - 2 * weight)


def _consistent_render(
    source_id,
    bounds,
    width,
    height,
):
    """Use matching polar imagery on both sides of globe-cap joins."""
    image = _render(
        source_id,
        bounds,
        width,
        height,
    )

    left, bottom, right, top = bounds

    spacing = min(
        (right - left) / width,
        (top - bottom) / height,
    )

    xx = (
        left
        + (np.arange(width) + 0.5)
        * (right - left)
        / width
    )
    yy = (
        top
        - (np.arange(height) + 0.5)
        * (top - bottom)
        / height
    )

    x, y = np.meshgrid(xx, yy)

    pixels = np.array(
        image,
        dtype=np.float32,
    )
    image.close()

    if source_id == "moon":
        lat = y / DEG_M
        lon = x / DEG_M

        for pole, sign in (
            ("north", 1),
            ("south", -1),
        ):
            mask = lat * sign > CAP_LAT

            if not np.any(mask):
                continue

            abs_lat = np.abs(lat[mask])
            longitude = np.deg2rad(lon[mask])

            radius = (
                2
                * RADIUS_M
                * np.tan(
                    np.deg2rad(45 - abs_lat / 2)
                )
            )

            polar_x = radius * np.sin(longitude)
            polar_y = (
                -sign
                * radius
                * np.cos(longitude)
            )

            polar = _sample_grid(
                f"moon_{pole}",
                polar_x,
                polar_y,
                spacing,
            )

            weight = _blend_weight(abs_lat)[:, None]

            pixels[mask] = (
                pixels[mask] * (1 - weight)
                + polar * weight
            )

    else:
        sign = (
            1
            if source_id == "moon_north"
            else -1
        )

        abs_lat = 90 - np.rad2deg(
            2
            * np.arctan(
                np.hypot(x, y)
                / (2 * RADIUS_M)
            )
        )

        # Only the cap boundary needs the global/polar transition.
        mask = (
            (abs_lat >= CAP_LAT - 0.5)
            & (abs_lat < CAP_LAT + BLEND_DEGREES)
        )

        if np.any(mask):
            lon = np.rad2deg(
                np.arctan2(
                    x[mask],
                    -sign * y[mask],
                )
            )

            global_pixels = _sample_grid(
                "moon",
                lon * DEG_M,
                sign * abs_lat[mask] * DEG_M,
                spacing,
            )

            weight = _blend_weight(
                abs_lat[mask]
            )[:, None]

            pixels[mask] = (
                global_pixels * (1 - weight)
                + pixels[mask] * weight
            )

    return Image.fromarray(
        np.clip(
            pixels + 0.5,
            0,
            255,
        ).astype(np.uint8)
    )


def _cached_render(
    path,
    source_id,
    bounds,
    width,
    height,
):
    lock = _output_locks[
        hash(str(path)) % len(_output_locks)
    ]

    with lock:
        if not path.exists():
            with _render_slots:
                image = _consistent_render(
                    source_id,
                    bounds,
                    width,
                    height,
                )

                try:
                    _save(path, _jpeg(image))
                finally:
                    image.close()

    return path


def get_tile(
    source_id: str,
    z: int,
    row: int,
    col: int,
) -> Path:
    source = SOURCES[source_id]
    span = source.level0_span / 2**z

    if source_id == "moon":
        left = (-180 + col * span) * DEG_M
        top = (90 - row * span) * DEG_M
        size = span * DEG_M
    else:
        left = POLAR_ORIGIN[0] + col * span
        top = POLAR_ORIGIN[1] - row * span
        size = span

    path = (
        CACHE_ROOT
        / "output"
        / source_id
        / str(z)
        / str(row)
        / f"{col}.jpg"
    )

    return _cached_render(
        path,
        source_id,
        (
            left,
            top - size,
            left + size,
            top,
        ),
        OUTPUT_PX,
        OUTPUT_PX,
    )


def get_base_map(source_id: str) -> Path:
    if source_id != "moon":
        raise NoData

    path = (
        CACHE_ROOT
        / "output"
        / "moon"
        / "base.jpg"
    )

    return _cached_render(
        path,
        "moon",
        GRIDS["moon"]["extent"],
        BASE_WIDTH,
        BASE_WIDTH // 2,
    )


def get_cap(source_id: str, pole: str) -> Path:
    if source_id != "moon":
        raise NoData

    if pole not in ("north", "south"):
        raise NoData

    edge = (
        2
        * RADIUS_M
        * math.tan(
            math.radians(45 - CAP_LAT / 2)
        )
    )

    path = (
        CACHE_ROOT
        / "output"
        / "moon"
        / f"cap_{pole}.jpg"
    )

    return _cached_render(
        path,
        f"moon_{pole}",
        (-edge, -edge, edge, edge),
        CAP_PX,
        CAP_PX,
    )