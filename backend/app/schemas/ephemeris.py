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
