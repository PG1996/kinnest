import uuid
from datetime import UTC, date, datetime, timedelta

from app.models import Medicine, MedicineDose
from app.services import schedule

TZ = "Asia/Kolkata"
NOW = datetime(2026, 11, 8, 4, 30, tzinfo=UTC)  # 10:00 on 8 Nov in Kolkata


def ist(day, hh, mm=0):
    """A Kolkata wall-clock time as an aware UTC datetime."""
    return datetime(2026, 11, day, hh, mm, tzinfo=UTC) - timedelta(hours=5, minutes=30)


def med(kind="fixed", **kw):
    base = dict(
        id=uuid.uuid4(), name="Vit D", dose="5 drops", schedule_kind=kind, times=[], interval_hours=None,
        first_dose_at=None, min_gap_hours=None, start_date=date(2026, 11, 1), end_date=None, deleted_at=None,
    )
    base.update(kw)
    return Medicine(**base)


def dose(m, scheduled_for, status="given", given_at=None, deleted_at=None):
    return MedicineDose(
        id=uuid.uuid4(), medicine_id=m.id, status=status, scheduled_for=scheduled_for,
        given_at=given_at or scheduled_for or NOW, deleted_at=deleted_at,
    )


def test_fixed_slots_for_today_in_family_timezone():
    m = med(times=["21:00", "09:00"])
    slots = schedule.today_slots(m, [], NOW, TZ)
    assert [s.due_at for s in slots] == [ist(8, 9), ist(8, 21)]  # sorted, Kolkata wall clock
    assert {s.status for s in slots} == {"pending"}
    late = datetime(2026, 11, 8, 20, 0, tzinfo=UTC)  # already 9 Nov in Kolkata
    assert [s.due_at for s in schedule.today_slots(m, [], late, TZ)] == [ist(9, 9), ist(9, 21)]


def test_resolved_slot_is_not_pending():
    m = med(times=["09:00", "21:00"])
    d = dose(m, ist(8, 9))
    s = schedule.today_slots(m, [d], NOW, TZ)
    assert [x.status for x in s] == ["given", "pending"] and s[0].dose is d
    skipped = dose(m, ist(8, 9), status="skipped")
    assert schedule.today_slots(m, [skipped], NOW, TZ)[0].status == "skipped"
    undone = dose(m, ist(8, 9), deleted_at=NOW)
    assert schedule.today_slots(m, [undone], NOW, TZ)[0].status == "pending"


def test_interval_first_dose_then_anchored_to_given_at():
    m = med("interval", interval_hours=8, first_dose_at=ist(8, 8))
    assert schedule.next_interval_due(m, []) == ist(8, 8)
    late = dose(m, ist(8, 8), given_at=ist(8, 9, 15))
    assert schedule.next_interval_due(m, [late]) == ist(8, 17, 15)
    assert [s.due_at for s in schedule.today_slots(m, [late], NOW, TZ)] == [ist(8, 17, 15)]


def test_interval_skipped_anchors_to_scheduled_time():
    m = med("interval", interval_hours=8, first_dose_at=ist(8, 8))
    skipped = dose(m, ist(8, 8), status="skipped", given_at=ist(8, 11))
    assert schedule.next_interval_due(m, [skipped]) == ist(8, 16)


def test_interval_ignores_undone_doses_and_uses_the_latest():
    m = med("interval", interval_hours=6, first_dose_at=ist(8, 1))
    first, second = dose(m, ist(8, 1)), dose(m, ist(8, 7))
    undone = dose(m, ist(8, 13), deleted_at=NOW)
    assert schedule.next_interval_due(m, [first, second, undone]) == ist(8, 13)


def test_end_date_stops_slots():
    m = med(times=["09:00"], end_date=date(2026, 11, 7))
    assert not schedule.is_active(m, NOW, TZ) and schedule.today_slots(m, [], NOW, TZ) == []
    on_last_day = med(times=["09:00"], end_date=date(2026, 11, 8))
    assert schedule.is_active(on_last_day, NOW, TZ)
    interval = med("interval", interval_hours=8, first_dose_at=ist(8, 8), end_date=date(2026, 11, 8))
    done = dose(interval, ist(8, 8), given_at=ist(8, 17))
    assert schedule.today_slots(interval, [done], NOW, TZ) == []  # the next one would be 01:00 on 9 Nov, after the end date


def test_future_start_date_has_no_slots():
    m = med(times=["09:00"], start_date=date(2026, 11, 10))
    assert not schedule.is_active(m, NOW, TZ) and schedule.today_slots(m, [], NOW, TZ) == []


def test_deleted_medicine_is_inactive():
    assert not schedule.is_active(med(times=["09:00"], deleted_at=NOW), NOW, TZ)


def test_as_needed_has_no_slots():
    m = med("as_needed", min_gap_hours=6)
    assert schedule.today_slots(m, [], NOW, TZ) == [] and schedule.unresolved_due_slots(m, [], NOW, TZ) == []


def test_unresolved_due_slots_only_past_due_and_unresolved():
    m = med(times=["09:00"])
    assert schedule.unresolved_due_slots(m, [], ist(8, 8), TZ) == [ist(7, 9)]  # today's 09:00 is not due yet
    assert schedule.unresolved_due_slots(m, [dose(m, ist(7, 9))], ist(8, 8), TZ) == []
    assert schedule.unresolved_due_slots(m, [], NOW, TZ) == [ist(7, 9), ist(8, 9)]
    skipped = dose(m, ist(8, 9), status="skipped")
    assert schedule.unresolved_due_slots(m, [skipped], NOW, TZ) == [ist(7, 9)]


def test_stale_slot_older_than_36h_not_returned():
    m = med(times=["09:00"])
    assert ist(6, 9) not in schedule.unresolved_due_slots(m, [], NOW, TZ)  # 49 hours ago
    stale = med("interval", interval_hours=8, first_dose_at=ist(5, 8))
    assert schedule.unresolved_due_slots(stale, [], NOW, TZ) == []


def test_unresolved_interval_slot_when_due():
    m = med("interval", interval_hours=8, first_dose_at=ist(8, 8))
    assert schedule.unresolved_due_slots(m, [], NOW, TZ) == [ist(8, 8)]
    assert schedule.unresolved_due_slots(m, [], ist(8, 7), TZ) == []


def test_valid_slot_rejects_unknown_time():
    m = med(times=["09:00", "21:00"])
    assert schedule.valid_slot(m, [], ist(8, 9), NOW, TZ)
    assert schedule.valid_slot(m, [], ist(7, 21), NOW, TZ)  # yesterday's missed evening dose
    assert not schedule.valid_slot(m, [], ist(8, 9, 30), NOW, TZ)
    assert not schedule.valid_slot(m, [], ist(5, 9), NOW, TZ)
    assert not schedule.valid_slot(med("as_needed"), [], ist(8, 9), NOW, TZ)
