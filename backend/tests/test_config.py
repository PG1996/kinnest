import pytest
from pydantic import ValidationError

from app.config import Settings

STRONG = "a1" * 20


def test_plain_http_dev_defaults_are_allowed():
    Settings()  # defaults: http, dev secret


@pytest.mark.parametrize("secret", ["change-me", "dev-secret-change-me", "short"])
def test_https_refuses_weak_session_secret(secret):
    with pytest.raises(ValidationError):
        Settings(public_base_url="https://kinnest.example.com", session_secret=secret)


def test_https_refuses_placeholder_database_password():
    with pytest.raises(ValidationError):
        Settings(
            public_base_url="https://kinnest.example.com",
            session_secret=STRONG,
            database_url="postgresql+psycopg://kinnest:change-me@db:5432/kinnest",
        )


def test_https_accepts_strong_secret():
    Settings(
        public_base_url="https://kinnest.example.com",
        session_secret=STRONG,
        database_url="postgresql+psycopg://kinnest:s3cure-pw@db:5432/kinnest",
    )
