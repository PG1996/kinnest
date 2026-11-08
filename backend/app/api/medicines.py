import re
import uuid
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from typing import Literal
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from fastapi.encoders import jsonable_encoder
from fastapi.responses import JSONResponse
from pydantic import AwareDatetime, BaseModel, Field, ValidationError, field_validator, model_validator
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.auth.deps import Member, current_member, require_admin, require_caregiver
from app.clock import get_now
from app.config import Settings, get_settings
from app.db import get_session
from app.models import Medicine, MedicineDose
from app.services import schedule
from app.services.entries import recent_doses, reject_future, user_names
from app.units import DOSE_UNITS, MAX_DOSE

router = APIRouter(prefix="/api")

TIME_RE = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")
Kind = Literal["fixed", "interval", "as_needed"]


class MedicineIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    dose_amount: Decimal = Field(gt=0, le=MAX_DOSE, decimal_places=2)
    dose_unit: str
    schedule_kind: Kind
    times: list[str] = []
    interval_hours: int | None = None
    first_dose_at: AwareDatetime | None = None
    min_gap_hours: int | None = None
    start_date: date
    end_date: date | None = None
    notes: str = ""

    @field_validator("dose_unit")
    @classmethod
    def _known_unit(cls, v: str) -> str:
        if v not in DOSE_UNITS:
            raise ValueError(f"dose_unit must be one of {', '.join(DOSE_UNITS)}")
        return v

    @model_validator(mode="after")
    def _check_schedule(self) -> "MedicineIn":
        if self.schedule_kind == "fixed":
            if not self.times or any(not TIME_RE.match(t) for t in self.times) or len(set(self.times)) != len(self.times):
                raise ValueError("fixed medicines need one or more distinct HH:MM times")
            self.interval_hours = self.first_dose_at = self.min_gap_hours = None
        elif self.schedule_kind == "interval":
            if self.interval_hours is None or not 1 <= self.interval_hours <= 72 or self.first_dose_at is None:
                raise ValueError("interval medicines need interval_hours (1-72) and first_dose_at")
            self.times, self.min_gap_hours = [], None
        else:
            if self.min_gap_hours is not None and not 1 <= self.min_gap_hours <= 48:
                raise ValueError("min_gap_hours must be 1-48")
            self.times, self.interval_hours, self.first_dose_at = [], None, None
        if self.end_date is not None and self.end_date < self.start_date:
            raise ValueError("end_date is before start_date")
        return self


class MedicinePatch(BaseModel):
    name: str | None = None
    dose_amount: Decimal | None = None
    dose_unit: str | None = None
    schedule_kind: Kind | None = None
    times: list[str] | None = None
    interval_hours: int | None = None
    first_dose_at: AwareDatetime | None = None
    min_gap_hours: int | None = None
    start_date: date | None = None
    end_date: date | None = None
    notes: str | None = None


class DoseIn(BaseModel):
    id: uuid.UUID
    status: Literal["given", "skipped"]
    amount: Decimal | None = Field(default=None, gt=0, le=MAX_DOSE, decimal_places=2)
    given_at: AwareDatetime | None = None
    scheduled_for: AwareDatetime | None = None
    note: str = ""


FIELDS = ("name", "dose_amount", "dose_unit", "schedule_kind", "times", "interval_hours", "first_dose_at", "min_gap_hours", "start_date", "end_date", "notes")


def _validated(data: dict) -> MedicineIn:
    try:
        return MedicineIn(**data)
    except ValidationError as e:
        raise HTTPException(422, detail=jsonable_encoder(e.errors(include_url=False, include_context=False, include_input=False)))


def _iso(ts: datetime | None) -> str | None:
    return ts.isoformat() if ts else None


def _num(x: Decimal | None) -> float | None:
    return float(x) if x is not None else None


def dose_json(d: MedicineDose, names: dict) -> dict:
    return {
        "id": str(d.id),
        "medicine_id": str(d.medicine_id),
        "status": d.status,
        "amount": _num(d.amount),
        "scheduled_for": _iso(d.scheduled_for),
        "given_at": _iso(d.given_at),
        "by_user_id": str(d.by_user_id),
        "by_name": names.get(d.by_user_id, ""),
        "note": d.note,
    }


