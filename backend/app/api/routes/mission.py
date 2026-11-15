from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.services import mission

router = APIRouter(prefix="/mission")


class MissionRequest(BaseModel):
    launch_time_ms: float  # earliest launch moment (the launch window is searched from here)
    launch_lat: float = Field(ge=-90, le=90)
    launch_lon: float = Field(ge=-180, le=180)
    landing_lat: float = Field(ge=-90, le=90)
    landing_lon: float = Field(ge=-180, le=180)
    mode: str = "szybki"  # "szybki" (fastest) or "oszczedny" (least fuel)


@router.post("")
def start_mission(req: MissionRequest) -> dict:
    if req.mode not in mission.MODES:
        raise HTTPException(422, f"mode must be one of {mission.MODES}")
    # whole hour: nearby clock times share one computed flight
    t = datetime.fromtimestamp(req.launch_time_ms / 1000, tz=timezone.utc).replace(minute=0, second=0, microsecond=0)
    params = {
        "launch_utc": t.strftime("%Y-%m-%d %H:%M:%S"),
        "launch_lat": round(req.launch_lat, 4),
        "launch_lon": round(req.launch_lon, 4),
        "landing_lat": round(req.landing_lat, 4),
        "landing_lon": round(req.landing_lon, 4),
        "mode": req.mode,
    }
    return {"id": mission.start(params)}


@router.get("/{job_id}")
def mission_status(job_id: str) -> dict:
    s = mission.status(job_id)
    if s is None:
        raise HTTPException(404, "Unknown mission")
    return s
