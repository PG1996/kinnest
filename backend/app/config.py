from functools import lru_cache

from pydantic import model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


PLACEHOLDERS = {"change-me", "dev-secret-change-me"}


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

    @model_validator(mode="after")
    def _no_placeholder_secrets_when_public(self) -> "Settings":
        """Anything reachable over HTTPS must not run with a guessable session secret or database password."""
        if self.public_base_url.startswith("https://"):
            if self.session_secret in PLACEHOLDERS or len(self.session_secret) < 32:
                raise ValueError("SESSION_SECRET must be a random value of at least 32 characters (openssl rand -hex 32)")
            if ":change-me@" in self.database_url:
                raise ValueError("set a real database password instead of change-me")
        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()
