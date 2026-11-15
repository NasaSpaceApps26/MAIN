"""Surface maps of Earth and the Moon for the zoomable globes.

Earth uses Blue Marble without Landsat scene stripes.
The Moon uses global WAC/Kaguya imagery and separate polar WAC/NAC maps.
"""

import math
import threading
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from io import BytesIO
from pathlib import Path
from uuid import uuid4

import numpy as np
import requests
from PIL import Image, ImageChops, ImageFilter, ImageStat
from scipy.ndimage import map_coordinates

from app.core.config import settings


class NoData(Exception):
    """NASA has no imagery for this tile."""


@dataclass(frozen=True)
class Layer:
    """One NASA product, used for a range of levels."""

    url: str
    min_level: int
    max_level: int
    background: "Layer | None" = None
    max_abs_lat: float | None = None
    match_background: bool = False
    land_mask: "Layer | None" = None


@dataclass(frozen=True)
class TileSource:
    projection: str
    tile_px: int
    level0_span: float
    min_level: int
    layers: tuple[Layer, ...]

    @property
    def max_level(self) -> int:
        return max(layer.max_level for layer in self.layers)

    def layer_for(self, z: int) -> Layer:
        return next(
            layer
            for layer in self.layers
            if layer.min_level <= z <= layer.max_level
        )


@dataclass(frozen=True)
class PolarMosaic:
    """Polar stereographic reflectance image used to build a globe cap."""

    url: str
    size: int
    offset: int
    metres_per_pixel: float
    radius_m: float


TREK = (
    "https://trek.nasa.gov/tiles/Moon/{}/{}/1.0.0/"
    "default/default028mm/{{z}}/{{row}}/{{col}}.{}"
)

GIBS = (
    "https://gibs.earthdata.nasa.gov/wmts/epsg4326/best/"
    "{}/{{z}}/{{row}}/{{col}}.{}"
)

PDS_WAC = (
    "https://pds.mcp.nasa.gov/data/store/img/"
    "lunar_reconnaissance_orbiter/pds4/lroc/"
    "lro-l-lroc-5-rdr/LROLRC_2001/DATA/BDR/WAC_GLOBAL/"
    "WAC_GLOBAL_P900{}0000_064P.IMG"
)

MOON_WAC = Layer(
    TREK.format("EQ", "LRO_WAC_Mosaic_Global_303ppd_v02", "jpg"),
    3,
    8,
)

MOON_POLAR_WAC = {
    pole: Layer(
        TREK.format(
            projection,
            f"LRO_WAC_Mosaic_{letter}Pole60_100m_v02",
            "png",
        ),
        3,
        5,
    )
    for pole, projection, letter in (
        ("north", "NP", "N"),
        ("south", "SP", "S"),
    )
}

SOURCES: dict[str, TileSource] = {
    "moon": TileSource(
        projection="latlon",
        tile_px=256,
        level0_span=180,
        min_level=3,
        layers=(
            MOON_WAC,
            Layer(
                TREK.format(
                    "EQ",
                    "Kaguya_TCortho_Mosaic_Global_4096ppd",
                    "png",
                ),
                9,
                10,
                background=MOON_WAC,
                max_abs_lat=65,
                match_background=True,
            ),
        ),
    ),
    "moon_south": TileSource(
        projection="polar",
        tile_px=256,
        level0_span=2_191_860,
        min_level=3,
        layers=(
            MOON_POLAR_WAC["south"],
            Layer(
                TREK.format("SP", "LRO_NAC_Mosaic_1mpp_SP", "png"),
                6,
                12,
                background=MOON_POLAR_WAC["south"],
            ),
        ),
    ),
    "moon_north": TileSource(
        projection="polar",
        tile_px=256,
        level0_span=2_191_860,
        min_level=3,
        layers=(
            MOON_POLAR_WAC["north"],
            Layer(
                TREK.format("NP", "LRO_NAC_Mosaic_1mpp_NP", "png"),
                6,
                12,
                background=MOON_POLAR_WAC["north"],
            ),
        ),
    ),
    "earth": TileSource(
        projection="latlon",
        tile_px=512,
        level0_span=288,
        min_level=3,
        layers=(
            Layer(
                GIBS.format(
                    "BlueMarble_NextGeneration/default/500m",
                    "jpeg",
                ),
                3,
                7,
            ),
        ),
    ),
}

