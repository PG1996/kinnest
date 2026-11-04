from datetime import UTC, datetime

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import Settings
from app.models import Family, Invite, Kid, Membership, User


def _open_invite(db: Session, email: str) -> Invite | None:
    return db.scalar(
        select(Invite).where(Invite.email == email.strip().lower(), Invite.accepted_at.is_(None))
    )


def login_allowed(db: Session, settings: Settings, email: str) -> bool:
    email = email.strip().lower()
    if email == settings.owner_email.strip().lower():
        return True
    user = db.scalar(select(User).where(User.email == email))
    if user and db.scalar(select(Membership).where(Membership.user_id == user.id)):
        return True
    return _open_invite(db, email) is not None


def complete_login(db: Session, settings: Settings, email: str, name: str = "") -> User:
    """Return the user for a proven email, creating family/membership on first owner login or invite."""
    email = email.strip().lower()
    if not login_allowed(db, settings, email):
        raise HTTPException(403, "not invited")
    user = db.scalar(select(User).where(User.email == email))
    if user is None:
        user = User(email=email, name=name or email.split("@")[0])
        db.add(user)
        db.flush()
    if db.scalar(select(Membership).where(Membership.user_id == user.id)) is None:
        if email == settings.owner_email.strip().lower():
            family = db.scalar(select(Family).order_by(Family.created_at))
            if family is None:
                family = Family(name="My Family")
                db.add(family)
                db.flush()
                db.add(Kid(family_id=family.id, name="Baby"))
            db.add(Membership(family_id=family.id, user_id=user.id, role="admin"))
        else:
            invite = _open_invite(db, email)
            db.add(Membership(family_id=invite.family_id, user_id=user.id, role=invite.role))
            invite.accepted_at = datetime.now(UTC)
        db.flush()
    return user
