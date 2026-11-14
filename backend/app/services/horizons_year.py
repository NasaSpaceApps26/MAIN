"""Positions of every body for one year, plus the Moon's orbit for every day of that year.

Based on the team's standalone ephemeris script, with these changes:
- the start date comes from the simulation clock (sent by the frontend), stop = start + 366 days
- ecliptic J2000 frame, centred on the Sun (the same frame as the orbital-elements table)
- the Moon's orbit changes noticeably from day to day, so its orbital elements are downloaded
  for every day of the year (planet orbits barely change: see services/orbits.py)
- the result is saved as JSON in data/cache, so each year is only downloaded once
"""

import csv
from datetime import date, timedelta
from io import StringIO

import requests

from app.core.config import settings
from app.schemas.ephemeris import BodyEphemeris, EphemerisYear, OrbitalElements, StateSample
from app.services.bodies import BODIES

API_URL = "https://ssd.jpl.nasa.gov/api/horizons.api"
JD_UNIX_EPOCH = 2440587.5  # Julian Date of 1970-01-01 00:00 (Unix time 0)
WINDOW_DAYS = 366  # one year, also covers leap years
STEP = "1 day"  # smooth motion comes from interpolation in the frontend

SUN = "500@10"  # Sun centre
EARTH = "500@399"  # Earth centre

# Bodies whose orbit changes noticeably during a year, and what they go around.
# Their orbit is downloaded for every day. (Planet orbits are loaded once: services/orbits.py)
DAILY_ORBITS = {"moon": EARTH}

# Settings shared by every request. Horizons wants each value wrapped in single quotes.
BASE_PARAMS = {
    "format": "json",
    "OBJ_DATA": "'NO'",
    "MAKE_EPHEM": "'YES'",
    "REF_PLANE": "'ECLIPTIC'",  # x/y in the plane of Earth's orbit, z = ecliptic north
    "REF_SYSTEM": "'ICRF'",
    "OUT_UNITS": "'KM-S'",
    "CSV_FORMAT": "'YES'",
    "TIME_TYPE": "'TDB'",
}


def _jd_to_unix_ms(jd: float) -> float:
    return (jd - JD_UNIX_EPOCH) * 86_400_000


def _horizons_table(params: dict[str, str]) -> list[dict[str, str]]:
    """Call Horizons and return the table between $$SOE and $$EOE as a list of dicts."""
    response = requests.get(API_URL, params={**BASE_PARAMS, **params}, timeout=120)
    response.raise_for_status()
    result = response.json()
    if "error" in result:
        raise RuntimeError(result["error"])

    text = result["result"]
    if "$$SOE" not in text or "$$EOE" not in text:
        raise RuntimeError("Horizons returned no ephemeris table")

    header_part, rest = text.split("$$SOE", 1)
    table_part = rest.split("$$EOE", 1)[0]

    # Column names (JDTDB, X, Y, ... or EC, A, IN, ...) are on the last header line before $$SOE
    header_line = [line for line in header_part.splitlines() if "JDTDB" in line][-1]
    columns = [name.strip() for name in header_line.split(",") if name.strip()]

    rows = []
    for values in csv.reader(StringIO(table_part)):
        values = [v.strip() for v in values]
        if len(values) >= len(columns):
            rows.append(dict(zip(columns, values, strict=False)))
    return rows


def fetch_state_vectors(horizons_id: str, start: date, stop: date) -> list[StateSample]:
    """Daily position + velocity relative to the Sun."""
    rows = _horizons_table(
        {
            "COMMAND": f"'{horizons_id}'",
            "EPHEM_TYPE": "'VECTORS'",
            "CENTER": f"'{SUN}'",
            "START_TIME": f"'{start.isoformat()}'",
            "STOP_TIME": f"'{stop.isoformat()}'",
            "STEP_SIZE": f"'{STEP}'",
            "VEC_TABLE": "'2'",  # position and velocity
            "VEC_CORR": "'NONE'",  # true geometric position, no light-time correction
            "VEC_LABELS": "'NO'",
        }
    )
    return [
        StateSample(
            t_ms=_jd_to_unix_ms(float(r["JDTDB"])),
            x_km=float(r["X"]),
            y_km=float(r["Y"]),
            z_km=float(r["Z"]),
            vx_km_s=float(r["VX"]),
            vy_km_s=float(r["VY"]),
            vz_km_s=float(r["VZ"]),
        )
        for r in rows
    ]


def fetch_orbital_elements(
    horizons_id: str, center: str, start: date, stop: date
) -> list[OrbitalElements]:
    """Osculating orbital elements (the e, a, i, Ω, ω, M, ν, T table), one row per day."""
    rows = _horizons_table(
        {
            "COMMAND": f"'{horizons_id}'",
            "EPHEM_TYPE": "'ELEMENTS'",
            "CENTER": f"'{center}'",
            "START_TIME": f"'{start.isoformat()}'",
            "STOP_TIME": f"'{stop.isoformat()}'",
            "STEP_SIZE": f"'{STEP}'",
        }
    )
    return [
        OrbitalElements(
            t_ms=_jd_to_unix_ms(float(r["JDTDB"])),
            center=center,
            ec=float(r["EC"]),
            a_km=float(r["A"]),
            in_deg=float(r["IN"]),
            om_deg=float(r["OM"]),
            w_deg=float(r["W"]),
            ma_deg=float(r["MA"]),
            ta_deg=float(r["TA"]),
            pr_s=float(r["PR"]),
        )
        for r in rows
    ]


def get_year(start: date) -> EphemerisYear:
    """One year of data for every body from `start`. Downloaded once, then read from disk."""
    cache_file = settings.cache_dir / "ephemeris_year" / f"{start.isoformat()}.json"
    if cache_file.exists():
        return EphemerisYear.model_validate_json(cache_file.read_text())

    stop = start + timedelta(days=WINDOW_DAYS)
    bodies: dict[str, BodyEphemeris] = {}
    for body in BODIES:
        if body.id == "sun":
            continue  # the Sun is the centre of the frame, always at (0, 0, 0)

        daily_orbits = None
        if body.id in DAILY_ORBITS:
            center = DAILY_ORBITS[body.id]
            daily_orbits = fetch_orbital_elements(body.horizons_id, center, start, stop)

        bodies[body.id] = BodyEphemeris(
            body_id=body.id,
            samples=fetch_state_vectors(body.horizons_id, start, stop),
            daily_orbits=daily_orbits,
        )

    year = EphemerisYear(
        start=start.isoformat(), stop=stop.isoformat(), step=STEP, center=SUN, bodies=bodies
    )
    cache_file.parent.mkdir(parents=True, exist_ok=True)
    cache_file.write_text(year.model_dump_json())
    return year
