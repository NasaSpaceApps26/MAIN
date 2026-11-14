"""Planet orbits: downloaded once from JPL Horizons, then always loaded from disk.

Planet orbits hardly change over decades (between 1969 and 2040 the real positions stay within
about 0.5% of one fixed orbit), so a single set of orbital elements at the standard reference
date J2000 (2000-01-01) is used for every period. The file goes to data/orbits/ instead of the
cache folder, so it can be committed to git and nobody has to download it again.

The Moon is not in here: its orbit changes every day, so it comes with each year of data.
"""

import json
from datetime import date, timedelta

from app.core.config import settings
from app.schemas.ephemeris import OrbitalElements
from app.services.bodies import BODIES
from app.services.horizons_year import DAILY_ORBITS, SUN, fetch_orbital_elements

EPOCH = date(2000, 1, 1)  # J2000, the standard reference date in astronomy
ORBITS_FILE = settings.data_dir / "orbits" / "planets_j2000.json"


def get_planet_orbits() -> dict[str, OrbitalElements]:
    """Orbital elements of every planet around the Sun. Downloaded once (~10 s)."""
    if ORBITS_FILE.exists():
        saved = json.loads(ORBITS_FILE.read_text())
        return {body_id: OrbitalElements.model_validate(el) for body_id, el in saved.items()}

    next_day = EPOCH + timedelta(days=1)
    orbits = {
        body.id: fetch_orbital_elements(body.horizons_id, SUN, EPOCH, next_day)[0]
        for body in BODIES
        if body.id != "sun" and body.id not in DAILY_ORBITS
    }
    ORBITS_FILE.parent.mkdir(parents=True, exist_ok=True)
    ORBITS_FILE.write_text(
        json.dumps({body_id: el.model_dump() for body_id, el in orbits.items()}, indent=2)
    )
    return orbits
