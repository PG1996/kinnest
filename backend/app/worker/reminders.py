import logging
from collections.abc import Callable
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta
from zoneinfo import ZoneInfo

from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from app.models import (
    Diaper,
    DoctorVisit,
    Feed,
    Kid,
    Medicine,
    MedicineNudge,
    Membership,
    NotificationPref,
    PushSubscription,
    ReminderState,
    User,
    Vaccination,
)
from app.services import schedule
from app.services.entries import recent_doses
from app.units import format_dose

log = logging.getLogger(__name__)

# Escalation: due, +15 min, +30 min after the feed was due. The last level goes to admins only, high urgency.
OFFSETS = (timedelta(0), timedelta(minutes=15), timedelta(minutes=30))
TITLE_KEYS = ("feed_due", "feed_due_again", "feed_overdue_admin")
MED_TITLE_KEYS = ("med_due", "med_due_again", "med_overdue_admin")
KEEP_STATE = timedelta(days=7)
# A medicine chain may only start this soon after its slot. A slot found much later (the worker or the Mac was off)
# is not reminded about: it stays open and overdue in the app, but a burst of old reminders helps nobody.
START_WINDOW = OFFSETS[-1] + timedelta(minutes=15)

# sender(subscription, title_key, body_params, urgency, url) -> "ok" | "gone" | "error"
Sender = Callable[..., str]


@dataclass
class Sent:
    user_id: object
    kind: str
    level: int
    title_key: str
    urgency: str


def _clock(ts: datetime, tz: str) -> str:
    return ts.astimezone(ZoneInfo(tz)).strftime("%-I:%M %p")


def _recipients(db: Session, kid: Kid, kind: str, admins_only: bool) -> list[tuple[User, list[PushSubscription]]]:
    roles = ("admin",) if admins_only else ("admin", "caregiver")
    users = db.scalars(
        select(User).join(Membership, Membership.user_id == User.id).where(
            Membership.family_id == kid.family_id, Membership.role.in_(roles)
        )
    ).all()
    out = []
    for u in users:
        pref = db.get(NotificationPref, (u.id, kind))
        if pref is not None and not pref.enabled:
            continue
        subs = db.scalars(select(PushSubscription).where(PushSubscription.user_id == u.id)).all()
        out.append((u, list(subs)))
    return out


def _deliver(db, sender, recipients, key, params, urgency, url, kind, level, sent) -> bool:
    """Send to every subscription. False only when every attempt failed with a retryable error."""
    ok = errors = 0
    for user, subs in recipients:
        for sub in subs:
            try:
                status = sender(sub, key, params, urgency, url)
            except Exception:
                log.exception("sender crashed for subscription %s", sub.id)
                status = "error"
            if status == "ok":
                ok += 1
                sent.append(Sent(user.id, kind, level, key, urgency))
            elif status == "gone":
                db.delete(sub)  # the browser dropped it; stop trying
            else:
                errors += 1
    return not (ok == 0 and errors > 0)


def _subject_clause(subject_id):
    return ReminderState.subject_id.is_(None) if subject_id is None else ReminderState.subject_id == subject_id


def _state(db: Session, kid: Kid, kind: str, anchor: datetime, subject_id=None) -> ReminderState | None:
    return db.scalar(
        select(ReminderState).where(
            ReminderState.kid_id == kid.id,
            ReminderState.kind == kind,
            _subject_clause(subject_id),
            ReminderState.anchor_at == anchor,
        )
    )


