from pydantic import BaseModel


class Body(BaseModel):
    id: str
    name: str
    horizons_id: str
    radius_km: float  # volumetric mean radius
    # How much the poles are squashed: (equatorial - polar) / equatorial radius. 0 = perfect sphere
    flattening: float = 0.0
    rotation_period_h: float  # negative = retrograde
    color: str
    texture: str | None = None
