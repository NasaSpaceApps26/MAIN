import hashlib

from astroquery.jplhorizons import Horizons

from app.core.config import settings
from app.schemas.ephemeris import EphemerisResponse, EphemerisSample

AU_KM = 149_597_870.7
JD_UNIX_EPOCH = 2440587.5


def fetch_vectors(
    body_id: str, horizons_id: str, center: str, start: str, stop: str, step: str
) -> EphemerisResponse:
    key = hashlib.sha1(f"{horizons_id}|{center}|{start}|{stop}|{step}".encode()).hexdigest()
    cache_file = settings.cache_dir / "ephemeris" / f"{key}.json"
    if cache_file.exists():
        return EphemerisResponse.model_validate_json(cache_file.read_text())

    table = Horizons(
        id=horizons_id,
        location=center,
        epochs={"start": start, "stop": stop, "step": step},
    ).vectors(refplane="ecliptic")

    samples = [
        EphemerisSample(
            t_ms=(float(row["datetime_jd"]) - JD_UNIX_EPOCH) * 86_400_000,
            x_km=float(row["x"]) * AU_KM,
            y_km=float(row["y"]) * AU_KM,
            z_km=float(row["z"]) * AU_KM,
        )
        for row in table
    ]
    resp = EphemerisResponse(body_id=body_id, center=center, samples=samples)

    cache_file.parent.mkdir(parents=True, exist_ok=True)
    cache_file.write_text(resp.model_dump_json())
    return resp
