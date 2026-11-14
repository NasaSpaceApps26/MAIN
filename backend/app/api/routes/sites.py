from fastapi import APIRouter, HTTPException

from app.schemas.sites import Site, SiteAnalysis
from app.services.sites import load_sites

router = APIRouter(prefix="/sites")


@router.get("/lunar", response_model=list[Site])
def lunar_sites() -> list[Site]:
    return load_sites("lunar")


@router.get("/departure", response_model=list[Site])
def departure_sites() -> list[Site]:
    return load_sites("departure")


@router.get("/lunar/{site_id}/analysis", response_model=SiteAnalysis)
def site_analysis(site_id: str, start: str, stop: str) -> SiteAnalysis:
    raise HTTPException(501, "Site analysis not implemented yet")
