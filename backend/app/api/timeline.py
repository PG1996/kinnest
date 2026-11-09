from datetime import UTC, datetime, time, timedelta
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import AwareDatetime
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.diapers import diaper_json
from app.api.feeds import feed_json
from app.api.medicines import dose_json
from app.api.sleep import sleep_json
from app.api.vaccines import vaccination_json
from app.api.visits import visit_json
from app.api.vitals import vital_json
from app.auth.deps import Member, current_member
from app.config import Settings, get_settings
from app.db import get_session
from app.models import Diaper, DoctorVisit, Feed, Medicine, MedicineDose, SleepSession, Vaccination, VitalEntry
from app.services.entries import user_names

router = APIRouter(prefix="/api")

KINDS = ("feed", "diaper", "sleep", "dose", "vital", "vaccine", "visit")
MAX_RANGE = timedelta(days=31)
GIVEN_VACCINE_HOUR = 9  # a vaccine has only a date; the timeline places it at 09:00 family time


@router.get("/timeline")
def timeline(
    from_: AwareDatetime = Query(alias="from"),
    to: AwareDatetime = Query(),
    kinds: str | None = None,
    member: Member = Depends(current_member),
    db: Session = Depends(get_session),
    settings: Settings = Depends(get_settings),
) -> dict:
    """Every logged entry between `from` and `to`, newest first. Read-only; viewers may call it."""
    if to < from_:
        raise HTTPException(422, "'to' must not be before 'from'")
    if to - from_ > MAX_RANGE:
        raise HTTPException(422, "the range can be at most 31 days")
    wanted = set(KINDS)
    if kinds is not None:
        wanted = {k.strip() for k in kinds.split(",") if k.strip()}
        unknown = wanted - set(KINDS)
        if unknown:
            raise HTTPException(422, f"unknown kinds: {', '.join(sorted(unknown))}")
    kid = member.kid_id
    tz = ZoneInfo(settings.app_timezone)
    items: list[dict] = []

    def add(kind: str, row_id, at: datetime, data: dict) -> None:
        items.append({"kind": kind, "id": str(row_id), "at": at.astimezone(UTC).isoformat(), "data": data})

    if "feed" in wanted:
        rows = db.scalars(select(Feed).where(Feed.kid_id == kid, Feed.deleted_at.is_(None), Feed.started_at >= from_, Feed.started_at <= to)).all()
        names = user_names(db, {r.fed_by_user_id for r in rows})
        for r in rows:
            add("feed", r.id, r.started_at, feed_json(r, names))
    if "diaper" in wanted:
        rows = db.scalars(select(Diaper).where(Diaper.kid_id == kid, Diaper.deleted_at.is_(None), Diaper.at >= from_, Diaper.at <= to)).all()
        names = user_names(db, {r.changed_by_user_id for r in rows})
        for r in rows:
            add("diaper", r.id, r.at, diaper_json(r, names))
    if "sleep" in wanted:
        rows = db.scalars(
            select(SleepSession).where(SleepSession.kid_id == kid, SleepSession.deleted_at.is_(None), SleepSession.started_at >= from_, SleepSession.started_at <= to)
        ).all()
        names = user_names(db, {r.started_by_user_id for r in rows} | {r.ended_by_user_id for r in rows if r.ended_by_user_id})
        for r in rows:
            add("sleep", r.id, r.started_at, sleep_json(r, names))
    if "dose" in wanted:
        pairs = db.execute(
            select(MedicineDose, Medicine)
            .join(Medicine, Medicine.id == MedicineDose.medicine_id)
            .where(MedicineDose.kid_id == kid, MedicineDose.deleted_at.is_(None), MedicineDose.given_at >= from_, MedicineDose.given_at <= to)
        ).all()
        names = user_names(db, {d.by_user_id for d, _ in pairs})
        for d, m in pairs:
            add("dose", d.id, d.given_at, {**dose_json(d, names), "medicine_name": m.name, "dose_unit": m.dose_unit})
    if "vital" in wanted:
        rows = db.scalars(
            select(VitalEntry).where(VitalEntry.kid_id == kid, VitalEntry.deleted_at.is_(None), VitalEntry.measured_at >= from_, VitalEntry.measured_at <= to)
        ).all()
        names = user_names(db, {r.created_by for r in rows})
        for r in rows:
            add("vital", r.id, r.measured_at, vital_json(r, names))
    if "vaccine" in wanted:
        lo, hi = from_.astimezone(tz).date() - timedelta(days=1), to.astimezone(tz).date() + timedelta(days=1)
        rows = db.scalars(
            select(Vaccination).where(
                Vaccination.kid_id == kid, Vaccination.deleted_at.is_(None), Vaccination.status == "given",
                Vaccination.given_on >= lo, Vaccination.given_on <= hi,
            )
        ).all()
        for r in rows:
            at = datetime.combine(r.given_on, time(GIVEN_VACCINE_HOUR), tzinfo=tz)
            if from_ <= at <= to:
                add("vaccine", r.id, at, vaccination_json(r, r.given_on))
    if "visit" in wanted:
        rows = db.scalars(
            select(DoctorVisit).where(
                DoctorVisit.kid_id == kid, DoctorVisit.deleted_at.is_(None), DoctorVisit.status.in_(("done", "upcoming")),
                DoctorVisit.scheduled_at >= from_, DoctorVisit.scheduled_at <= to,
            )
        ).all()
        for r in rows:
            add("visit", r.id, r.scheduled_at, visit_json(r))

    items.sort(key=lambda i: datetime.fromisoformat(i["at"]), reverse=True)
    return {"items": items}
