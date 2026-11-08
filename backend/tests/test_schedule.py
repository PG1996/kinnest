import uuid
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal

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


def dose(m, scheduled_for, status="given", given_at=None, deleted_at=None, amount=None):
    return MedicineDose(
        id=uuid.uuid4(), medicine_id=m.id, status=status, scheduled_for=scheduled_for,
        given_at=given_at or scheduled_for or NOW, deleted_at=deleted_at,
        amount=Decimal(amount) if amount is not None else None,
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


# --- partial dosing (slice 2b) -------------------------------------------------------------------------------------


def one_ml(kind="fixed", **kw):
    return med(kind, dose_amount=Decimal("1.00"), dose_unit="ml", **({"times": ["09:00"]} if kind == "fixed" else {}), **kw)


def slot_of(m, doses):
    return schedule.today_slots(m, doses, NOW, TZ)[0]


def test_pieces_add_up_exactly_without_float_drift():
    m = one_ml()
    quarters = [dose(m, ist(8, 9), amount="0.25", given_at=ist(8, 9, i)) for i in range(4)]
    s = slot_of(m, quarters)
    assert (s.status, s.given_amount, s.remaining) == ("given", Decimal("1.00"), Decimal("0.00"))
    mixed = [dose(m, ist(8, 9), amount=a) for a in ("0.1", "0.2", "0.7")]
    assert slot_of(m, mixed).status == "given"


def test_partial_slot_reports_progress_and_is_still_unresolved():
    m = one_ml()
    s = slot_of(m, [dose(m, ist(8, 9), amount="0.25")])
    assert (s.status, s.given_amount, s.remaining) == ("partial", Decimal("0.25"), Decimal("0.75"))
    assert ist(8, 9) in schedule.unresolved_due_slots(m, [dose(m, ist(8, 9), amount="0.25")], NOW, TZ)
    assert ist(8, 9) not in schedule.unresolved_due_slots(m, [dose(m, ist(8, 9), amount="1.00")], NOW, TZ)


def test_skip_after_a_piece_closes_the_slot_and_keeps_the_pieces():
    m = one_ml()
    piece, skip = dose(m, ist(8, 9), amount="0.50"), dose(m, ist(8, 9), status="skipped", given_at=ist(8, 9, 20))
    s = slot_of(m, [piece, skip])
    assert (s.status, s.given_amount, s.remaining) == ("skipped", Decimal("0.50"), Decimal("0.50"))
    assert ist(8, 9) not in schedule.unresolved_due_slots(m, [piece, skip], NOW, TZ)


def test_legacy_medicine_any_given_dose_completes_the_slot():
    m = med(times=["09:00"])  # no dose_amount: saved before structured doses
    s = slot_of(m, [dose(m, ist(8, 9))])
    assert (s.status, s.remaining) == ("given", None)


def test_a_piece_without_amount_counts_as_a_full_dose():
    m = one_ml()  # the medicine got its amount after this dose was logged
    assert slot_of(m, [dose(m, ist(8, 9))]).status == "given"


def test_undone_pieces_are_ignored():
    m = one_ml()
    s = slot_of(m, [dose(m, ist(8, 9), amount="0.50"), dose(m, ist(8, 9), amount="0.50", deleted_at=NOW)])
    assert (s.status, s.given_amount) == ("partial", Decimal("0.50"))


def test_slot_keeps_every_piece_and_exposes_the_latest_as_dose():
    m = one_ml()
    first, second = dose(m, ist(8, 9), amount="0.25", given_at=ist(8, 9, 1)), dose(m, ist(8, 9), amount="0.25", given_at=ist(8, 9, 5))
    s = slot_of(m, [second, first])
    assert s.doses == [first, second] and s.dose is second


def test_interval_stays_on_the_open_slot_until_it_is_completed():
    m = one_ml("interval", interval_hours=8, first_dose_at=ist(8, 8))
    half = dose(m, ist(8, 8), amount="0.50", given_at=ist(8, 8, 5))
    assert schedule.next_interval_due(m, [half]) == ist(8, 8)  # still the first slot
    s = slot_of(m, [half])
    assert (s.due_at, s.status) == (ist(8, 8), "partial")
    rest = dose(m, ist(8, 8), amount="0.50", given_at=ist(8, 8, 40))
    assert schedule.next_interval_due(m, [half, rest]) == ist(8, 16, 40)  # counted from completion


def test_interval_with_a_skip_after_pieces_anchors_to_the_scheduled_time():
    m = one_ml("interval", interval_hours=8, first_dose_at=ist(8, 8))
    piece, skip = dose(m, ist(8, 8), amount="0.25", given_at=ist(8, 8, 5)), dose(m, ist(8, 8), status="skipped", given_at=ist(8, 9))
    assert schedule.next_interval_due(m, [piece, skip]) == ist(8, 16)
