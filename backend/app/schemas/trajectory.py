from pydantic import BaseModel


class TrajectoryPoint(BaseModel):
    t_ms: float
    x_km: float
    y_km: float
    z_km: float


class Trajectory(BaseModel):
    illustrative: bool  # True = not a computed/flown path (scope item 05 requirement)
    method: str
    points: list[TrajectoryPoint]
