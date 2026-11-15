from collections.abc import Callable
from pathlib import Path

import requests
from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse

from app.services import quickmap_surface, surface_tiles
from app.services.surface_tiles import (
    NoData,
    TileSource,
    tile_grid,
)

router = APIRouter(prefix="/surface")

TILE_HEADERS = {
    "Cache-Control": "public, max-age=31536000, immutable",
}

BASE_MAP_HEADERS = {
    "Cache-Control": "public, max-age=86400",
}

SOURCES = quickmap_surface.SOURCES


def _source(source_id: str) -> TileSource:
    source = SOURCES.get(source_id)

    if source is None:
        raise HTTPException(
            404,
            f"No map for '{source_id}'. "
            f"Maps: {', '.join(SOURCES)}",
        )

    return source


def _service(source_id: str):
    # Keep the existing Blue Marble implementation for Earth.
    # All lunar imagery now goes through QuickMap.
    if source_id == "earth":
        return surface_tiles

    return quickmap_surface


def _load(
    loader: Callable[..., Path],
    *args,
) -> Path:
    try:
        return loader(*args)
    except NoData as error:
        raise HTTPException(
            404,
            "No imagery for this region",
        ) from error
    except (
        requests.RequestException,
        OSError,
        ValueError,
    ) as error:
        # Failed upstream requests are not cached as missing imagery.
        raise HTTPException(
            502,
            f"Could not prepare surface imagery: {error}",
        ) from error


@router.get("/{source_id}/base.jpg")
def base_map(source_id: str) -> FileResponse:
    source = _source(source_id)

    if source.projection != "latlon":
        raise HTTPException(
            404,
            "Only longitude/latitude maps have a base map",
        )

    path = _load(
        _service(source_id).get_base_map,
        source_id,
    )

    return FileResponse(
        path,
        media_type="image/jpeg",
        headers=BASE_MAP_HEADERS,
    )


@router.get("/{source_id}/caps/{pole}.jpg")
def cap(source_id: str, pole: str) -> FileResponse:
    source = _source(source_id)

    if source.projection != "latlon":
        raise HTTPException(
            404,
            "Only longitude/latitude maps have caps",
        )

    if pole not in ("north", "south"):
        raise HTTPException(
            404,
            "The pole is 'north' or 'south'",
        )

    path = _load(
        _service(source_id).get_cap,
        source_id,
        pole,
    )

    return FileResponse(
        path,
        media_type="image/jpeg",
        headers=BASE_MAP_HEADERS,
    )


@router.get("/{source_id}/{z}/{row}/{col}")
def tile(
    source_id: str,
    z: int,
    row: int,
    col: int,
) -> FileResponse:
    source = _source(source_id)

    if not source.min_level <= z <= source.max_level:
        raise HTTPException(
            404,
            f"Levels go from {source.min_level} "
            f"to {source.max_level}",
        )

    cols, rows = tile_grid(source, z)

    if not (
        0 <= row < rows
        and 0 <= col < cols
    ):
        raise HTTPException(
            404,
            f"Level {z} has {rows} rows "
            f"and {cols} columns",
        )

    path = _load(
        _service(source_id).get_tile,
        source_id,
        z,
        row,
        col,
    )

    return FileResponse(
        path,
        media_type="image/jpeg",
        headers=TILE_HEADERS,
    )