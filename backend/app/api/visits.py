import uuid
from datetime import UTC, datetime
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import AwareDatetime, BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth.deps import Member, current_member, require_caregiver
from app.db import get_session
from app.models import DoctorVisit

router = APIRouter(prefix="/api")

Status = Literal["upcoming", "done", "cancelled"]


class VisitIn(BaseModel):
    scheduled_at: AwareDatetime
    doctor: str = Field(default="", max_length=120)
    place: str = Field(default="", max_length=120)
    reason: str = Field(default="", max_length=500)
    status: Status = "upcoming"
    notes: str = Field(default="", max_length=5000)
    prescription_notes: str = Field(default="", max_length=5000)


class VisitPatch(BaseModel):
    scheduled_at: AwareDatetime | None = None
    doctor: str | None = Field(default=None, max_length=120)
    place: str | None = Field(default=None, max_length=120)
    reason: str | None = Field(default=None, max_length=500)
    status: Status | None = None
    notes: str | None = Field(default=None, max_length=5000)
    prescription_notes: str | None = Field(default=None, max_length=5000)


def visit_json(v: DoctorVisit) -> dict:
    return {
        "id": str(v.id),
        "scheduled_at": v.scheduled_at.isoformat(),
        "doctor": v.doctor,
        "place": v.place,
        "reason": v.reason,
        "status": v.status,
        "notes": v.notes,
        "prescription_notes": v.prescription_notes,
    }


def _one(db: Session, member: Member, visit_id: uuid.UUID) -> DoctorVisit:
    v = db.get(DoctorVisit, visit_id)
    if v is None or v.family_id != member.family_id or v.deleted_at is not None:
        raise HTTPException(404, "visit not found")
    return v


@router.get("/visits")
def list_visits(
    status: Status | None = None,
    from_: AwareDatetime | None = Query(default=None, alias="from"),
    to: AwareDatetime | None = None,
    member: Member = Depends(current_member),
    db: Session = Depends(get_session),
) -> list[dict]:
    q = select(DoctorVisit).where(DoctorVisit.kid_id == member.kid_id, DoctorVisit.deleted_at.is_(None))
    if status:
        q = q.where(DoctorVisit.status == status)
    if from_:
        q = q.where(DoctorVisit.scheduled_at >= from_)
    if to:
        q = q.where(DoctorVisit.scheduled_at <= to)
    rows = db.scalars(q).all()
    # upcoming first, soonest first; then done and cancelled, newest first
    upcoming = sorted((r for r in rows if r.status == "upcoming"), key=lambda r: r.scheduled_at)
    past = sorted((r for r in rows if r.status != "upcoming"), key=lambda r: r.scheduled_at, reverse=True)
    return [visit_json(r) for r in upcoming + past]


@router.post("/visits", status_code=201)
def create_visit(body: VisitIn, member: Member = Depends(require_caregiver), db: Session = Depends(get_session)) -> dict:
    me = member.user.id
    v = DoctorVisit(family_id=member.family_id, kid_id=member.kid_id, created_by=me, updated_by=me, **body.model_dump())
    db.add(v)
    db.commit()
    return visit_json(v)


@router.patch("/visits/{visit_id}")
def patch_visit(
    visit_id: uuid.UUID, body: VisitPatch, member: Member = Depends(require_caregiver), db: Session = Depends(get_session)
) -> dict:
    v = _one(db, member, visit_id)
    changes = body.model_dump(exclude_unset=True)
    for k, val in changes.items():
        if val is None:
            raise HTTPException(422, f"{k} cannot be empty")
        setattr(v, k, val)
    v.updated_by = member.user.id
    db.commit()
    return visit_json(v)


@router.delete("/visits/{visit_id}")
def delete_visit(
    visit_id: uuid.UUID, member: Member = Depends(require_caregiver), db: Session = Depends(get_session)
) -> dict[str, bool]:
    v = _one(db, member, visit_id)
    v.deleted_at = datetime.now(UTC)
    v.updated_by = member.user.id
    db.commit()
    return {"ok": True}
