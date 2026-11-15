"""Prepare the NASA LOLA global DEM as a compact, shared height grid."""
import json
import threading
from pathlib import Path
from uuid import uuid4

import numpy as np
import requests
from PIL import Image

from app.core.config import settings

URL = "https://svs.gsfc.nasa.gov/vis/a000000/a004700/a004720/ldem_16.tif"
ROOT = settings.cache_dir / "moon_terrain_v1"
DATASET = "LOLA-LDEM16-SVS-v1"
_lock = threading.Lock()


def _atomic(path: Path, data: bytes):
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_name(f"{path.name}.{uuid4().hex}.part")
    try:
        temp.write_bytes(data)
        temp.replace(path)
    finally:
        temp.unlink(missing_ok=True)


def encode(raw: np.ndarray):
    if raw.shape != (2880, 5760) or raw.dtype.kind != "f":
        raise ValueError("Unexpected LOLA dimensions or data type")
    height = np.array(raw, dtype=np.float32, copy=True) * 1000
    if not np.all(np.isfinite(height)) or np.max(np.abs(height)) > 50000:
        raise ValueError("The elevation grid contains invalid values")
    low, high = float(height.min()), float(height.max())
    span = high - low
    pixels = np.zeros(height.shape, dtype="<u2")
    if span > 0:
        pixels = np.rint((height - low) * (65535 / span)).astype("<u2")
    metadata = {
        "dataset_id": DATASET,
        "width": int(height.shape[1]),
        "height": int(height.shape[0]),
        "minimum_elevation_m": low,
        "maximum_elevation_m": high,
        "reference_radius_m": 1737400,
        "encoding": "uint16-normalized-little-endian",
        "longitude_range": [-180, 180],
        "latitude_range": [90, -90],
        "pixel_registration": "center",
        "source_url": URL,
        "source_spacing_m_equator": 2 * np.pi * 1737400 / height.shape[1],
    }
    return metadata, pixels.tobytes()


def prepare():
    metadata = ROOT / "metadata.json"
    binary = ROOT / "heights.bin"
    with _lock:
        if metadata.exists() and binary.exists():
            info = json.loads(metadata.read_text("utf-8"))
            expected = info["width"] * info["height"] * 2
            if binary.stat().st_size == expected:
                return metadata, binary
        ROOT.mkdir(parents=True, exist_ok=True)
        original = ROOT / "ldem_16.tif"
        if not original.exists():
            temp = original.with_name(f"{original.name}.{uuid4().hex}.part")
            try:
                with requests.get(URL, stream=True, timeout=(15, 180)) as response:
                    response.raise_for_status()
                    with temp.open("wb") as out:
                        for chunk in response.iter_content(1024 * 1024):
                            if chunk:
                                out.write(chunk)
                with Image.open(temp) as check:
                    if check.size != (5760, 2880) or check.mode != "F":
                        raise ValueError("Unexpected NASA TIFF")
                    check.load()
                temp.replace(original)
            finally:
                temp.unlink(missing_ok=True)
        with Image.open(original) as image:
            info, data = encode(np.asarray(image))
        _atomic(binary, data)
        _atomic(metadata, json.dumps(info, indent=2).encode("utf-8"))
    return metadata, binary
