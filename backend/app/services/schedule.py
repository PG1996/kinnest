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
    target: Decimal | None = None  # the dose this slot is judged against (see slot_progress)

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
    """Progress of one slot against the dose it was prescribed under.

    A slot that already has pieces is judged against the dose recorded on its first piece, so editing the medicine's
    dose later cannot reopen a finished slot or change what is left of a started one. A slot with no pieces yet uses the
    medicine's current dose. If the unit was changed since the pieces were given, amounts cannot be compared and the
    slot is treated as closed.
    """
    pieces = sorted(_live(slot_doses), key=lambda d: d.given_at)
    given = [d for d in pieces if d.status == "given"]
    snapshot = next((d for d in pieces if d.prescribed_amount is not None), None)
    target = snapshot.prescribed_amount if snapshot else m.dose_amount
    unit_changed = snapshot is not None and snapshot.prescribed_unit is not None and snapshot.prescribed_unit != m.dose_unit
    legacy = target is None
    # a piece logged before the dose had an amount was a whole dose
    total = sum((d.amount if d.amount is not None else (target or ZERO) for d in given), ZERO)
    if any(d.status == "skipped" for d in pieces):
        status = "skipped"
    elif legacy:
        status = "given" if given else "pending"
    elif unit_changed or total >= target:
        status = "given"
    else:
        status = "partial" if total > 0 else "pending"
    remaining = None if legacy else (ZERO if unit_changed else max(target - total, ZERO))
    return SlotState(due_at, status, pieces, total if not legacy else ZERO, remaining, target)


def slot_state(m: Medicine, doses: list[MedicineDose], due_at: datetime) -> SlotState:
    """Progress of one slot, found among a medicine's doses."""
    return slot_progress(m, due_at, [d for d in _live(doses) if d.scheduled_for == due_at])


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


def _usual_start(m: Medicine, tz: str) -> time:
    """The usual first dose time of the day: the one the user set, else the time of day of the first dose."""
    if m.day_start:
        hh, mm = (int(x) for x in m.day_start.split(":"))
        return time(hh, mm)
    return m.first_dose_at.astimezone(ZoneInfo(tz)).time().replace(second=0, microsecond=0)


def _next_usual_start(m: Medicine, after: datetime, tz: str) -> datetime:
    """The first moment at or after `after` that is the usual first dose time, in the family timezone."""
    zone = ZoneInfo(tz)
    t = _usual_start(m, tz)
    local = after.astimezone(zone)
    candidate = datetime.combine(local.date(), t, tzinfo=zone)
    if candidate < after:
        candidate = datetime.combine(local.date() + timedelta(days=1), t, tzinfo=zone)
    return candidate.astimezone(UTC)


def next_interval_due(m: Medicine, doses: list[MedicineDose], tz: str = "UTC") -> datetime | None:
    """First dose time, then the finish time of the last resolved slot plus the interval.

    A slot only counts once it is resolved (given in full, or skipped), so a half-given dose does not move the schedule.

    With a daily maximum, a day is a calendar day in the family timezone (midnight to midnight). Once the day's slots
    (given or skipped) reach the maximum, the next dose is the usual first dose time of the next day. A day that is not
    full does not carry on through the night either: a dose due after midnight waits for the usual first dose time of
    that new day (or its own time, if that is later). The count starts again at zero every midnight.
    """
    resolved: list[SlotState] = []
    for due, group in _by_slot(doses).items():
        state = slot_progress(m, due, group)
        if state.status in ("given", "skipped"):
            resolved.append(state)
    if not resolved:
        return m.first_dose_at
    resolved.sort(key=lambda s: s.due_at)
    step = timedelta(hours=m.interval_hours)

    def base(s: SlotState) -> datetime:
        return s.doses[-1].given_at if s.status == "given" else s.due_at

    last = base(resolved[-1])
    due = last + step
    cap = m.max_per_day if m.schedule_kind == "interval" else None
    if cap:
        day = _local_date(last, tz)
        if sum(1 for s in resolved if _local_date(base(s), tz) == day) >= cap:
            return _next_usual_start(m, _midnight_after(day, tz), tz)
        if _local_date(due, tz) != day:  # a new day starts at its usual first dose time
            return max(due, _next_usual_start(m, _midnight_of(_local_date(due, tz), tz), tz))
    return due


def _midnight_of(day: date, tz: str) -> datetime:
    return datetime.combine(day, time(0, 0), tzinfo=ZoneInfo(tz)).astimezone(UTC)


def _midnight_after(day: date, tz: str) -> datetime:
    return _midnight_of(day + timedelta(days=1), tz)


def _interval_slot(m: Medicine, doses: list[MedicineDose], now: datetime, tz: str) -> datetime | None:
    if not is_active(m, now, tz):
        return None
    due = next_interval_due(m, doses, tz)
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