BASE_MAP_WIDTH = 4096
TIMEOUT_S = 30
PARALLEL_DOWNLOADS = 8
EMPTY_BELOW = 8
GAP_EDGE_PX = 2
GAIN_LIMITS = (0.7, 1.8)

# Must match CAP_LAT in frontend tileSources.ts.
CAP_LAT = 60
CAP_PX = 4096
CAP_LEVEL = {"moon": 3, "earth": 4}
CAP_STRIP_ROWS = 256

POLAR_MOSAICS = {
    ("moon", pole): PolarMosaic(
        PDS_WAC.format(letter),
        3931,
        15724,
        473.80235037733996,
        1737400,
    )
    for pole, letter in (
        ("north", "N"),
        ("south", "S"),
    )
}

CAP_BLEND_DEG = 4

_http = requests.Session()
_http.mount(
    "https://",
    requests.adapters.HTTPAdapter(
        pool_connections=4,
        pool_maxsize=32,
    ),
)

_building: dict[Path, threading.Lock] = {}
_building_guard = threading.Lock()


def tile_grid(source: TileSource, z: int) -> tuple[int, int]:
    """Return columns and rows at level z."""
    if source.projection == "polar":
        return 2 ** (z + 1), 2**z

    span = source.level0_span / 2**z
    return round(360 / span), round(180 / span)


def _surface_dir(source_id: str) -> Path:
    """Use a fresh Earth cache while preserving the existing Moon cache."""
    cache_id = (
        "earth_blue_marble_v1"
        if source_id == "earth"
        else source_id
    )
    return settings.cache_dir / "surface_v5" / cache_id


def get_tile(source_id: str, z: int, row: int, col: int) -> Path:
    """Return a cached tile, downloading and processing it when needed."""
    source = SOURCES[source_id]
    folder = _surface_dir(source_id) / str(z) / str(row)
    path = folder / f"{col}.jpg"
    no_data = folder / f"{col}.nodata"

    if path.exists():
        return path

    if no_data.exists():
        raise NoData

    try:
        _save(path, _make_tile(source_id, source, z, row, col))
    except NoData:
        _save(no_data, b"")
        raise

    return path


