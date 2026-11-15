from fastapi import APIRouter
from app.api.routes import bodies, ephemeris, health, sites, surface, terrain, trajectory

api_router = APIRouter()
api_router.include_router(health.router, tags=["health"])
api_router.include_router(bodies.router, tags=["bodies"])
api_router.include_router(ephemeris.router, tags=["ephemeris"])
api_router.include_router(sites.router, tags=["sites"])
api_router.include_router(trajectory.router, tags=["trajectory"])
api_router.include_router(surface.router, tags=["surface"])
api_router.include_router(terrain.router, tags=["terrain"])