def medicine_json(m: Medicine, doses: list[MedicineDose], names: dict, now: datetime, tz: str) -> dict:
    today_slots = schedule.today_slots(m, doses, now, tz)
    slots = list(today_slots)
    known = {s.due_at for s in slots}
    slots += [  # a recent missed slot (e.g. last night's) stays open until someone ticks or skips it
        schedule.slot_state(m, doses, due) for due in schedule.unresolved_due_slots(m, doses, now, tz) if due not in known
    ]
    slots.sort(key=lambda s: s.due_at)
    last = doses[0] if doses else None
    today = now.astimezone(ZoneInfo(tz)).date()
    return {
        "id": str(m.id),
        "name": m.name,
        "dose_amount": _num(m.dose_amount),
        "dose_unit": m.dose_unit,
        "schedule_kind": m.schedule_kind,
        "times": list(m.times or []),
        "interval_hours": m.interval_hours,
        "first_dose_at": _iso(m.first_dose_at),
        "min_gap_hours": m.min_gap_hours,
        "start_date": m.start_date.isoformat(),
        "end_date": m.end_date.isoformat() if m.end_date else None,
        "notes": m.notes,
        "ended": m.end_date is not None and m.end_date < today,
        "slots": [
            {
                "due_at": _iso(s.due_at),
                "status": s.status,
                "given_amount": _num(s.given_amount),
                "remaining": _num(s.remaining),
                "doses": [
                    {"id": str(d.id), "amount": _num(d.amount), "status": d.status, "given_at": _iso(d.given_at),
                     "by_name": names.get(d.by_user_id, "")}
                    for d in s.doses
                ],
                "dose_id": str(s.dose.id) if s.dose else None,  # the latest piece
                "given_at": _iso(s.dose.given_at) if s.dose else None,
                "by_name": names.get(s.dose.by_user_id, "") if s.dose else None,
                "nudge": None,
            }
            for s in slots
        ],
        "last_dose": (
            {"id": str(last.id), "status": last.status, "amount": _num(last.amount), "given_at": _iso(last.given_at),
             "by_name": names.get(last.by_user_id, "")}
            if last
            else None
        ),
    }


def _render(db: Session, m: Medicine, now: datetime, tz: str) -> dict:
    doses = recent_doses(db, m.id)
    return medicine_json(m, doses, user_names(db, {d.by_user_id for d in doses}), now, tz)


def _medicine(db: Session, member: Member, medicine_id: uuid.UUID) -> Medicine:
    m = db.get(Medicine, medicine_id)
    if m is None or m.family_id != member.family_id or m.deleted_at is not None:
        raise HTTPException(404, "medicine not found")
    return m


@router.get("/medicines")
def list_medicines(
    include_ended: bool = False,
    member: Member = Depends(current_member),
    db: Session = Depends(get_session),
    settings: Settings = Depends(get_settings),
    now: datetime = Depends(get_now),
) -> list[dict]:
    rows = db.scalars(
        select(Medicine)
        .where(Medicine.kid_id == member.kid_id, Medicine.deleted_at.is_(None))
        .order_by(Medicine.created_at)
    ).all()
    out = [_render(db, m, now, settings.app_timezone) for m in rows]
    return out if include_ended else [m for m in out if not m["ended"]]


@router.post("/medicines", status_code=201)
def create_medicine(
    body: dict,
    member: Member = Depends(require_admin),
    db: Session = Depends(get_session),
    settings: Settings = Depends(get_settings),
    now: datetime = Depends(get_now),
) -> dict:
    data = _validated(body).model_dump()
    me = member.user.id
    m = Medicine(family_id=member.family_id, kid_id=member.kid_id, created_by=me, updated_by=me, **data)
    db.add(m)
    db.commit()
    return _render(db, m, now, settings.app_timezone)


@router.patch("/medicines/{medicine_id}")
def patch_medicine(
    medicine_id: uuid.UUID,
    body: MedicinePatch,
    member: Member = Depends(require_admin),
    db: Session = Depends(get_session),
    settings: Settings = Depends(get_settings),
    now: datetime = Depends(get_now),
) -> dict:
    m = _medicine(db, member, medicine_id)
    merged = {f: getattr(m, f) for f in FIELDS} | body.model_dump(exclude_unset=True)
    data = _validated(merged).model_dump()  # validate the medicine as it would be after the change
    for f, v in data.items():
        setattr(m, f, v)
    m.updated_by = member.user.id
    db.commit()
    return _render(db, m, now, settings.app_timezone)


@router.delete("/medicines/{medicine_id}")
def delete_medicine(
    medicine_id: uuid.UUID, member: Member = Depends(require_admin), db: Session = Depends(get_session)
) -> dict[str, bool]:
    m = _medicine(db, member, medicine_id)
    m.deleted_at = datetime.now(UTC)  # soft delete: dose history stays
    m.updated_by = member.user.id
    db.commit()
    return {"ok": True}


def _existing_response(db: Session, d: MedicineDose, response: Response) -> dict:
    response.status_code = 200
    return {**dose_json(d, user_names(db, {d.by_user_id})), "gap_warning": None}


def _refused(detail: str, remaining: Decimal | None) -> JSONResponse:
    return JSONResponse(status_code=409, content={"detail": detail, "remaining": _num(remaining)})


