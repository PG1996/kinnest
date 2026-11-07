import uuid
from datetime import UTC, datetime
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from pydantic import AwareDatetime, BaseModel, Field
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.auth.deps import Member, current_member, require_caregiver
from app.db import get_session
from app.models import Diaper
from app.services.entries import ensure_family_member, recent_other, reject_future, user_names

router = APIRouter(prefix="/api")

Kind = Literal["wet", "dirty", "both"]


class DiaperIn(BaseModel):
    id: uuid.UUID
    kind: Kind
    at: AwareDatetime
    note: str = ""
    changed_by_user_id: uuid.UUID | None = None


class DiaperPatch(BaseModel):
    kind: Kind | None = None
    at: AwareDatetime | None = None
    note: str | None = None
    changed_by_user_id: uuid.UUID | None = None


def diaper_json(d: Diaper, names: dict[uuid.UUID, str]) -> dict:
    return {
        "id": str(d.id),
        "kind": d.kind,
        "at": d.at.isoformat(),
        "note": d.note,
        "changed_by_user_id": str(d.changed_by_user_id),
        "changed_by_name": names.get(d.changed_by_user_id, ""),
        "created_by": str(d.created_by),
    }


def _one(db: Session, member: Member, diaper_id: uuid.UUID) -> Diaper:
    d = db.get(Diaper, diaper_id)
    if d is None or d.family_id != member.family_id or d.deleted_at is not None:
        raise HTTPException(404, "diaper not found")
    return d


@router.post("/diapers", status_code=201)
def create_diaper(
    body: DiaperIn, response: Response, member: Member = Depends(require_caregiver), db: Session = Depends(get_session)
) -> dict:
    existing = db.get(Diaper, body.id)
    if existing is not None:
        if existing.family_id != member.family_id:
            raise HTTPException(409, "id already used")
        response.status_code = 200
        return {**diaper_json(existing, user_names(db, {existing.changed_by_user_id})), "recent_other": None}
    reject_future(body.at)
    me = member.user.id
    if body.changed_by_user_id:
        ensure_family_member(db, member.family_id, body.changed_by_user_id)
    diaper = Diaper(
        id=body.id, family_id=member.family_id, kid_id=member.kid_id, kind=body.kind, at=body.at,
        note=body.note, changed_by_user_id=body.changed_by_user_id or me, created_by=me, updated_by=me,
    )
    warning = recent_other(db, Diaper, member.kid_id, me, body.id)
    db.add(diaper)
    try:
        db.commit()
    except IntegrityError:  # another request stored this id between our lookup and insert
        db.rollback()
        existing = db.get(Diaper, body.id)
        if existing is None or existing.family_id != member.family_id:
            raise HTTPException(409, "id already used")
        response.status_code = 200
        return {**diaper_json(existing, user_names(db, {existing.changed_by_user_id})), "recent_other": None}
    return {**diaper_json(diaper, user_names(db, {diaper.changed_by_user_id})), "recent_other": warning}


@router.get("/diapers")
def list_diapers(
    from_: AwareDatetime | None = Query(default=None, alias="from"),
    to: AwareDatetime | None = None,
    member: Member = Depends(current_member),
    db: Session = Depends(get_session),
) -> list[dict]:
    q = select(Diaper).where(Diaper.kid_id == member.kid_id, Diaper.deleted_at.is_(None))
    if from_:
        q = q.where(Diaper.at >= from_)
    if to:
        q = q.where(Diaper.at <= to)
    rows = db.scalars(q.order_by(Diaper.at.desc())).all()
    names = user_names(db, {r.changed_by_user_id for r in rows})
    return [diaper_json(r, names) for r in rows]


@router.patch("/diapers/{diaper_id}")
def patch_diaper(
    diaper_id: uuid.UUID, body: DiaperPatch, member: Member = Depends(require_caregiver), db: Session = Depends(get_session)
) -> dict:
    diaper = _one(db, member, diaper_id)
    data = body.model_dump(exclude_none=True)
    if "at" in data:
        reject_future(data["at"])
    if data.get("changed_by_user_id"):
        ensure_family_member(db, member.family_id, data["changed_by_user_id"])
    for k, v in data.items():
        setattr(diaper, k, v)
    diaper.updated_by = member.user.id
    db.commit()
    return diaper_json(diaper, user_names(db, {diaper.changed_by_user_id}))


@router.delete("/diapers/{diaper_id}")
def delete_diaper(
    diaper_id: uuid.UUID, member: Member = Depends(require_caregiver), db: Session = Depends(get_session)
) -> dict[str, bool]:
    diaper = _one(db, member, diaper_id)
    diaper.deleted_at = datetime.now(UTC)
    diaper.updated_by = member.user.id
    db.commit()
    return {"ok": True}
