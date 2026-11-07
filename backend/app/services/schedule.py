"""Medicine schedule engine: which dose slots exist and which are resolved. Pure functions, no database access.

A *slot* is a due time. For `fixed` medicines it is a clock time in the family timezone; for `interval` medicines it is
the next due time after the last resolved dose; `as_needed` medicines have none. A slot is *resolved* when a live
(not soft-deleted) dose row has that exact `scheduled_for`.
"""

from dataclasses import dataclass
from datetime import UTC, date, datetime, time, timedelta
from typing import Literal
from zoneinfo import ZoneInfo

from app.models import Medicine, MedicineDose

# Reminders never start a chain for a slot older than this, so a long gap cannot cause a notification storm.
LOOKBACK = timedelta(hours=36)


@dataclass
class SlotState:
    due_at: datetime
    status: Literal["pending", "given", "skipped"]
    dose: MedicineDose | None


def _local_date(ts: datetime, tz: str) -> date:
    return ts.astimezone(ZoneInfo(tz)).date()


def _live(doses: list[MedicineDose]) -> list[MedicineDose]:
    return [d for d in doses if d.deleted_at is None]


def _in_course(m: Medicine, day: date) -> bool:
    return m.start_date <= day and (m.end_date is None or day <= m.end_date)


def _fixed_slots_on(m: Medicine, day: date, tz: str) -> list[datetime]:
    zone = ZoneInfo(tz)
    out = []
    for text in sorted(set(m.times or [])):
        hh, mm = (int(x) for x in text.split(":"))
        out.append(datetime.combine(day, time(hh, mm), tzinfo=zone).astimezone(UTC))
    return out


def is_active(m: Medicine, now: datetime, tz: str) -> bool:
    return m.deleted_at is None and _in_course(m, _local_date(now, tz))


def next_interval_due(m: Medicine, doses: list[MedicineDose]) -> datetime | None:
    """First dose time, then last given time (or scheduled time when skipped) plus the interval."""
    resolved = [d for d in _live(doses) if d.scheduled_for is not None]
    if not resolved:
        return m.first_dose_at
    last = max(resolved, key=lambda d: d.scheduled_for)
    base = last.given_at if last.status == "given" else last.scheduled_for
    return base + timedelta(hours=m.interval_hours)


def _interval_slot(m: Medicine, doses: list[MedicineDose], now: datetime, tz: str) -> datetime | None:
    if not is_active(m, now, tz):
        return None
    due = next_interval_due(m, doses)
    if due is None or not _in_course(m, _local_date(due, tz)):
        return None
    return due


def today_slots(m: Medicine, doses: list[MedicineDose], now: datetime, tz: str) -> list[SlotState]:
    if not is_active(m, now, tz):
        return []
    if m.schedule_kind == "fixed":
        by_slot = {d.scheduled_for: d for d in _live(doses) if d.scheduled_for is not None}
        out = []
        for due in _fixed_slots_on(m, _local_date(now, tz), tz):
            dose = by_slot.get(due)
            out.append(SlotState(due, dose.status if dose else "pending", dose))
        return out
    if m.schedule_kind == "interval":
        due = _interval_slot(m, doses, now, tz)
        return [SlotState(due, "pending", None)] if due else []
    return []


def unresolved_due_slots(m: Medicine, doses: list[MedicineDose], now: datetime, tz: str) -> list[datetime]:
    """Slots that are already due, still unresolved, and recent enough to remind about. Used by the reminder worker."""
    if m.schedule_kind == "as_needed" or not is_active(m, now, tz):
        return []
    if m.schedule_kind == "interval":
        due = _interval_slot(m, doses, now, tz)
        return [due] if due and now - LOOKBACK <= due <= now else []
    resolved = {d.scheduled_for for d in _live(doses) if d.scheduled_for is not None}
    today = _local_date(now, tz)
    found = []
    for back in (2, 1, 0):  # 36 hours can reach back into the day before yesterday
        day = today - timedelta(days=back)
        if _in_course(m, day):
            found += [s for s in _fixed_slots_on(m, day, tz) if now - LOOKBACK <= s <= now and s not in resolved]
    return sorted(found)


def valid_slot(m: Medicine, doses: list[MedicineDose], scheduled_for: datetime, now: datetime, tz: str) -> bool:
    """Is this a slot a dose may be recorded against (today's slots, or a recent missed one)?"""
    if m.schedule_kind == "as_needed":
        return False
    known = {s.due_at for s in today_slots(m, doses, now, tz)} | set(unresolved_due_slots(m, doses, now, tz))
    return scheduled_for in known
