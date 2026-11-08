"""Medicine schedule engine: which dose slots exist and how far each one is. Pure functions, no database access.

A *slot* is a due time. For `fixed` medicines it is a clock time in the family timezone; for `interval` medicines it is
the next due time after the last finished slot; `as_needed` medicines have none.

A slot can be given in pieces: its progress is the sum of its live (not soft-deleted) given pieces against the
medicine's `dose_amount`. A slot is *resolved* once it is `given` (the pieces add up to the dose) or `skipped`; a
`partial` slot is still open. Medicines saved before structured doses have no `dose_amount`: any given dose completes
their slot.
"""

from dataclasses import dataclass, field
from datetime import UTC, date, datetime, time, timedelta
from decimal import Decimal
from typing import Literal
from zoneinfo import ZoneInfo

from app.models import Medicine, MedicineDose

# Reminders never start a chain for a slot older than this, so a long gap cannot cause a notification storm.
LOOKBACK = timedelta(hours=36)
ZERO = Decimal("0.00")


@dataclass
class SlotState:
    due_at: datetime
    status: Literal["pending", "partial", "given", "skipped"]
    doses: list[MedicineDose] = field(default_factory=list)  # live pieces, oldest first
    given_amount: Decimal = ZERO
    remaining: Decimal | None = None  # None for medicines without a dose amount

    @property
    def dose(self) -> MedicineDose | None:
        """The latest piece (kept for callers that only care about who gave the slot last)."""
        return self.doses[-1] if self.doses else None


def _local_date(ts: datetime, tz: str) -> date:
    return ts.astimezone(ZoneInfo(tz)).date()


def _live(doses: list[MedicineDose]) -> list[MedicineDose]:
    return [d for d in doses if d.deleted_at is None]


def _by_slot(doses: list[MedicineDose]) -> dict[datetime, list[MedicineDose]]:
    out: dict[datetime, list[MedicineDose]] = {}
    for d in _live(doses):
        if d.scheduled_for is not None:
            out.setdefault(d.scheduled_for, []).append(d)
    return out


def slot_progress(m: Medicine, due_at: datetime, slot_doses: list[MedicineDose]) -> SlotState:
    pieces = sorted(_live(slot_doses), key=lambda d: d.given_at)
    given = [d for d in pieces if d.status == "given"]
    legacy = m.dose_amount is None
    # a piece logged before the dose had an amount was a whole dose
    total = sum((d.amount if d.amount is not None else (m.dose_amount or ZERO) for d in given), ZERO)
    if any(d.status == "skipped" for d in pieces):
        status = "skipped"
    elif legacy:
        status = "given" if given else "pending"
    elif total >= m.dose_amount:
        status = "given"
    else:
        status = "partial" if total > 0 else "pending"
    remaining = None if legacy else max(m.dose_amount - total, ZERO)
    return SlotState(due_at, status, pieces, total if not legacy else ZERO, remaining)


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
    """First dose time, then the finish time of the last resolved slot plus the interval.

    A slot only counts once it is resolved (given in full, or skipped), so a half-given dose does not move the schedule.
    """
    resolved = []
    for due, group in _by_slot(doses).items():
        state = slot_progress(m, due, group)
        if state.status in ("given", "skipped"):
            resolved.append(state)
    if not resolved:
        return m.first_dose_at
    last = max(resolved, key=lambda s: s.due_at)
    base = last.doses[-1].given_at if last.status == "given" else last.due_at
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
    grouped = _by_slot(doses)
    if m.schedule_kind == "fixed":
        return [slot_progress(m, due, grouped.get(due, [])) for due in _fixed_slots_on(m, _local_date(now, tz), tz)]
    if m.schedule_kind == "interval":
        due = _interval_slot(m, doses, now, tz)
        return [slot_progress(m, due, grouped.get(due, []))] if due else []
    return []


def unresolved_due_slots(m: Medicine, doses: list[MedicineDose], now: datetime, tz: str) -> list[datetime]:
    """Slots already due that are still open (nothing given, or only part of the dose), and recent enough to remind about."""
    if m.schedule_kind == "as_needed" or not is_active(m, now, tz):
        return []
    grouped = _by_slot(doses)
    if m.schedule_kind == "interval":
        due = _interval_slot(m, doses, now, tz)
        if due and now - LOOKBACK <= due <= now and slot_progress(m, due, grouped.get(due, [])).status in ("pending", "partial"):
            return [due]
        return []
    today = _local_date(now, tz)
    found = []
    for back in (2, 1, 0):  # 36 hours can reach back into the day before yesterday
        day = today - timedelta(days=back)
        if _in_course(m, day):
            for due in _fixed_slots_on(m, day, tz):
                if now - LOOKBACK <= due <= now and slot_progress(m, due, grouped.get(due, [])).status in ("pending", "partial"):
                    found.append(due)
    return sorted(found)


def valid_slot(m: Medicine, doses: list[MedicineDose], scheduled_for: datetime, now: datetime, tz: str) -> bool:
    """Is this a slot a dose may be recorded against (today's slots, or a recent missed one)?"""
    if m.schedule_kind == "as_needed":
        return False
    known = {s.due_at for s in today_slots(m, doses, now, tz)} | set(unresolved_due_slots(m, doses, now, tz))
    return scheduled_for in known