def _feed_chain(db: Session, kid: Kid, now: datetime, sender: Sender, tz: str, sent: list[Sent]) -> None:
    last = db.scalar(
        select(Feed).where(Feed.kid_id == kid.id, Feed.deleted_at.is_(None)).order_by(Feed.started_at.desc()).limit(1)
    )
    if last is None:
        return
    due = last.started_at + timedelta(minutes=kid.feed_interval_minutes)
    state = _state(db, kid, "feed", due)
    level = 0 if state is None else state.level + 1  # lowest level not yet sent
    if level >= len(OFFSETS) or now < due + OFFSETS[level]:
        return
    feeder = db.get(User, last.fed_by_user_id)
    params = {
        "kid": kid.name,
        "name": feeder.name if feeder else "",
        "time": _clock(last.started_at, tz),
        "due": _clock(due, tz),
        "mins": int((now - due).total_seconds() // 60),
    }
    urgency = "high" if level == 2 else "normal"
    recipients = _recipients(db, kid, "feed", admins_only=level == 2)
    if not _deliver(db, sender, recipients, TITLE_KEYS[level], params, urgency, "/?log=feed", "feed", level, sent):
        return  # try the same level again next tick
    if state is None:
        db.add(ReminderState(kid_id=kid.id, kind="feed", anchor_at=due, level=level, last_sent_at=now))
    else:
        state.level, state.last_sent_at = level, now


def _diaper_alert(db: Session, kid: Kid, now: datetime, sender: Sender, tz: str, sent: list[Sent]) -> None:
    last = db.scalar(
        select(Diaper).where(Diaper.kid_id == kid.id, Diaper.deleted_at.is_(None)).order_by(Diaper.at.desc()).limit(1)
    )
    if last is None:
        return
    anchor = last.at + timedelta(minutes=kid.diaper_alert_minutes)
    if now < anchor or _state(db, kid, "diaper", anchor) is not None:
        return
    params = {"kid": kid.name, "time": _clock(last.at, tz)}
    recipients = _recipients(db, kid, "diaper", admins_only=False)
    if _deliver(db, sender, recipients, "diaper_alert", params, "normal", "/?log=diaper", "diaper", 0, sent):
        db.add(ReminderState(kid_id=kid.id, kind="diaper", anchor_at=anchor, level=0, last_sent_at=now))


def _dose_text(med: Medicine) -> str:
    return format_dose(med.dose_amount, med.dose_unit) if med.dose_amount is not None else "Dose"


def _medicine_chain(db: Session, kid: Kid, med: Medicine, anchor: datetime, now: datetime, sender: Sender, tz: str, sent: list[Sent]) -> None:
    if anchor < med.created_at:
        return  # the slot was before the medicine was added
    state = _state(db, kid, "medicine", anchor, med.id)
    if state is None and now > anchor + START_WINDOW:
        return
    level = 0 if state is None else state.level + 1  # lowest level not yet sent
    if level >= len(OFFSETS) or now < anchor + OFFSETS[level]:
        return
    slot = schedule.slot_state(med, recent_doses(db, med.id), anchor)
    params = {
        "kid": kid.name,
        "medicine": med.name,
        "dose": _dose_text(med),
        "time": _clock(anchor, tz),
        "mins": int((now - anchor).total_seconds() // 60),
        # a half-given dose keeps reminding, and says how much is left
        "progress": f" {format_dose(slot.remaining, med.dose_unit)} left." if slot.status == "partial" else "",
    }
    urgency = "high" if level == 2 else "normal"
    recipients = _recipients(db, kid, "medicine", admins_only=level == 2)
    if not _deliver(db, sender, recipients, MED_TITLE_KEYS[level], params, urgency, "/?log=medicine", "medicine", level, sent):
        return  # try the same level again next tick
    if state is None:
        db.add(ReminderState(kid_id=kid.id, kind="medicine", subject_id=med.id, anchor_at=anchor, level=level, last_sent_at=now))
    else:
        state.level, state.last_sent_at = level, now


def _medicine_chains(db: Session, kid: Kid, now: datetime, sender: Sender, tz: str, sent: list[Sent]) -> None:
    meds = db.scalars(
        select(Medicine).where(
            Medicine.kid_id == kid.id, Medicine.deleted_at.is_(None), Medicine.schedule_kind != "as_needed"
        )
    ).all()
    for med in meds:
        for anchor in schedule.unresolved_due_slots(med, recent_doses(db, med.id), now, tz):
            _medicine_chain(db, kid, med, anchor, now, sender, tz, sent)
            db.commit()  # right after the sends, as for feeds


NUDGE_STALE = timedelta(minutes=30)  # a reminder found later than this (the Mac was off) is dropped, not sent late


def _fire_nudges(db: Session, kid: Kid, now: datetime, sender: Sender, tz: str, sent: list[Sent]) -> None:
    """Send the one-off "rest of the dose" reminders that are due, if their dose is still partly given."""
    due = db.scalars(
        select(MedicineNudge)
        .where(
            MedicineNudge.kid_id == kid.id,
            MedicineNudge.fired_at.is_(None),
            MedicineNudge.cancelled_at.is_(None),
            MedicineNudge.remind_at <= now,
        )
        .order_by(MedicineNudge.remind_at)
    ).all()
    for n in due:
        med = db.get(Medicine, n.medicine_id)
        slot = (
            schedule.slot_state(med, recent_doses(db, med.id), n.scheduled_for)
            if med is not None and schedule.is_active(med, now, tz)
            else None
        )
        if slot is None or slot.status != "partial":
            n.cancelled_at = now  # finished, skipped, undone, or the medicine is gone: nothing left to remind about
        elif now - n.remind_at > NUDGE_STALE:
            n.fired_at = now
        else:
            params = {
                "kid": kid.name,
                "medicine": med.name,
                "dose": _dose_text(med),
                "left": format_dose(slot.remaining, med.dose_unit),
                "time": _clock(n.scheduled_for, tz),
            }
            recipients = _recipients(db, kid, "medicine", admins_only=False)
            if _deliver(db, sender, recipients, "med_nudge", params, "normal", "/?log=medicine", "medicine", 0, sent):
                n.fired_at = now
        db.commit()


# Vaccine and visit reminders: a moment is sent only within this long after it, so a Mac that slept sends nothing stale.
MOMENT_LATE = timedelta(hours=3)
EVENING = time(18, 0)
MORNING = time(8, 0)
VISIT_SOON = timedelta(hours=1)
VISIT_MIN_GAP = timedelta(hours=2)


def _local(d: date, t: time, tz: str) -> datetime:
    return datetime.combine(d, t, tzinfo=ZoneInfo(tz))


def _moment_open(moment: datetime, now: datetime) -> bool:
    return moment <= now <= moment + MOMENT_LATE


def _vaccine_label(v: Vaccination) -> str:
    return f"{v.name} {v.dose_label}".strip()


def _vaccine_reminders(db: Session, kid: Kid, now: datetime, sender: Sender, tz: str, sent: list[Sent]) -> None:
    """Evening before (18:00) and morning of (08:00) the due date, one message per moment listing that day's vaccines."""
    today = now.astimezone(ZoneInfo(tz)).date()
    pending = db.scalars(
        select(Vaccination)
        .where(
            Vaccination.kid_id == kid.id,
            Vaccination.deleted_at.is_(None),
            Vaccination.status == "pending",
            Vaccination.due_date.between(today, today + timedelta(days=1)),
        )
        .order_by(Vaccination.due_date, Vaccination.created_at)
    ).all()
    by_moment: dict[tuple[datetime, str], list[Vaccination]] = {}
    for v in pending:
        for moment, key in (
            (_local(v.due_date - timedelta(days=1), EVENING, tz), "vaccine_eve"),
            (_local(v.due_date, MORNING, tz), "vaccine_today"),
        ):
            if _moment_open(moment, now) and v.created_at < moment and _state(db, kid, "vaccine", moment, v.id) is None:
                by_moment.setdefault((moment, key), []).append(v)
    for (moment, key), items in by_moment.items():
        params = {"kid": kid.name, "vaccines": ", ".join(_vaccine_label(v) for v in items), "count": len(items)}
        recipients = _recipients(db, kid, "vaccine", admins_only=False)
        if _deliver(db, sender, recipients, key, params, "normal", "/?log=vaccine", "vaccine", 0, sent):
            for v in items:
                db.add(ReminderState(kid_id=kid.id, kind="vaccine", subject_id=v.id, anchor_at=moment, level=0, last_sent_at=now))
        db.commit()


def _visit_reminders(db: Session, kid: Kid, now: datetime, sender: Sender, tz: str, sent: list[Sent]) -> None:
    """The evening before (18:00) and one hour before an upcoming visit."""
    visits = db.scalars(
        select(DoctorVisit).where(
            DoctorVisit.kid_id == kid.id,
            DoctorVisit.deleted_at.is_(None),
            DoctorVisit.status == "upcoming",
            DoctorVisit.scheduled_at > now,
            DoctorVisit.scheduled_at <= now + timedelta(days=2),
        )
    ).all()
    for v in visits:
        local = v.scheduled_at.astimezone(ZoneInfo(tz))
        eve = _local(local.date() - timedelta(days=1), EVENING, tz)
        soon = v.scheduled_at - VISIT_SOON
        moments = [(eve, "visit_eve")]
        if soon >= eve + VISIT_MIN_GAP:
            moments.append((soon, "visit_soon"))
        for moment, key in moments:
            if not _moment_open(moment, now) or v.created_at >= moment or _state(db, kid, "visit", moment, v.id):
                continue
            params = {
                "kid": kid.name,
                "time": _clock(v.scheduled_at, tz),
                "what": " · ".join(x for x in (v.doctor, v.place, v.reason) if x),
            }
            recipients = _recipients(db, kid, "visit", admins_only=False)
            if _deliver(db, sender, recipients, key, params, "normal", "/?log=visit", "visit", 0, sent):
                db.add(ReminderState(kid_id=kid.id, kind="visit", subject_id=v.id, anchor_at=moment, level=0, last_sent_at=now))
            db.commit()


def _purge_old_state(db: Session, now: datetime) -> None:
    """Drop old chains, but never the newest one of each (kid, kind, subject): deleting it would restart a stale chain."""
    groups = db.execute(select(ReminderState.kid_id, ReminderState.kind, ReminderState.subject_id).distinct()).all()
    for kid_id, kind, subject_id in groups:
        same = (ReminderState.kid_id == kid_id, ReminderState.kind == kind, _subject_clause(subject_id))
        newest = db.scalar(select(func.max(ReminderState.anchor_at)).where(*same))
        db.execute(delete(ReminderState).where(*same, ReminderState.anchor_at < now - KEEP_STATE, ReminderState.anchor_at != newest))


def tick(db: Session, now: datetime, sender: Sender, tz: str = "Asia/Kolkata") -> list[Sent]:
    """One pass of the reminder worker. All state lives in the database, so a restart never resends or loses one.

    State is committed right after each chain's sends, so a crash or restart later in the pass cannot
    make the notifications that already went out be sent again.
    """
    sent: list[Sent] = []
    for kid in db.scalars(select(Kid)).all():
        _feed_chain(db, kid, now, sender, tz, sent)
        db.commit()
        _diaper_alert(db, kid, now, sender, tz, sent)
        db.commit()
        _medicine_chains(db, kid, now, sender, tz, sent)
        _fire_nudges(db, kid, now, sender, tz, sent)
        _vaccine_reminders(db, kid, now, sender, tz, sent)
        _visit_reminders(db, kid, now, sender, tz, sent)
    _purge_old_state(db, now)
    db.commit()
    return sent
