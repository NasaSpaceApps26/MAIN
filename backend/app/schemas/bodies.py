from pydantic import BaseModel


class Body(BaseModel):
    id: str
    name: str
    horizons_id: str
    radius_km: float
    rotation_period_h: float  # negative = retrograde
    color: str
    texture: str | None = None
