from typing import Literal
import requests
from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse
from app.services.moon_terrain import prepare

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
