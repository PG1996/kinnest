import uuid
from datetime import UTC, datetime
from decimal import ROUND_HALF_UP, Decimal
from typing import Literal
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from fastapi.responses import JSONResponse
from pydantic import AwareDatetime, BaseModel, Field, ValidationError
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.auth.deps import Member, current_member, require_caregiver
from app.clock import get_now
from app.config import Settings, get_settings
from app.db import get_session
from app.models import Kid, VitalEntry
from app.services.entries import MAX_FUTURE, user_names

router = APIRouter(prefix="/api")

PlaceKind = Literal["home", "hospital", "clinic", "other"]
MAX_BULK = 200

# key, label, low, high, unit text, decimals (None: whole numbers)
MEASUREMENTS = (
    ("weight_kg", "weight", Decimal("0.3"), Decimal("60"), "kg", 2),
    ("height_cm", "height", Decimal("20"), Decimal("150"), "cm", 1),
    ("head_cm", "head circumference", Decimal("20"), Decimal("60"), "cm", 1),
    ("temperature_c", "temperature", Decimal("30"), Decimal("45"), "degrees Celsius", 1),
    ("heart_rate", "heart rate", Decimal("30"), Decimal("300"), "beats per minute", None),
    ("resp_rate", "breathing rate", Decimal("5"), Decimal("120"), "breaths per minute", None),
    ("spo2", "SpO2", Decimal("50"), Decimal("100"), "percent", None),
)
KEYS = tuple(m[0] for m in MEASUREMENTS)
DECIMAL_KEYS = tuple(m[0] for m in MEASUREMENTS if m[5] is not None)


class VitalFields(BaseModel):
    place_name: str = Field(default="", max_length=120)
    measured_by: str = Field(default="", max_length=120)
    note: str = Field(default="", max_length=2000)
    weight_kg: Decimal | None = None
    height_cm: Decimal | None = None
    head_cm: Decimal | None = None
    temperature_c: Decimal | None = None
    heart_rate: int | None = None
    resp_rate: int | None = None
    spo2: int | None = None


class VitalIn(VitalFields):
    id: uuid.UUID
    measured_at: AwareDatetime
    place_kind: PlaceKind = "home"


class VitalPatch(BaseModel):
    measured_at: AwareDatetime | None = None
    place_kind: PlaceKind | None = None
    place_name: str | None = Field(default=None, max_length=120)
    measured_by: str | None = Field(default=None, max_length=120)
    note: str | None = Field(default=None, max_length=2000)
    weight_kg: Decimal | None = None
    height_cm: Decimal | None = None
    head_cm: Decimal | None = None
    temperature_c: Decimal | None = None
    heart_rate: int | None = None
    resp_rate: int | None = None
    spo2: int | None = None


class BulkIn(BaseModel):
    entries: list[dict]


def _fmt(d: Decimal) -> str:
    return format(d.normalize(), "f")


def check_values(data: dict, birth_date, now: datetime, tz: str) -> str | None:
    """The first problem with a complete entry (measurements, time), as a message a parent can act on."""
    if all(data.get(k) is None for k in KEYS):
        return "add at least one measurement"
    for key, label, lo, hi, unit, _ in MEASUREMENTS:
        v = data.get(key)
        if v is None:
            continue
        if not lo <= Decimal(v) <= hi:
            msg = f"{label} must be {_fmt(lo)} to {_fmt(hi)} {unit}"
            if key == "temperature_c" and Decimal("86") <= Decimal(v) <= Decimal("113"):
                celsius = ((Decimal(v) - 32) * 5 / 9).quantize(Decimal("0.1"), ROUND_HALF_UP)
                msg += f"; {_fmt(Decimal(v))} looks like Fahrenheit (about {celsius} degrees Celsius)"
            return msg
    at = data["measured_at"]
    if at > now + MAX_FUTURE:
        return "measured_at is in the future"
    if birth_date and at.astimezone(ZoneInfo(tz)).date() < birth_date:
        return "a reading cannot be before the birth date"
    return None


def _rounded(data: dict) -> dict:
    """Store at the column's precision (3.255 kg is kept as 3.26)."""
    out = dict(data)
    for key, *_rest, decimals in MEASUREMENTS:
        if decimals is not None and out.get(key) is not None:
            out[key] = Decimal(out[key]).quantize(Decimal(1).scaleb(-decimals), ROUND_HALF_UP)
    return out


def _num(v):
    return None if v is None else (float(v) if isinstance(v, Decimal) else v)


def vital_json(v: VitalEntry, names: dict[uuid.UUID, str]) -> dict:
    return {
        "id": str(v.id),
        "measured_at": v.measured_at.isoformat(),
        "place_kind": v.place_kind,
        "place_name": v.place_name,
        "measured_by": v.measured_by,
        "note": v.note,
        **{k: _num(getattr(v, k)) for k in KEYS},
        "entered_by_name": names.get(v.created_by, ""),
    }


def _one(db: Session, member: Member, vital_id: uuid.UUID) -> VitalEntry:
    v = db.get(VitalEntry, vital_id)
    if v is None or v.family_id != member.family_id or v.deleted_at is not None:
        raise HTTPException(404, "vital entry not found")
    return v


def _new_row(member: Member, data: dict) -> VitalEntry:
    me = member.user.id
    return VitalEntry(family_id=member.family_id, kid_id=member.kid_id, created_by=me, updated_by=me, **_rounded(data))


