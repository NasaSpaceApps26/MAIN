from datetime import date

from fastapi import APIRouter, HTTPException

from app.schemas.ephemeris import EphemerisResponse, EphemerisYear, OrbitalElements
from app.services.bodies import get_body
from app.services.horizons import fetch_vectors
from app.services.horizons_year import get_year
from app.services.orbits import get_planet_orbits

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


@router.get("/ephemeris/year", response_model=EphemerisYear)
def get_ephemeris_year(start: date) -> EphemerisYear:
    """Positions of all bodies + the Moon's daily orbit for one year from `start` (YYYY-MM-DD).

    The first call for a given start date takes ~15 s, after that it is read from disk.
    """
    try:
        return get_year(start)
    except Exception as exc:  # network / Horizons errors
        raise HTTPException(502, f"Horizons request failed: {exc}") from exc


@router.get("/orbits", response_model=dict[str, OrbitalElements])
def get_orbits() -> dict[str, OrbitalElements]:
    """Planet orbits (J2000), the same for every period. Downloaded once, then read from disk."""
    try:
        return get_planet_orbits()
    except Exception as exc:  # network / Horizons errors
        raise HTTPException(502, f"Horizons request failed: {exc}") from exc
