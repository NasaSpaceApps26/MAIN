import json
from functools import lru_cache

from app.core.config import settings
from app.schemas.sites import Site


@lru_cache
def load_sites(kind: str) -> list[Site]:
    path = settings.sites_dir / f"{kind}_sites.json"
    return [Site(**s) for s in json.loads(path.read_text(encoding="utf-8"))]
