import logging
import uuid
from datetime import UTC, datetime
from types import SimpleNamespace
from typing import Literal
from zoneinfo import ZoneInfo

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Response
from pydantic import AwareDatetime, BaseModel
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.auth.deps import Member, current_member, require_caregiver
from app.clock import get_now
from app.config import Settings, get_settings
from app.db import get_session
from app.i18n import FEED_TYPE_LABEL, render as render_text
from app.models import FeedTimer, PushSubscription
from app.services.entries import reject_future, user_names
from app.services.push import send_payload

log = logging.getLogger(__name__)

router = APIRouter(prefix="/api")

FeedType = Literal["breast_left", "breast_right", "breast_both", "expressed", "formula"]


class TimerStart(BaseModel):
    id: uuid.UUID
    type: FeedType
    started_at: AwareDatetime


class TimerPatch(BaseModel):
    type: FeedType | None = None
    started_at: AwareDatetime | None = None
    ended_at: AwareDatetime | None = None  # a time stops it; null resumes it (the time it was stopped counts as a break)
    paused: bool | None = None  # true starts a break, false ends it


def timer_json(t: FeedTimer, names: dict[uuid.UUID, str]) -> dict:
    return {
        "id": str(t.id),
        "type": t.type,
        "started_at": t.started_at.isoformat(),
        "ended_at": t.ended_at.isoformat() if t.ended_at else None,
        "paused_at": t.paused_at.isoformat() if t.paused_at else None,
        "paused_total_s": t.paused_total_s or 0,
        "started_by_name": names.get(t.started_by_user_id, ""),
    }


def active_timer(db: Session, kid_id: uuid.UUID) -> FeedTimer | None:
    return db.scalar(select(FeedTimer).where(FeedTimer.kid_id == kid_id))


def render(db: Session, t: FeedTimer) -> dict:
    return timer_json(t, user_names(db, {t.started_by_user_id}))


@router.get("/feed-timer")
def get_timer(member: Member = Depends(current_member), db: Session = Depends(get_session)) -> dict | None:
    t = active_timer(db, member.kid_id)
    return render(db, t) if t else None


def _already_running(db: Session, t: FeedTimer) -> None:
    raise HTTPException(409, {"message": "a feed is already being timed", "timer": render(db, t)})


@router.post("/feed-timer", status_code=201)
def start_timer(
    body: TimerStart,
    response: Response,
    background: BackgroundTasks,
    member: Member = Depends(require_caregiver),
    db: Session = Depends(get_session),
    settings: Settings = Depends(get_settings),
) -> dict:
    existing = db.get(FeedTimer, body.id)
    if existing is not None:
        if existing.family_id != member.family_id:
            raise HTTPException(409, "id already used")
        response.status_code = 200
        return render(db, existing)
    reject_future(body.started_at)
    running = active_timer(db, member.kid_id)
    if running is not None:
        _already_running(db, running)
    t = FeedTimer(
        id=body.id, family_id=member.family_id, kid_id=member.kid_id, type=body.type, started_at=body.started_at,
        started_by_user_id=member.user.id,
    )
    db.add(t)
    try:
        db.commit()
    except IntegrityError:  # another phone started one at the same moment
        db.rollback()
        running = active_timer(db, member.kid_id)
        if running is None:
            raise
        _already_running(db, running)
    _notify_started(db, t, member.user.name, settings, background)
    return render(db, t)


def _notify_started(db: Session, t: FeedTimer, name: str, settings: Settings, background: BackgroundTasks) -> None:
    """A quiet "Feeding since 9:10 PM" notification on the phones of whoever started the feed, with a Stop button."""
    subs = [
        SimpleNamespace(endpoint=p.endpoint, p256dh=p.p256dh, auth=p.auth)
        for p in db.scalars(select(PushSubscription).where(PushSubscription.user_id == t.started_by_user_id))
    ]
    if not subs:
        return
    time = t.started_at.astimezone(ZoneInfo(settings.app_timezone)).strftime("%I:%M %p").lstrip("0")
    title, body = render_text("feed_timer", {"time": time, "what": FEED_TYPE_LABEL["en"][t.type], "name": name})
    payload = {
        "title": title,
        "body": body,
        "url": "/?log=feed",
        "tag": "feed_timer",
        "silent": True,  # it is a status, not an alert
        "timestamp": int(t.started_at.timestamp() * 1000),
        "actions": [{"action": "stop", "title": "Stop"}],
        "stopUrl": "/?log=feed&timer=stop",
    }

    def send_all() -> None:
        for sub in subs:
            try:
                send_payload(sub, payload)
            except Exception:  # a push service that is down must never matter to the feed
                log.exception("feed timer notification failed")

    background.add_task(send_all)


@router.patch("/feed-timer")
def patch_timer(
    body: TimerPatch,
    member: Member = Depends(require_caregiver),
    db: Session = Depends(get_session),
    now: datetime = Depends(get_now),
) -> dict:
    t = active_timer(db, member.kid_id)
    if t is None:
        raise HTTPException(404, "no feed is being timed")
    changes = body.model_dump(exclude_unset=True)
    if changes.get("started_at"):
        reject_future(changes["started_at"])
    start = changes.get("started_at") or t.started_at
    end = changes["ended_at"] if "ended_at" in changes else t.ended_at
    if end is not None and end < start:
        raise HTTPException(422, "a feed cannot end before it starts")

    paused = changes.pop("paused", None)
    if paused is True:
        if t.ended_at is not None:
            raise HTTPException(409, "a stopped feed cannot be paused")
        if t.paused_at is None:
            t.paused_at = now
    elif paused is False:
        _end_break(t, now)
    if "ended_at" in changes:
        if changes["ended_at"] is None and t.ended_at is not None:
            t.paused_total_s += max(0, int((now - t.ended_at).total_seconds()))  # the time it stood stopped was a break
        elif changes["ended_at"] is not None and t.paused_at is not None:
            changes["ended_at"] = t.paused_at  # stopped during a break: the feeding ended when the break began
            t.paused_at = None
    for k, v in changes.items():
        if k == "type" and v is None:
            continue
        setattr(t, k, v)
    db.commit()
    return render(db, t)


def _end_break(t: FeedTimer, now: datetime) -> None:
    if t.paused_at is not None:
        t.paused_total_s += max(0, int((now - t.paused_at).total_seconds()))
        t.paused_at = None


@router.delete("/feed-timer")
def discard_timer(member: Member = Depends(require_caregiver), db: Session = Depends(get_session)) -> dict[str, bool]:
    t = active_timer(db, member.kid_id)
    if t is not None:
        db.delete(t)
        db.commit()
    return {"ok": True}
