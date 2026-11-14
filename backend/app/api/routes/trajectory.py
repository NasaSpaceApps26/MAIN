from fastapi import APIRouter, HTTPException

from app.schemas.trajectory import Trajectory

router = APIRouter()


@router.get("/trajectory", response_model=Trajectory)
def get_trajectory(departure: str, site: str, launch: str) -> Trajectory:
    raise HTTPException(501, "Trajectory not implemented yet")
