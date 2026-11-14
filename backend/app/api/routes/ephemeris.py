from fastapi import APIRouter, HTTPException

from app.schemas.ephemeris import EphemerisResponse
from app.services.bodies import get_body
from app.services.horizons import fetch_vectors

router = APIRouter()


@router.get("/ephemeris", response_model=EphemerisResponse)
def get_ephemeris(
    body: str, start: str, stop: str, step: str = "1h", center: str = "500@10"
) -> EphemerisResponse:
    b = get_body(body)
    if b is None:
        raise HTTPException(404, f"Unknown body '{body}'")
    try:
        return fetch_vectors(b.id, b.horizons_id, center, start, stop, step)
    except Exception as exc:  # network / Horizons errors
        raise HTTPException(502, f"Horizons request failed: {exc}") from exc
