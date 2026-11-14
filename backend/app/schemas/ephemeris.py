from pydantic import BaseModel


class EphemerisSample(BaseModel):
    t_ms: float  # Unix ms (Horizons uses TDB; ~69 s off UTC, fine for visuals)
    x_km: float
    y_km: float
    z_km: float


class EphemerisResponse(BaseModel):
    body_id: str
    center: str
    frame: str = "ecliptic J2000"
    samples: list[EphemerisSample]


# ---------- Solar system: positions for one year + orbits ----------


class StateSample(BaseModel):
    """Position and velocity of a body relative to the Sun at one moment."""

    t_ms: float  # Unix ms (Horizons uses TDB; ~69 s off UTC, fine for visuals)
    x_km: float
    y_km: float
    z_km: float
    vx_km_s: float
    vy_km_s: float
    vz_km_s: float


class OrbitalElements(BaseModel):
    """Osculating orbital elements at one moment (names follow the Horizons table)."""

    t_ms: float  # the moment these elements describe (Unix ms)
    center: str  # what the orbit goes around: "500@10" Sun, "500@399" Earth
    ec: float  # EC  e - eccentricity (shape of the ellipse)
    a_km: float  # A   a - semi-major axis (size of the orbit)
    in_deg: float  # IN  i - inclination (tilt of the orbit plane)
    om_deg: float  # OM  Ω - longitude of the ascending node
    w_deg: float  # W   ω - argument of perihelion
    ma_deg: float  # MA  M - mean anomaly
    ta_deg: float  # TA  ν - true anomaly
    pr_s: float  # PR  T - orbital period [s]


class BodyEphemeris(BaseModel):
    body_id: str
    samples: list[StateSample]  # one per day
    # Only for orbits that change during the year (the Moon): its orbit for every day.
    # Planet orbits barely change, they come from /api/orbits instead.
    daily_orbits: list[OrbitalElements] | None = None


class EphemerisYear(BaseModel):
    start: str  # YYYY-MM-DD
    stop: str
    step: str
    center: str
    frame: str = "ecliptic J2000"
    bodies: dict[str, BodyEphemeris]
