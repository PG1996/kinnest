import uuid
from dataclasses import dataclass

from fastapi import Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth.sessions import COOKIE_NAME, read_session_value
from app.config import Settings, get_settings
from app.db import get_session
from app.models import Kid, Membership, User


@dataclass
class Member:
    user: User
    family_id: uuid.UUID
    kid_id: uuid.UUID
    role: str


def current_member(
    request: Request,
    db: Session = Depends(get_session),
    settings: Settings = Depends(get_settings),
) -> Member:
    raw = request.cookies.get(COOKIE_NAME)
    parsed = read_session_value(settings, raw) if raw else None
    if parsed is None:
        raise HTTPException(401, "not signed in")
    user_id, version = parsed
    user = db.get(User, user_id)
    if user is None or user.session_version != version:
        raise HTTPException(401, "session expired")
    membership = db.scalar(select(Membership).where(Membership.user_id == user.id))
    if membership is None:
        raise HTTPException(401, "no access")
    kid = db.scalar(select(Kid).where(Kid.family_id == membership.family_id).order_by(Kid.created_at))
    return Member(user, membership.family_id, kid.id, membership.role)


def require_caregiver(member: Member = Depends(current_member)) -> Member:
    if member.role not in ("admin", "caregiver"):
        raise HTTPException(403, "caregiver access required")
    return member


def require_admin(member: Member = Depends(current_member)) -> Member:
    if member.role != "admin":
        raise HTTPException(403, "admin access required")
    return member