@router.post("/medicines/{medicine_id}/doses", status_code=201)
def give_dose(
    medicine_id: uuid.UUID,
    body: DoseIn,
    response: Response,
    member: Member = Depends(require_caregiver),
    db: Session = Depends(get_session),
    settings: Settings = Depends(get_settings),
    now: datetime = Depends(get_now),
):
    med = _medicine(db, member, medicine_id)
    existing = db.get(MedicineDose, body.id)
    if existing is not None:
        if existing.family_id != member.family_id:
            raise HTTPException(409, "id already used")
        return _existing_response(db, existing, response)

    given_at = body.given_at or now
    reject_future(given_at)
    has_amount = med.dose_amount is not None
    amount = body.amount if body.status == "given" else None
    if body.status == "given" and has_amount and amount is not None and amount > med.dose_amount:
        raise HTTPException(422, "amount is more than the dose")

    # Serialise dose writes per medicine: the over-dose check below reads the slot's total, and two phones tapping at
    # the same moment must not both pass it. The lock is released when this request commits or rolls back.
    db.execute(select(Medicine.id).where(Medicine.id == med.id).with_for_update())

    gap_warning = None
    if med.schedule_kind == "as_needed":
        if body.scheduled_for is not None or body.status != "given":
            raise HTTPException(422, "as-needed doses are only ever given, and have no scheduled time")
        if has_amount and amount is None:
            amount = med.dose_amount  # "give now" without an amount means the whole dose
        if med.min_gap_hours:
            last = db.scalar(
                select(MedicineDose)
                .where(MedicineDose.medicine_id == med.id, MedicineDose.deleted_at.is_(None), MedicineDose.status == "given")
                .order_by(MedicineDose.given_at.desc())
                .limit(1)
            )
            if last and abs(given_at - last.given_at) < timedelta(hours=med.min_gap_hours):
                gap_warning = {"last_given_at": _iso(last.given_at)}  # a warning only, never a refusal
    else:
        if body.scheduled_for is None:
            raise HTTPException(422, "scheduled_for is required for a scheduled medicine")
        if body.status == "given" and has_amount and amount is None:
            raise HTTPException(422, "amount is required")
        doses = recent_doses(db, med.id)
        if not schedule.valid_slot(med, doses, body.scheduled_for, now, settings.app_timezone):
            raise HTTPException(409, "that dose is not due")
        slot = schedule.slot_state(med, doses, body.scheduled_for)
        if slot.status == "skipped":
            return _refused("that dose was skipped", slot.remaining)
        if slot.status == "given":
            return _refused("that dose was already given in full", slot.remaining or Decimal("0"))
        if body.status == "given" and has_amount and slot.given_amount + amount > med.dose_amount:
            return _refused(f"only {format(slot.remaining.normalize(), 'f')} left to give", slot.remaining)

    me = member.user.id
    dose = MedicineDose(
        id=body.id, family_id=member.family_id, kid_id=member.kid_id, medicine_id=med.id, status=body.status,
        scheduled_for=body.scheduled_for, given_at=given_at, amount=amount, by_user_id=me, note=body.note,
        created_by=me, updated_by=me,
    )
    db.add(dose)
    try:
        db.commit()
    except IntegrityError:  # a concurrent request stored this very id
        db.rollback()
        winner = db.get(MedicineDose, body.id)
        if winner is None:
            raise
        return _existing_response(db, winner, response)
    result = {**dose_json(dose, user_names(db, {me})), "gap_warning": gap_warning}
    if body.scheduled_for is not None:
        state = schedule.slot_state(med, recent_doses(db, med.id), body.scheduled_for)
        result["slot"] = {"status": state.status, "given_amount": _num(state.given_amount), "remaining": _num(state.remaining)}
    return result


@router.delete("/medicines/{medicine_id}/doses/{dose_id}")
def undo_dose(
    medicine_id: uuid.UUID, dose_id: uuid.UUID, member: Member = Depends(require_caregiver), db: Session = Depends(get_session)
) -> dict[str, bool]:
    med = _medicine(db, member, medicine_id)
    dose = db.get(MedicineDose, dose_id)
    if dose is None or dose.medicine_id != med.id or dose.deleted_at is not None:
        raise HTTPException(404, "dose not found")
    dose.deleted_at = datetime.now(UTC)
    dose.updated_by = member.user.id
    db.commit()
    return {"ok": True}


@router.get("/medicines/{medicine_id}/doses")
def dose_history(
    medicine_id: uuid.UUID,
    from_: AwareDatetime | None = Query(default=None, alias="from"),
    to: AwareDatetime | None = None,
    member: Member = Depends(current_member),
    db: Session = Depends(get_session),
) -> list[dict]:
    med = _medicine(db, member, medicine_id)
    q = select(MedicineDose).where(MedicineDose.medicine_id == med.id, MedicineDose.deleted_at.is_(None))
    if from_:
        q = q.where(MedicineDose.given_at >= from_)
    if to:
        q = q.where(MedicineDose.given_at <= to)
    rows = db.scalars(q.order_by(MedicineDose.given_at.desc())).all()
    names = user_names(db, {d.by_user_id for d in rows})
    return [dose_json(d, names) for d in rows]
