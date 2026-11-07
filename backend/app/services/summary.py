from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from zoneinfo import ZoneInfo

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Diaper, Feed, Kid, SleepSession


@dataclass
class Summary:
    last_feed: Feed | None
    next_feed_due_at: datetime | None
    last_diaper: Diaper | None
    feeds_today: int
    diapers_today: dict[str, int] = field(default_factory=dict)
    open_sleep: SleepSession | None = None
    last_sleep: SleepSession | None = None


def build_summary(db: Session, kid: Kid, now: datetime, tz: str = "Asia/Kolkata") -> Summary:
    zone = ZoneInfo(tz)
    midnight = now.astimezone(zone).replace(hour=0, minute=0, second=0, microsecond=0)
    day_start = midnight.astimezone(UTC)
    feeds = db.scalars(
        select(Feed).where(Feed.kid_id == kid.id, Feed.deleted_at.is_(None)).order_by(Feed.started_at.desc())
    ).all()
    diapers = db.scalars(
        select(Diaper).where(Diaper.kid_id == kid.id, Diaper.deleted_at.is_(None)).order_by(Diaper.at.desc())
    ).all()
    open_sleep = db.scalar(
        select(SleepSession).where(
            SleepSession.kid_id == kid.id, SleepSession.ended_at.is_(None), SleepSession.deleted_at.is_(None)
        )
    )
    last_sleep = db.scalar(
        select(SleepSession)
        .where(SleepSession.kid_id == kid.id, SleepSession.ended_at.is_not(None), SleepSession.deleted_at.is_(None))
        .order_by(SleepSession.ended_at.desc())
        .limit(1)
    )
    last_feed = feeds[0] if feeds else None
    counts = {"wet": 0, "dirty": 0, "both": 0}
    for d in diapers:
        if d.at >= day_start:
            counts[d.kind] += 1
    return Summary(
        last_feed=last_feed,
        next_feed_due_at=(
            last_feed.started_at + timedelta(minutes=kid.feed_interval_minutes) if last_feed else None
        ),
        last_diaper=diapers[0] if diapers else None,
        feeds_today=sum(1 for f in feeds if f.started_at >= day_start),
        diapers_today=counts,
        open_sleep=open_sleep,
        last_sleep=last_sleep,
    )
