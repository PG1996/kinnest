import uuid
from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from fastapi.responses import JSONResponse
from pydantic import AwareDatetime, BaseModel
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.auth.deps import Member, current_member, require_caregiver
from app.db import get_session
from app.models import SleepSession
from app.services.entries import reject_future, user_names

router = APIRouter(prefix="/api")


class SleepStart(BaseModel):
    id: uuid.UUID
    started_at: AwareDatetime
    note: str = ""


class SleepEnd(BaseModel):
    ended_at: AwareDatetime


class SleepPatch(BaseModel):
    started_at: AwareDatetime | None = None
    ended_at: AwareDatetime | None = None
    note: str | None = None


def sleep_json(s: SleepSession, names: dict) -> dict:
    return {
        "id": str(s.id),
        "started_at": s.started_at.isoformat(),
        "ended_at": s.ended_at.isoformat() if s.ended_at else None,
        "started_by_name": names.get(s.started_by_user_id, ""),
        "ended_by_name": names.get(s.ended_by_user_id, "") if s.ended_by_user_id else None,
        "duration_min": int((s.ended_at - s.started_at).total_seconds() // 60) if s.ended_at else None,
        "note": s.note,
    }


def _render(db: Session, s: SleepSession) -> dict:
    return sleep_json(s, user_names(db, {s.started_by_user_id, s.ended_by_user_id} - {None}))


def _open_session(db: Session, kid_id: uuid.UUID) -> SleepSession | None:
    return db.scalar(
        select(SleepSession).where(
            SleepSession.kid_id == kid_id, SleepSession.ended_at.is_(None), SleepSession.deleted_at.is_(None)
        )
    )


def _one(db: Session, member: Member, sleep_id: uuid.UUID) -> SleepSession:
    s = db.get(SleepSession, sleep_id)
    if s is None or s.family_id != member.family_id or s.deleted_at is not None:
        raise HTTPException(404, "sleep session not found")
    return s


def _already_asleep(db: Session, open_session: SleepSession) -> JSONResponse:
    return JSONResponse(status_code=409, content={"detail": "already asleep", "open": _render(db, open_session)})


@router.post("/sleep", status_code=201)
def start_sleep(
    body: SleepStart, response: Response, member: Member = Depends(require_caregiver), db: Session = Depends(get_session)
):
    existing = db.get(SleepSession, body.id)
    if existing is not None:
        if existing.family_id != member.family_id:
            raise HTTPException(409, "id already used")
        response.status_code = 200
        return _render(db, existing)
    reject_future(body.started_at)
    open_session = _open_session(db, member.kid_id)
    if open_session is not None:
        return _already_asleep(db, open_session)
    me = member.user.id
    s = SleepSession(
        id=body.id, family_id=member.family_id, kid_id=member.kid_id, started_at=body.started_at,
        started_by_user_id=me, note=body.note, created_by=me, updated_by=me,
    )
    db.add(s)
    try:
        db.commit()
    except IntegrityError:  # another phone started a session at the same moment
        db.rollback()
        open_session = _open_session(db, member.kid_id)
        if open_session is None:
            raise
        return _already_asleep(db, open_session)
    return _render(db, s)


@router.post("/sleep/{sleep_id}/end")
def end_sleep(
    sleep_id: uuid.UUID, body: SleepEnd, member: Member = Depends(require_caregiver), db: Session = Depends(get_session)
) -> dict:
    s = _one(db, member, sleep_id)
    if s.ended_at is not None:
        if s.ended_at == body.ended_at:
            return _render(db, s)  # a retry of the same request
        raise HTTPException(409, "already ended at a different time")
    reject_future(body.ended_at)
    if body.ended_at < s.started_at:
        raise HTTPException(422, "cannot end before it started")
    s.ended_at, s.ended_by_user_id, s.updated_by = body.ended_at, member.user.id, member.user.id
    db.commit()
    return _render(db, s)


@router.patch("/sleep/{sleep_id}")
def patch_sleep(
    sleep_id: uuid.UUID, body: SleepPatch, member: Member = Depends(require_caregiver), db: Session = Depends(get_session)
) -> dict:
    s = _one(db, member, sleep_id)
    data = body.model_dump(exclude_unset=True)
    started = data.get("started_at") or s.started_at
    ended = data["ended_at"] if "ended_at" in data else s.ended_at
    for ts in (data.get("started_at"), data.get("ended_at")):
        if ts:
            reject_future(ts)
    if ended is not None and ended < started:
        raise HTTPException(422, "cannot end before it started")
    s.started_at, s.ended_at = started, ended
    if "ended_at" in data and ended is not None and s.ended_by_user_id is None:
        s.ended_by_user_id = member.user.id
    if data.get("note") is not None:
        s.note = data["note"]
    s.updated_by = member.user.id
    db.commit()
    return _render(db, s)


@router.delete("/sleep/{sleep_id}")
def delete_sleep(sleep_id: uuid.UUID, member: Member = Depends(require_caregiver), db: Session = Depends(get_session)) -> dict[str, bool]:
    s = _one(db, member, sleep_id)
    s.deleted_at = datetime.now(UTC)
    s.updated_by = member.user.id
    db.commit()
    return {"ok": True}


@router.get("/sleep")
def list_sleep(
    from_: AwareDatetime | None = Query(default=None, alias="from"),
    to: AwareDatetime | None = None,
    member: Member = Depends(current_member),
    db: Session = Depends(get_session),
) -> list[dict]:
    q = select(SleepSession).where(SleepSession.kid_id == member.kid_id, SleepSession.deleted_at.is_(None))
    if from_:
        q = q.where(SleepSession.started_at >= from_)
    if to:
        q = q.where(SleepSession.started_at <= to)
    rows = db.scalars(q.order_by(SleepSession.started_at.desc())).all()
    ids = {r.started_by_user_id for r in rows} | {r.ended_by_user_id for r in rows if r.ended_by_user_id}
    names = user_names(db, ids)
    return [sleep_json(r, names) for r in rows]
