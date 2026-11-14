from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

BASE_DIR = Path(__file__).resolve().parents[2]  # -> backend/


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    app_name: str = "Lunar Mission Explorer API"
    cors_origins: list[str] = ["http://localhost:5173"]
    data_dir: Path = BASE_DIR / "data"

    @property
    def cache_dir(self) -> Path:
        return self.data_dir / "cache"

    @property
    def static_dir(self) -> Path:
        return self.data_dir / "static"

    @property
    def sites_dir(self) -> Path:
        return self.data_dir / "sites"


settings = Settings()
