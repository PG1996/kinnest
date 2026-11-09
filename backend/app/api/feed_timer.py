import uuid
from datetime import datetime
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import AwareDatetime, BaseModel
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.auth.deps import Member, current_member, require_caregiver
from app.db import get_session
from app.models import FeedTimer
from app.services.entries import reject_future, user_names

router = APIRouter(prefix="/api")

FeedType = Literal["breast_left", "breast_right", "breast_both", "expressed", "formula"]


class TimerStart(BaseModel):
    id: uuid.UUID
    type: FeedType
    started_at: AwareDatetime


class TimerPatch(BaseModel):
    type: FeedType | None = None
    started_at: AwareDatetime | None = None
    ended_at: AwareDatetime | None = None  # a time stops it; null resumes it


def timer_json(t: FeedTimer, names: dict[uuid.UUID, str]) -> dict:
    return {
        "id": str(t.id),
        "type": t.type,
        "started_at": t.started_at.isoformat(),
        "ended_at": t.ended_at.isoformat() if t.ended_at else None,
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
    body: TimerStart, response: Response, member: Member = Depends(require_caregiver), db: Session = Depends(get_session)
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
    return render(db, t)


@router.patch("/feed-timer")
def patch_timer(body: TimerPatch, member: Member = Depends(require_caregiver), db: Session = Depends(get_session)) -> dict:
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
    for k, v in changes.items():
        if k == "type" and v is None:
            continue
        setattr(t, k, v)
    db.commit()
    return render(db, t)


@router.delete("/feed-timer")
def discard_timer(member: Member = Depends(require_caregiver), db: Session = Depends(get_session)) -> dict[str, bool]:
    t = active_timer(db, member.kid_id)
    if t is not None:
        db.delete(t)
        db.commit()
    return {"ok": True}
