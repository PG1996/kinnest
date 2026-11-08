import logging
from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from app.models import (
    Diaper,
    Feed,
    Kid,
    Medicine,
    Membership,
    NotificationPref,
    PushSubscription,
    ReminderState,
    User,
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


def _medicine_chain(db: Session, kid: Kid, med: Medicine, anchor: datetime, now: datetime, sender: Sender, tz: str, sent: list[Sent]) -> None:
    if anchor < med.created_at:
        return  # the slot was before the medicine was added
    state = _state(db, kid, "medicine", anchor, med.id)
    if state is None and now > anchor + START_WINDOW:
        return
    level = 0 if state is None else state.level + 1  # lowest level not yet sent
    if level >= len(OFFSETS) or now < anchor + OFFSETS[level]:
        return
    params = {
        "kid": kid.name,
        "medicine": med.name,
        "dose": format_dose(med.dose_amount, med.dose_unit) if med.dose_amount is not None else "",
        "time": _clock(anchor, tz),
        "mins": int((now - anchor).total_seconds() // 60),
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
    _purge_old_state(db, now)
    db.commit()
    return sent
