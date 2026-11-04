from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "postgresql+psycopg://kinnest:kinnest@localhost:5433/kinnest"
    session_secret: str = "dev-secret-change-me"
    owner_email: str = "owner@example.com"
    google_client_id: str = ""
    google_client_secret: str = ""
    vapid_public_key: str = ""
    vapid_private_key: str = ""
    vapid_subject: str = "mailto:owner@example.com"
    smtp_url: str = ""
    public_base_url: str = "http://localhost:8000"
    app_timezone: str = "Asia/Kolkata"


@lru_cache
def get_settings() -> Settings:
    return Settings()
