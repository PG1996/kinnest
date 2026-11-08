import uuid
from datetime import UTC, date, datetime
from typing import Literal
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth.deps import Member, current_member, require_caregiver
from app.clock import get_now
from app.config import Settings, get_settings
from app.db import get_session
from app.models import Kid, Vaccination
from app.services.vaccines import due_date_for, entry_key, load_templates

router = APIRouter(prefix="/api")

Status = Literal["pending", "given", "skipped"]


class VaccineIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    dose_label: str = Field(default="", max_length=60)
    due_date: date
    status: Status = "pending"
    given_on: date | None = None
    place: str = Field(default="", max_length=120)
    notes: str = Field(default="", max_length=2000)


class VaccinePatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    dose_label: str | None = Field(default=None, max_length=60)
    due_date: date | None = None
    status: Status | None = None
    given_on: date | None = None
    place: str | None = Field(default=None, max_length=120)
    notes: str | None = Field(default=None, max_length=2000)


class ApplyIn(BaseModel):
    template_id: str
    mode: Literal["fill", "add_missing"] = "fill"


def _today(now: datetime, tz: str) -> date:
    return now.astimezone(ZoneInfo(tz)).date()


def vaccination_json(v: Vaccination, today: date) -> dict:
    return {
        "id": str(v.id),
        "name": v.name,
        "dose_label": v.dose_label,
        "due_date": v.due_date.isoformat(),
        "given_on": v.given_on.isoformat() if v.given_on else None,
        "status": v.status,
        "place": v.place,
        "notes": v.notes,
        "source": v.source,
        "overdue": v.status == "pending" and v.due_date < today,
        "days_until": (v.due_date - today).days,
    }


def _live(db: Session, kid_id: uuid.UUID) -> list[Vaccination]:
    return list(db.scalars(
        select(Vaccination)
        .where(Vaccination.kid_id == kid_id, Vaccination.deleted_at.is_(None))
        .order_by(Vaccination.due_date, Vaccination.created_at)
    ))


def _one(db: Session, member: Member, vid: uuid.UUID) -> Vaccination:
    v = db.get(Vaccination, vid)
    if v is None or v.family_id != member.family_id or v.deleted_at is not None:
        raise HTTPException(404, "vaccination not found")
    return v


def _check_given(status: str, given_on: date | None, today: date, birth: date | None) -> None:
    if status != "given":
        return
    if given_on is None:
        raise HTTPException(422, "given_on is required when marking a vaccine given")
    if given_on > today:
        raise HTTPException(422, "given_on is in the future")
    if birth and given_on < birth:
        raise HTTPException(422, "given_on cannot be before the birth date")


@router.get("/vaccines/templates")
def templates(_m: Member = Depends(current_member)) -> list[dict]:
    return [
        {
            "id": t["id"], "name": t["name"], "description": t["description"], "source_url": t["source_url"],
            "source_title": t.get("source_title", ""), "source_date": t["source_date"],
            "retrieved_on": t.get("retrieved_on", ""), "count": len(t["entries"]),
        }
        for t in load_templates().values()
    ]


@router.post("/vaccines/apply-template", status_code=201)
def apply_template(
    body: ApplyIn,
    member: Member = Depends(require_caregiver),
    db: Session = Depends(get_session),
    now: datetime = Depends(get_now),
    settings: Settings = Depends(get_settings),
):
    template = load_templates().get(body.template_id)
    if template is None:
        raise HTTPException(404, "template not found")
    kid = db.get(Kid, member.kid_id)
    if kid.birth_date is None:
        raise HTTPException(409, "birth date not set")
    # one apply at a time per kid, so a double tap cannot fill the schedule twice
    db.scalar(select(Kid.id).where(Kid.id == kid.id).with_for_update())
    live = _live(db, kid.id)
    if body.mode == "fill" and live:
        return JSONResponse(
            status_code=409, content={"detail": "a vaccination schedule already exists", "existing": len(live)}
        )
    have = {entry_key(v.name, v.dose_label) for v in live}
    me = member.user.id
    created = 0
    for e in template["entries"]:
        if entry_key(e["name"], e["dose_label"]) in have:
            continue
        db.add(Vaccination(
            family_id=member.family_id, kid_id=kid.id, name=e["name"], dose_label=e["dose_label"],
            due_date=due_date_for(kid.birth_date, e["due_after"]), notes=e.get("notes", ""), source=template["id"],
            status="pending", created_by=me, updated_by=me,
        ))
        created += 1
    db.commit()
    today = _today(now, settings.app_timezone)
    return {"created": created, "entries": [vaccination_json(v, today) for v in _live(db, kid.id)]}


@router.get("/vaccines")
def list_vaccines(
    member: Member = Depends(current_member),
    db: Session = Depends(get_session),
    now: datetime = Depends(get_now),
    settings: Settings = Depends(get_settings),
) -> list[dict]:
    today = _today(now, settings.app_timezone)
    return [vaccination_json(v, today) for v in _live(db, member.kid_id)]


@router.post("/vaccines", status_code=201)
def create_vaccine(
    body: VaccineIn,
    member: Member = Depends(require_caregiver),
    db: Session = Depends(get_session),
    now: datetime = Depends(get_now),
    settings: Settings = Depends(get_settings),
) -> dict:
    today = _today(now, settings.app_timezone)
    _check_given(body.status, body.given_on, today, db.get(Kid, member.kid_id).birth_date)
    me = member.user.id
    v = Vaccination(
        family_id=member.family_id, kid_id=member.kid_id, source="manual", created_by=me, updated_by=me,
        **{**body.model_dump(), "given_on": body.given_on if body.status == "given" else None},
    )
    db.add(v)
    db.commit()
    return vaccination_json(v, today)


@router.patch("/vaccines/{vaccine_id}")
def patch_vaccine(
    vaccine_id: uuid.UUID,
    body: VaccinePatch,
    member: Member = Depends(require_caregiver),
    db: Session = Depends(get_session),
    now: datetime = Depends(get_now),
    settings: Settings = Depends(get_settings),
) -> dict:
    v = _one(db, member, vaccine_id)
    changes = body.model_dump(exclude_unset=True)
    for k in ("name", "dose_label", "due_date", "status", "place", "notes"):
        if k in changes and changes[k] is None:
            raise HTTPException(422, f"{k} cannot be empty")
    today = _today(now, settings.app_timezone)
    status = changes.get("status", v.status)
    given_on = changes.get("given_on", v.given_on)
    _check_given(status, given_on, today, db.get(Kid, member.kid_id).birth_date)
    for k, val in changes.items():
        setattr(v, k, val)
    if status != "given":
        v.given_on = None
    v.updated_by = member.user.id
    db.commit()
    return vaccination_json(v, today)


@router.delete("/vaccines/{vaccine_id}")
def delete_vaccine(
    vaccine_id: uuid.UUID, member: Member = Depends(require_caregiver), db: Session = Depends(get_session)
) -> dict[str, bool]:
    v = _one(db, member, vaccine_id)
    v.deleted_at = datetime.now(UTC)
    v.updated_by = member.user.id
    db.commit()
    return {"ok": True}