@router.post("/vitals", status_code=201)
def create_vital(
    body: VitalIn,
    response: Response,
    member: Member = Depends(require_caregiver),
    db: Session = Depends(get_session),
    now: datetime = Depends(get_now),
    settings: Settings = Depends(get_settings),
) -> dict:
    def existing_or_409() -> dict:
        existing = db.get(VitalEntry, body.id)
        if existing is None or existing.family_id != member.family_id:
            raise HTTPException(409, "id already used")
        response.status_code = 200
        return vital_json(existing, user_names(db, {existing.created_by}))

    if db.get(VitalEntry, body.id) is not None:
        return existing_or_409()
    data = body.model_dump()
    problem = check_values(data, db.get(Kid, member.kid_id).birth_date, now, settings.app_timezone)
    if problem:
        raise HTTPException(422, problem)
    row = _new_row(member, data)
    db.add(row)
    try:
        db.commit()
    except IntegrityError:  # another request stored this id between our lookup and insert
        db.rollback()
        return existing_or_409()
    return vital_json(row, user_names(db, {row.created_by}))


def _row_error(e: ValidationError) -> str:
    first = e.errors(include_url=False)[0]
    field = ".".join(str(p) for p in first["loc"])
    return f"{field}: {first['msg']}" if field else first["msg"]


@router.post("/vitals/bulk", status_code=201)
def bulk_vitals(
    body: BulkIn,
    member: Member = Depends(require_caregiver),
    db: Session = Depends(get_session),
    now: datetime = Depends(get_now),
    settings: Settings = Depends(get_settings),
):
    if not body.entries:
        raise HTTPException(422, "add at least one row")
    if len(body.entries) > MAX_BULK:
        raise HTTPException(422, f"at most {MAX_BULK} rows at a time")
    birth = db.get(Kid, member.kid_id).birth_date
    errors: list[dict] = []
    parsed: list[VitalIn] = []
    for i, raw in enumerate(body.entries):
        try:
            parsed.append(VitalIn.model_validate(raw))
        except ValidationError as e:
            errors.append({"index": i, "detail": _row_error(e)})
            parsed.append(None)  # type: ignore[arg-type]
    ids = [p.id for p in parsed if p is not None]
    stored = {v.id: v for v in db.scalars(select(VitalEntry).where(VitalEntry.id.in_(ids)))} if ids else {}
    seen: set[uuid.UUID] = set()
    for i, p in enumerate(parsed):
        if p is None:
            continue
        if p.id in seen:
            errors.append({"index": i, "detail": "the same row appears twice"})
            continue
        seen.add(p.id)
        if p.id in stored:
            if stored[p.id].family_id != member.family_id:
                errors.append({"index": i, "detail": "id already used"})
            continue  # already saved by an earlier submit: returned unchanged
        problem = check_values(p.model_dump(), birth, now, settings.app_timezone)
        if problem:
            errors.append({"index": i, "detail": problem})
    if errors:
        errors.sort(key=lambda e: e["index"])
        return JSONResponse(status_code=422, content={"detail": "some rows are not valid", "errors": errors})
    rows: list[VitalEntry] = []
    created = 0
    for p in parsed:
        if p.id in stored:
            rows.append(stored[p.id])
        else:
            row = _new_row(member, p.model_dump())
            db.add(row)
            rows.append(row)
            created += 1
    try:
        db.commit()
    except IntegrityError:  # a concurrent submit of the same batch won; the client retries and gets "existing"
        db.rollback()
        raise HTTPException(409, "these rows were just saved by another request; try again")
    names = user_names(db, {r.created_by for r in rows})
    return {"created": created, "existing": len(rows) - created, "entries": [vital_json(r, names) for r in rows]}


@router.get("/vitals")
def list_vitals(
    from_: AwareDatetime | None = Query(default=None, alias="from"),
    to: AwareDatetime | None = None,
    place_kind: PlaceKind | None = None,
    limit: int = Query(default=500, ge=1, le=2000),
    member: Member = Depends(current_member),
    db: Session = Depends(get_session),
) -> list[dict]:
    q = select(VitalEntry).where(VitalEntry.kid_id == member.kid_id, VitalEntry.deleted_at.is_(None))
    if from_:
        q = q.where(VitalEntry.measured_at >= from_)
    if to:
        q = q.where(VitalEntry.measured_at <= to)
    if place_kind:
        q = q.where(VitalEntry.place_kind == place_kind)
    rows = db.scalars(q.order_by(VitalEntry.measured_at.desc()).limit(limit)).all()
    names = user_names(db, {r.created_by for r in rows})
    return [vital_json(r, names) for r in rows]


@router.patch("/vitals/{vital_id}")
def patch_vital(
    vital_id: uuid.UUID,
    body: VitalPatch,
    member: Member = Depends(require_caregiver),
    db: Session = Depends(get_session),
    now: datetime = Depends(get_now),
    settings: Settings = Depends(get_settings),
) -> dict:
    row = _one(db, member, vital_id)
    changes = body.model_dump(exclude_unset=True)
    for k in ("measured_at", "place_kind", "place_name", "measured_by", "note"):
        if k in changes and changes[k] is None:
            raise HTTPException(422, f"{k} cannot be empty")
    merged = {k: getattr(row, k) for k in ("measured_at", *KEYS)} | changes
    problem = check_values(merged, db.get(Kid, member.kid_id).birth_date, now, settings.app_timezone)
    if problem:
        raise HTTPException(422, problem)
    for k, v in _rounded(changes).items():
        setattr(row, k, v)
    row.updated_by = member.user.id
    db.commit()
    return vital_json(row, user_names(db, {row.created_by}))


@router.delete("/vitals/{vital_id}")
def delete_vital(
    vital_id: uuid.UUID, member: Member = Depends(require_caregiver), db: Session = Depends(get_session)
) -> dict[str, bool]:
    row = _one(db, member, vital_id)
    row.deleted_at = datetime.now(UTC)
    row.updated_by = member.user.id
    db.commit()
    return {"ok": True}
