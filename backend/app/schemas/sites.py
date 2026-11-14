from pydantic import BaseModel


class Site(BaseModel):
    id: str
    name: str
    lat_deg: float
    lon_deg: float
    elevation_m: float | None = None
    notes: str | None = None


class TimeValue(BaseModel):
    t_ms: float
    value: float


class SiteAnalysis(BaseModel):
    site_id: str
    slope_deg: float | None = None
    illumination_fraction: float | None = None
    earth_visibility_fraction: float | None = None
    sun_elevation_deg: list[TimeValue] = []
    earth_elevation_deg: list[TimeValue] = []
