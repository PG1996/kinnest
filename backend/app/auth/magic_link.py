import hashlib
import secrets
from datetime import UTC, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import Settings
from app.models import MagicToken
from app.services.email import send_email

TTL = timedelta(minutes=15)


def _hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def send_magic_link(db: Session, settings: Settings, email: str) -> None:
    email = email.strip().lower()
    raw = secrets.token_urlsafe(32)
    db.add(MagicToken(email=email, token_hash=_hash(raw), expires_at=datetime.now(UTC) + TTL))
    db.flush()
    link = f"{settings.public_base_url}/api/auth/magic/verify?token={raw}"
    send_email(
        settings,
        email,
        "Your Kinnest sign-in link",
        f"Sign in to Kinnest:\n{link}\nThe link works once and expires in 15 minutes.\n",
    )


def consume_magic_token(db: Session, raw: str) -> str | None:
    """Return the email for a valid unused token and mark it used; else None."""
    row = db.scalar(select(MagicToken).where(MagicToken.token_hash == _hash(raw)))
    now = datetime.now(UTC)
    if row is None or row.used_at is not None or row.expires_at < now:
        return None
    row.used_at = now
    db.flush()
    return row.email
