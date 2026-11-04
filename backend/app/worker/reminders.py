import logging
from collections.abc import Callable
from dataclasses import dataclass
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.models import Diaper, Feed, Kid, Membership, NotificationPref, PushSubscription, ReminderState, User

log = logging.getLogger(__name__)

# Escalation: due, +15 min, +30 min after the feed was due. The last level goes to admins only, high urgency.
OFFSETS = (timedelta(0), timedelta(minutes=15), timedelta(minutes=30))
TITLE_KEYS = ("feed_due", "feed_due_again", "feed_overdue_admin")
KEEP_STATE = timedelta(days=7)

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
            status = sender(sub, key, params, urgency, url)
            if status == "ok":
                ok += 1
                sent.append(Sent(user.id, kind, level, key, urgency))
            elif status == "gone":
                db.delete(sub)  # the browser dropped it; stop trying
            else:
                errors += 1
    return not (ok == 0 and errors > 0)


def _state(db: Session, kid: Kid, kind: str, anchor: datetime) -> ReminderState | None:
    return db.scalar(
        select(ReminderState).where(
            ReminderState.kid_id == kid.id, ReminderState.kind == kind, ReminderState.anchor_at == anchor
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


def tick(db: Session, now: datetime, sender: Sender, tz: str = "Asia/Kolkata") -> list[Sent]:
    """One pass of the reminder worker. All state lives in the database, so a restart never resends or loses one."""
    sent: list[Sent] = []
    for kid in db.scalars(select(Kid)).all():
        _feed_chain(db, kid, now, sender, tz, sent)
        _diaper_alert(db, kid, now, sender, tz, sent)
    db.execute(delete(ReminderState).where(ReminderState.anchor_at < now - KEEP_STATE))
    db.commit()
    return sent
