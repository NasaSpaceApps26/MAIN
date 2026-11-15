from typing import Literal
import requests
from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse
from app.services import site_model
from app.services.moon_terrain import prepare
from app.services.surface_tiles import NoData

router = APIRouter(prefix="/terrain")
HEADERS = {"Cache-Control": "public, max-age=31536000, immutable"}

@router.get("/moon/v1/{name}")
def moon_terrain(name: Literal["metadata.json", "heights.bin"]):
    try:
        metadata, binary = prepare()
    except (requests.RequestException, OSError, ValueError) as error:
        raise HTTPException(502, f"Could not prepare lunar elevation: {error}") from error
    if name == "metadata.json":
        return FileResponse(metadata, media_type="application/json", headers=HEADERS)
    return FileResponse(binary, media_type="application/octet-stream", headers=HEADERS)


def _site(loader, lat: float, lon: float, media_type: str):
    if not (-90 <= lat <= 90 and -360 <= lon <= 360):
        raise HTTPException(422, "lat must be in [-90, 90] and lon in [-360, 360]")
    try:
        path = loader(lat, lon)
    except NoData as error:
        raise HTTPException(404, "No imagery for this site") from error
    except (requests.RequestException, OSError, ValueError) as error:
        raise HTTPException(502, f"Could not prepare the landing site model: {error}") from error
    return FileResponse(path, media_type=media_type, headers=HEADERS)


@router.get("/moon/site/heights.json")
def site_heights(lat: float, lon: float):
    """Heights of a 40 × 40 km patch around a landing site (see services/site_model.py)."""
    return _site(site_model.get_heights, lat, lon, "application/json")


@router.get("/moon/site/imagery.jpg")
def site_imagery(lat: float, lon: float):
    """LROC imagery of the same patch, north up."""
    return _site(site_model.get_imagery, lat, lon, "image/jpeg")
