from fastapi import APIRouter, Body, Depends
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth.deps import Member, current_member
from app.config import Settings, get_settings
from app.db import get_session
from app.models import NotificationPref, PushSubscription

router = APIRouter(prefix="/api")

PREF_KINDS = ("feed", "diaper")


class Keys(BaseModel):
    p256dh: str
    auth: str


class SubscribeBody(BaseModel):
    endpoint: str
    keys: Keys


class PrefsBody(BaseModel):
    feed: bool
    diaper: bool


@router.get("/push/public-key")
def public_key(_m: Member = Depends(current_member), settings: Settings = Depends(get_settings)) -> dict[str, str]:
    return {"public_key": settings.vapid_public_key}


@router.post("/push/subscribe")
def subscribe(body: SubscribeBody, member: Member = Depends(current_member), db: Session = Depends(get_session)) -> dict[str, bool]:
    sub = db.scalar(select(PushSubscription).where(PushSubscription.endpoint == body.endpoint))
    if sub is None:
        sub = PushSubscription(endpoint=body.endpoint, user_id=member.user.id, p256dh=body.keys.p256dh, auth=body.keys.auth)
        db.add(sub)
    else:  # same browser, possibly a different account now
        sub.user_id, sub.p256dh, sub.auth = member.user.id, body.keys.p256dh, body.keys.auth
    db.commit()
    return {"ok": True}


@router.delete("/push/subscribe")
def unsubscribe(
    endpoint: str = Body(embed=True), member: Member = Depends(current_member), db: Session = Depends(get_session)
) -> dict[str, bool]:
    sub = db.scalar(
        select(PushSubscription).where(PushSubscription.endpoint == endpoint, PushSubscription.user_id == member.user.id)
    )
    if sub:
        db.delete(sub)
        db.commit()
    return {"ok": True}


def _prefs(db: Session, user_id) -> dict[str, bool]:
    rows = {p.kind: p.enabled for p in db.scalars(select(NotificationPref).where(NotificationPref.user_id == user_id))}
    return {k: rows.get(k, True) for k in PREF_KINDS}


@router.get("/notification-prefs")
def get_prefs(member: Member = Depends(current_member), db: Session = Depends(get_session)) -> dict[str, bool]:
    return _prefs(db, member.user.id)


@router.put("/notification-prefs")
def put_prefs(body: PrefsBody, member: Member = Depends(current_member), db: Session = Depends(get_session)) -> dict[str, bool]:
    for kind in PREF_KINDS:
        row = db.get(NotificationPref, (member.user.id, kind))
        if row is None:
            db.add(NotificationPref(user_id=member.user.id, kind=kind, enabled=getattr(body, kind)))
        else:
            row.enabled = getattr(body, kind)
    db.commit()
    return _prefs(db, member.user.id)