def get_base_map(source_id: str) -> Path:
    """Build a whole-globe image from the coarsest tiles."""
    source = SOURCES[source_id]
    path = _surface_dir(source_id) / "base.jpg"

    with _lock(path):
        if path.exists():
            return path

        z = source.min_level
        cols, rows = tile_grid(source, z)
        image = _stitch(source_id, z, range(rows), cols)

        if image.width != BASE_MAP_WIDTH:
            image = image.resize(
                (BASE_MAP_WIDTH, BASE_MAP_WIDTH // 2),
                Image.Resampling.LANCZOS,
            )

        _save(path, _jpeg(image))

    return path


def get_cap(source_id: str, pole: str) -> Path:
    """Return an image of one pole, from CAP_LAT to the pole."""
    path = _surface_dir(source_id) / f"cap_{pole}.jpg"

    with _lock(path):
        if not path.exists():
            _save(path, _jpeg(_make_cap(source_id, pole)))

    return path


def _make_tile(
    source_id: str,
    source: TileSource,
    z: int,
    row: int,
    col: int,
) -> bytes:
    layer = source.layer_for(z)

    try:
        if not _within_latitude(source, layer, z, row):
            raise NoData

        data = _download(
            layer.url.format(z=z, row=row, col=col)
        )
    except NoData:
        if layer.background is None or z > layer.background.max_level:
            raise

        return _jpeg(
            _background(
                source_id,
                source,
                layer.background,
                z,
                row,
                col,
            )
        )

    # Blue Marble and other JPEG layers without compositing can be
    # cached directly, without another lossy JPEG conversion.
    if data[:3] == b"\xff\xd8\xff" and layer.background is None:
        return data

    with Image.open(BytesIO(data)) as downloaded:
        image = _flatten(downloaded)

        # Black lunar pixels can be real shadows. For polar PNGs,
        # use transparency to identify missing coverage.
        if source.projection == "polar":
            has_data = downloaded.convert("RGBA").getchannel("A")
        else:
            has_data = _data_mask(
                downloaded,
                by_transparency=layer.match_background,
            )

    if layer.land_mask is not None:
        has_data = has_data.filter(
            ImageFilter.MinFilter(GAP_EDGE_PX * 2 + 1)
        )
        land = _land(
            source_id,
            source,
            layer.land_mask,
            z,
            row,
            col,
        )
        has_data = ImageChops.multiply(has_data, land)

    if layer.background is None:
        if not has_data.getbbox():
            raise NoData
        return _jpeg(image)

    if not has_data.getbbox() and z > layer.background.max_level:
        # No high-resolution coverage: let the frontend show a
        # real coarser ancestor rather than enlarged imagery.
        raise NoData

    background = _background(
        source_id,
        source,
        layer.background,
        z,
        row,
        col,
    )

    if layer.match_background:
        gain = _brightness_gain(
            source_id,
            layer,
            layer.background,
            z,
            row,
            col,
        )
        image = image.point(
            lambda value: min(255, round(value * gain))
        )

    background.paste(image, (0, 0), has_data)
    return _jpeg(background)


def _within_latitude(
    source: TileSource,
    layer: Layer,
    z: int,
    row: int,
) -> bool:
    if layer.max_abs_lat is None or source.projection != "latlon":
        return True

    span = source.level0_span / 2**z
    top = 90 - row * span
    return max(abs(top), abs(top - span)) <= layer.max_abs_lat


def _background(
    source_id: str,
    source: TileSource,
    background: Layer,
    z: int,
    row: int,
    col: int,
) -> Image.Image:
    """Crop the matching part of a background tile."""
    bz = min(z, background.max_level)
    k = 2 ** (z - bz)

    with Image.open(
        _background_tile(
            source_id,
            background,
            bz,
            row // k,
            col // k,
        )
    ) as tile:
        part = source.tile_px // k
        left = (col % k) * part
        top = (row % k) * part
        image = tile.convert("RGB").crop(
            (left, top, left + part, top + part)
        )

    return image.resize(
        (source.tile_px, source.tile_px),
        Image.Resampling.BILINEAR,
    )


def _background_tile(
    source_id: str,
    background: Layer,
    z: int,
    row: int,
    col: int,
) -> Path:
    path = (
        settings.cache_dir
        / "surface_v5"
        / f"{source_id}_background"
        / str(z)
        / str(row)
        / f"{col}.jpg"
    )

    if not path.exists():
        _save(
            path,
            _download(
                background.url.format(z=z, row=row, col=col)
            ),
        )

    return path


def _land(
    source_id: str,
    source: TileSource,
    mask: Layer,
    z: int,
    row: int,
    col: int,
) -> Image.Image:
    """Return a land mask for layers that require one."""
    mz = min(z, mask.max_level)
    k = 2 ** (z - mz)
    mrow = row // k
    mcol = col // k

    path = (
        settings.cache_dir
        / "surface_v5"
        / f"{source_id}_landmask"
        / str(mz)
        / str(mrow)
        / f"{mcol}.png"
    )

    if not path.exists():
        try:
            data = _download(
                mask.url.format(z=mz, row=mrow, col=mcol)
            )
        except NoData:
            data = _png(
                Image.new("LA", (source.tile_px, source.tile_px))
            )

        _save(path, data)

    with Image.open(path) as tile:
        alpha = tile.convert("RGBA").getchannel("A")
        part = source.tile_px // k
        left = (col % k) * part
        top = (row % k) * part
        alpha = alpha.crop(
            (left, top, left + part, top + part)
        )

    return alpha.resize(
        (source.tile_px, source.tile_px),
        Image.Resampling.BILINEAR,
    )


def _brightness_gain(
    source_id: str,
    layer: Layer,
    background: Layer,
    z: int,
    row: int,
    col: int,
) -> float:
    """Match a sharper lunar layer to its background brightness."""
    bz = background.max_level
    k = 2 ** (z - bz)
    row = row // k
    col = col // k

    path = (
        settings.cache_dir
        / "surface_v5"
        / f"{source_id}_gain"
        / str(bz)
        / str(row)
        / f"{col}.txt"
    )

    if path.exists():
        return float(path.read_text())

    gain = 1.0

    try:
        data = _download(
            layer.url.format(z=bz, row=row, col=col)
        )
    except NoData:
        pass
    else:
        with Image.open(BytesIO(data)) as downloaded:
            sharp = _flatten(downloaded).convert("L")
            mask = _data_mask(
                downloaded,
                by_transparency=True,
            )

        if mask.getbbox():
            with Image.open(
                _background_tile(
                    source_id,
                    background,
                    bz,
                    row,
                    col,
                )
            ) as tile:
                coarse = tile.convert("L")

            sharp_mean = ImageStat.Stat(sharp, mask).mean[0]
            coarse_mean = ImageStat.Stat(coarse, mask).mean[0]
            gain = min(
                max(
                    coarse_mean / max(sharp_mean, 1),
                    GAIN_LIMITS[0],
                ),
                GAIN_LIMITS[1],
            )

    _save(path, f"{gain:.4f}".encode())
    return gain


def _data_mask(
    image: Image.Image,
    by_transparency: bool = False,
) -> Image.Image:
    """Return white for available data and black for missing data."""
    if not by_transparency:
        return (
            _flatten(image)
            .convert("L")
            .point(lambda value: 255 if value >= EMPTY_BELOW else 0)
        )

    if (
        image.mode in ("LA", "RGBA", "PA")
        or "transparency" in image.info
    ):
        mask = (
            image.convert("RGBA")
            .getchannel("A")
            .point(lambda value: 255 if value >= 128 else 0)
        )
    else:
        mask = (
            _flatten(image)
            .convert("L")
            .point(lambda value: 255 if value >= EMPTY_BELOW else 0)
        )

    return mask.filter(
        ImageFilter.MinFilter(GAP_EDGE_PX * 2 + 1)
    )


def _make_cap(source_id: str, pole: str) -> Image.Image:
    """Build a polar cap from global imagery and optional polar data."""
    band = _LatLonBand(source_id, pole)
    mosaic = POLAR_MOSAICS.get((source_id, pole))
    polar = (
        _load_polar_mosaic(source_id, pole, mosaic)
        if mosaic
        else None
    )

    try:
        gain_offset = (
            _match_brightness(band, polar, mosaic, pole)
            if polar is not None
            else None
        )

        out = np.empty((CAP_PX, CAP_PX, 3), np.uint8)

        for top in range(0, CAP_PX, CAP_STRIP_ROWS):
            rows = np.arange(
                top,
                min(top + CAP_STRIP_ROWS, CAP_PX),
            )
            x, y, lat, lon = _cap_pixels(
                rows,
                np.arange(CAP_PX),
                pole,
            )
            rgb = band.sample(lat, lon)

            if polar is not None and gain_offset is not None:
                values = (
                    _sample_polar(polar, mosaic, x, y)
                    * gain_offset[0]
                    + gain_offset[1]
                )
                fade = np.clip(
                    (np.abs(lat) - CAP_LAT) / CAP_BLEND_DEG,
                    0,
                    1,
                )
                fade[~np.isfinite(values)] = 0
                values = np.nan_to_num(values)[..., None]

                rgb = (
                    rgb * (1 - fade[..., None])
                    + values * fade[..., None]
                )

            out[rows] = np.clip(
                rgb + 0.5,
                0,
                255,
            ).astype(np.uint8)
    finally:
        if mosaic:
            _polar_mosaic_path(
                source_id,
                pole,
            ).unlink(missing_ok=True)

    return Image.fromarray(out)


def _cap_pixels(
    rows: np.ndarray,
    cols: np.ndarray,
    pole: str,
):
    """Return polar image coordinates and their latitude/longitude."""
    x = (
        ((cols + 0.5) / CAP_PX * 2 - 1)
        .astype(np.float32)[None, :]
        .repeat(len(rows), 0)
    )
    y = (
        (1 - (rows + 0.5) / CAP_PX * 2)
        .astype(np.float32)[:, None]
        .repeat(len(cols), 1)
    )

    to_pole = 2 * np.degrees(
        np.arctan(
            np.hypot(x, y)
            * math.tan(math.radians(45 - CAP_LAT / 2))
        )
    )

    lat = (
        90 - to_pole
        if pole == "north"
        else to_pole - 90
    )
    lon = np.degrees(
        np.arctan2(x, -y if pole == "north" else y)
    )

    return x, y, lat.astype(np.float32), lon.astype(np.float32)


class _LatLonBand:
    """Global imagery around one pole, with wrapped longitude edges."""

    def __init__(self, source_id: str, pole: str):
        source = SOURCES[source_id]
        z = CAP_LEVEL[source_id]
        span = source.level0_span / 2**z
        cols, rows = tile_grid(source, z)

        corner_lat = 90 - 2 * math.degrees(
            math.atan(
                math.sqrt(2)
                * math.tan(math.radians(45 - CAP_LAT / 2))
            )
        )

        if pole == "north":
            band_rows = range(
                math.ceil((90 - corner_lat) / span)
            )
        else:
            band_rows = range(
                math.floor((90 + corner_lat) / span),
                rows,
            )

        image = _stitch(source_id, z, band_rows, cols)
        array = np.asarray(image, np.float32)

        self.pixels = np.concatenate(
            [array[:, -1:], array, array[:, :1]],
            axis=1,
        )
        self.top_lat = 90 - band_rows[0] * span
        self.deg_per_px = span / source.tile_px

    def sample(
        self,
        lat: np.ndarray,
        lon: np.ndarray,
    ) -> np.ndarray:
        row = (self.top_lat - lat) / self.deg_per_px - 0.5
        col = (lon + 180) / self.deg_per_px - 0.5 + 1
        coords = [row.ravel(), col.ravel()]

        channels = [
            map_coordinates(
                self.pixels[..., channel],
                coords,
                order=1,
                mode="nearest",
            )
            for channel in range(3)
        ]

        return np.stack(
            channels,
            axis=-1,
        ).reshape(*lat.shape, 3)


def _polar_mosaic_path(source_id: str, pole: str) -> Path:
    return (
        settings.cache_dir
        / "surface_v5"
        / source_id
        / f"polar_mosaic_{pole}.img"
    )


def _load_polar_mosaic(
    source_id: str,
    pole: str,
    mosaic: PolarMosaic,
) -> np.ndarray:
    path = _polar_mosaic_path(source_id, pole)

    if not path.exists():
        tmp = path.with_name(
            f"{path.name}.{uuid4().hex}.part"
        )
        path.parent.mkdir(parents=True, exist_ok=True)

        with _http.get(
            mosaic.url,
            stream=True,
            timeout=TIMEOUT_S,
        ) as response:
            response.raise_for_status()

            with tmp.open("wb") as file:
                for chunk in response.iter_content(1 << 20):
                    file.write(chunk)

        tmp.replace(path)

    count = mosaic.size * mosaic.size
    pixels = np.fromfile(
        path,
        dtype="<f4",
        count=count,
        offset=mosaic.offset,
    )
    pixels = pixels.reshape(mosaic.size, mosaic.size)
    pixels[
        ~np.isfinite(pixels) | (pixels < -1e30)
    ] = np.nan

    return pixels


def _sample_polar(
    pixels: np.ndarray,
    mosaic: PolarMosaic,
    x: np.ndarray,
    y: np.ndarray,
):
    metres = (
        2
        * mosaic.radius_m
        * math.tan(math.radians(45 - CAP_LAT / 2))
    )

    col = (
        x * metres / mosaic.metres_per_pixel
        + mosaic.size / 2
        - 0.5
    )
    row = (
        mosaic.size / 2
        - y * metres / mosaic.metres_per_pixel
        - 0.5
    )
    coords = [row.ravel(), col.ravel()]

    values = map_coordinates(
        pixels,
        coords,
        order=1,
        mode="constant",
        cval=np.nan,
    )

    return values.reshape(x.shape)


def _match_brightness(
    band: _LatLonBand,
    pixels: np.ndarray,
    mosaic: PolarMosaic,
    pole: str,
) -> tuple[float, float]:
    step = CAP_PX // 512

    x, y, lat, lon = _cap_pixels(
        np.arange(0, CAP_PX, step),
        np.arange(0, CAP_PX, step),
        pole,
    )
    values = _sample_polar(pixels, mosaic, x, y)
    grey = band.sample(lat, lon).mean(axis=-1)

    ring = (
        (np.abs(lat) >= CAP_LAT)
        & (np.abs(lat) < CAP_LAT + 10)
        & np.isfinite(values)
    )

    gain = float(
        grey[ring].std() / values[ring].std()
    )
    offset = float(
        grey[ring].mean() - gain * values[ring].mean()
    )

    return gain, offset


def _stitch(
    source_id: str,
    z: int,
    rows: range,
    cols: int,
) -> Image.Image:
    px = SOURCES[source_id].tile_px
    cells = [
        (row, col)
        for row in rows
        for col in range(cols)
    ]

    def tile(cell: tuple[int, int]) -> Path | None:
        try:
            return get_tile(source_id, z, *cell)
        except NoData:
            return None

    with ThreadPoolExecutor(PARALLEL_DOWNLOADS) as pool:
        tile_paths = list(pool.map(tile, cells))

    image = Image.new(
        "RGB",
        (cols * px, len(rows) * px),
    )

    for (row, col), tile_path in zip(
        cells,
        tile_paths,
        strict=True,
    ):
        if tile_path is not None:
            with Image.open(tile_path) as tile_image:
                image.paste(
                    tile_image.convert("RGB"),
                    (col * px, (row - rows[0]) * px),
                )

    return image


def _lock(path: Path) -> threading.Lock:
    with _building_guard:
        return _building.setdefault(path, threading.Lock())


def _download(url: str) -> bytes:
    response = _http.get(url, timeout=TIMEOUT_S)

    if response.status_code in (400, 404):
        raise NoData

    response.raise_for_status()
    return response.content


def _flatten(image: Image.Image) -> Image.Image:
    if image.mode in ("LA", "RGBA", "PA", "P"):
        rgba = image.convert("RGBA")
        black = Image.new(
            "RGBA",
            rgba.size,
            (0, 0, 0, 255),
        )
        return Image.alpha_composite(
            black,
            rgba,
        ).convert("RGB")

    return image.convert("RGB")


def _jpeg(image: Image.Image) -> bytes:
    buffer = BytesIO()
    image.save(buffer, "JPEG", quality=88)
    return buffer.getvalue()


def _png(image: Image.Image) -> bytes:
    buffer = BytesIO()
    image.save(buffer, "PNG")
    return buffer.getvalue()


def _save(path: Path, data: bytes) -> None:
    """Write atomically so incomplete files are never served."""
    path.parent.mkdir(parents=True, exist_ok=True)

    tmp = path.with_name(
        f"{path.name}.{uuid4().hex}.part"
    )
    tmp.write_bytes(data)
    tmp.replace(path)