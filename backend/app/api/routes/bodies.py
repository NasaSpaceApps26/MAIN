from fastapi import APIRouter

from app.schemas.bodies import Body
from app.services.bodies import BODIES

router = APIRouter()


@router.get("/bodies", response_model=list[Body])
def list_bodies() -> list[Body]:
    return BODIES
