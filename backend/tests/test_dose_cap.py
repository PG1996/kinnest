"""Interval medicines with a maximum number of doses per day, and the usual first dose time."""

import uuid
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal
from zoneinfo import ZoneInfo

import pytest

from app.models import Medicine, MedicineDose
from app.services import schedule
from tests.test_medicines import as_needed, fixed, give, interval, listing, make, when

IST = ZoneInfo("Asia/Kolkata")
TZ = "Asia/Kolkata"


def at(day: int, hh: int, mm: int = 0) -> datetime:
    """Kolkata wall-clock time on 2026-11-<day>, as UTC."""
    return datetime(2026, 11, day, hh, mm, tzinfo=IST).astimezone(UTC)


def med(max_per_day=3, day_start="11:00", interval_hours=4, first=None) -> Medicine:
    return Medicine(
        id=uuid.uuid4(), name="Antibiotic", dose_amount=Decimal("2.50"), dose_unit="ml", schedule_kind="interval", times=[],
        interval_hours=interval_hours, first_dose_at=first or at(1, 11), start_date=date(2026, 10, 1), max_per_day=max_per_day, day_start=day_start,
    )


def dose(m: Medicine, due: datetime, given: datetime | None = None, status="given") -> MedicineDose:
    return MedicineDose(
        id=uuid.uuid4(), medicine_id=m.id, status=status, scheduled_for=due, given_at=given or due,
        amount=Decimal("2.50") if status == "given" else None, prescribed_amount=m.dose_amount, prescribed_unit="ml",
    )


# --- the next slot ---------------------------------------------------------------------------------------------------

def test_first_slot_is_the_first_dose_time():
    m = med()
    assert schedule.next_interval_due(m, [], TZ) == at(1, 11)


def test_inside_the_day_the_next_slot_follows_the_last_dose_by_the_interval():
    m = med()
    d1 = dose(m, at(1, 11), at(1, 11, 5))
    assert schedule.next_interval_due(m, [d1], TZ) == at(1, 15, 5)
    d2 = dose(m, at(1, 15, 5), at(1, 15, 10))
    assert schedule.next_interval_due(m, [d1, d2], TZ) == at(1, 19, 10)


def test_after_the_maximum_the_next_slot_is_the_next_usual_start():
    m = med()
    doses = [dose(m, at(1, 11)), dose(m, at(1, 15)), dose(m, at(1, 19))]
    assert schedule.next_interval_due(m, doses, TZ) == at(2, 11)


def test_a_late_day_still_ends_at_the_usual_start_next_morning():
    m = med()
    doses = [dose(m, at(1, 12, 30)), dose(m, at(1, 16, 30)), dose(m, at(1, 20, 30))]
    assert schedule.next_interval_due(m, doses, TZ) == at(2, 11)  # not 00:30


def test_a_day_that_ended_early_waits_for_tomorrow_not_later_today():
    m = med(first=at(1, 1))
    doses = [dose(m, at(1, 1)), dose(m, at(1, 5)), dose(m, at(1, 9))]
    assert schedule.next_interval_due(m, doses, TZ) == at(2, 11)  # 9:00 + 4h = 13:00, the next 11:00 is tomorrow


def test_a_skipped_slot_still_counts_towards_the_day():
    m = med()
    d1 = dose(m, at(1, 11))
    skipped = dose(m, at(1, 15), status="skipped")
    assert schedule.next_interval_due(m, [d1, skipped], TZ) == at(1, 19)  # no fourth dose appears
    d3 = dose(m, at(1, 19))
    assert schedule.next_interval_due(m, [d1, skipped, d3], TZ) == at(2, 11)


def test_the_second_day_follows_the_same_rule():
    m = med()
    day1 = [dose(m, at(1, 11)), dose(m, at(1, 15)), dose(m, at(1, 19))]
    d1 = dose(m, at(2, 11, 30), at(2, 11, 30))
    assert schedule.next_interval_due(m, day1 + [d1], TZ) == at(2, 15, 30)
    day2 = day1 + [d1, dose(m, at(2, 15, 30)), dose(m, at(2, 19, 30))]
    assert schedule.next_interval_due(m, day2, TZ) == at(3, 11)


def test_a_maximum_of_one_means_one_dose_every_day_at_the_usual_time():
    m = med(max_per_day=1)
    assert schedule.next_interval_due(m, [dose(m, at(1, 11, 40))], TZ) == at(2, 11)


def test_without_a_usual_time_it_is_the_time_of_day_of_the_first_dose():
    m = med(day_start=None, first=at(1, 8, 15))
    doses = [dose(m, at(1, 8, 15)), dose(m, at(1, 12, 15)), dose(m, at(1, 16, 15))]
    assert schedule.next_interval_due(m, doses, TZ) == at(2, 8, 15)


def test_a_partly_given_slot_does_not_move_the_schedule():
    m = med()
    half = dose(m, at(1, 11))
    half.amount = Decimal("1.00")
    assert schedule.next_interval_due(m, [half], TZ) == at(1, 11)  # still waiting for the rest of the first dose


def test_without_a_maximum_nothing_changes():
    m = med(max_per_day=None, day_start=None)
    doses = [dose(m, at(1, 11)), dose(m, at(1, 15)), dose(m, at(1, 19))]
    assert schedule.next_interval_due(m, doses, TZ) == at(1, 23)  # keeps going every 4 hours


def test_a_new_calendar_day_starts_again_at_the_usual_time_even_if_yesterday_was_not_full():
    m = med(max_per_day=5)
    doses = [dose(m, at(1, 11)), dose(m, at(1, 15)), dose(m, at(1, 19)), dose(m, at(1, 23))]  # 4 of 5 given on day 1
    assert schedule.next_interval_due(m, doses, TZ) == at(2, 11)  # 23:00 + 4h = 03:00 is a new day: no night dose


def test_the_usual_time_is_only_a_floor_for_a_new_day():
    m = med(max_per_day=5, day_start="06:00", interval_hours=8, first=at(1, 6))
    doses = [dose(m, at(1, 15)), dose(m, at(1, 23))]
    assert schedule.next_interval_due(m, doses, TZ) == at(2, 7)  # 23:00 + 8h is already after 06:00
    early = [dose(m, at(1, 14)), dose(m, at(1, 22))]
    assert schedule.next_interval_due(m, early, TZ) == at(2, 6)  # 22:00 + 8h = 06:00, exactly the usual time


def test_doses_given_before_midnight_do_not_count_towards_the_next_day():
    m = med(max_per_day=3)
    late = [dose(m, at(1, 20)), dose(m, at(1, 23, 30))]  # two of three on day 1
    day2 = late + [dose(m, at(2, 11, 15))]  # the first of day 2
    assert schedule.next_interval_due(m, day2, TZ) == at(2, 15, 15)  # not capped: only one dose today


def test_a_dose_given_outside_any_slot_moves_the_schedule_too():
    m = med(max_per_day=3, interval_hours=5)
    skipped = dose(m, at(1, 21, 10), at(2, 13, 2), status="skipped")  # last night's missed slot, skipped this afternoon
    extra = dose(m, None, at(2, 12, 50))  # given at 12:50 with no slot
    assert schedule.next_interval_due(m, [skipped, extra], TZ) == at(2, 17, 50)  # 12:50 + 5h, not the skipped slot again


def test_the_latest_event_decides_not_the_latest_slot_time():
    m = med(max_per_day=3, interval_hours=5)
    early_slot_late_dose = dose(m, at(2, 1, 6), at(1, 16, 10))  # the slot is after the skipped one, but was given before it
    skipped = dose(m, at(1, 21, 10), at(2, 13, 2), status="skipped")
    assert schedule.next_interval_due(m, [early_slot_late_dose, skipped], TZ) == at(2, 11)  # 21:10 + 5h is the next day: usual start


def test_doses_given_outside_a_slot_count_towards_the_day():
    m = med(max_per_day=2, interval_hours=4)
    doses = [dose(m, None, at(1, 11, 30)), dose(m, None, at(1, 15, 40))]
    assert schedule.next_interval_due(m, doses, TZ) == at(2, 11)  # two of two given today


# --- the API -----------------------------------------------------------------------------------------------------------

def capped(clock, **kw):
    return interval(clock, max_per_day=3, day_start="09:00", **kw)


def test_the_medicine_keeps_its_maximum_and_usual_time(family, clock):
    med_json = make(family.owner, capped(clock))
    assert med_json["max_per_day"] == 3 and med_json["day_start"] == "09:00"
    assert listing(family.owner)[0]["max_per_day"] == 3


def test_the_maximum_and_usual_time_are_checked(family, clock):
    bad = lambda **kw: family.owner.post("/api/medicines", json=interval(clock, **kw))  # noqa: E731
    assert bad(max_per_day=0).status_code == 422
    assert bad(max_per_day=25).status_code == 422
    assert bad(max_per_day=3, day_start="25:00").status_code == 422
    assert bad(max_per_day=3, day_start="9:00").status_code == 422
    assert bad(max_per_day=3, day_start="09:00").status_code == 201


def test_a_usual_time_needs_an_interval_medicine_and_a_maximum_fits_sos_and_interval_only(family, clock):
    f = make(family.owner, fixed(clock, max_per_day=2, day_start="08:00"))
    assert f["max_per_day"] is None and f["day_start"] is None  # fixed times have no use for either
    s = make(family.owner, as_needed(clock, max_per_day=2, day_start="08:00"))
    assert s["max_per_day"] == 2 and s["day_start"] is None  # SOS: a maximum, no usual time


def test_the_maximum_can_be_changed_later(family, clock):
    m = make(family.owner, capped(clock))
    r = family.owner.patch(f"/api/medicines/{m['id']}", json={"max_per_day": 2, "day_start": "10:30"})
    assert r.status_code == 200 and r.json()["max_per_day"] == 2 and r.json()["day_start"] == "10:30"
    assert family.owner.patch(f"/api/medicines/{m['id']}", json={"max_per_day": None}).json()["max_per_day"] is None


def test_the_chain_runs_up_to_the_maximum_then_waits_for_tomorrow(family, clock):
    m = make(family.owner, {**interval(clock), "max_per_day": 2, "day_start": "09:00", "first_dose_at": clock.at(9).isoformat()})
    first = clock.at(9)
    slot1 = next(s for s in listing(family.owner)[0]["slots"] if when(s["due_at"]) == first)
    assert give(family.mom, m, {"id": str(uuid.uuid4()), "status": "given", "amount": 2.5, "scheduled_for": slot1["due_at"], "given_at": clock.at(9, 5).isoformat()}).status_code == 201
    second = clock.at(9, 5) + timedelta(hours=8)  # interval() uses 8 hours
    dues = [when(s["due_at"]) for s in listing(family.owner)[0]["slots"]]
    assert second in dues
    assert give(family.mom, m, {"id": str(uuid.uuid4()), "status": "given", "amount": 2.5, "scheduled_for": second.isoformat(), "given_at": clock.at(17, 10).isoformat()}).status_code == 201
    dues = [when(s["due_at"]) for s in listing(family.owner)[0]["slots"]]
    assert clock.at(9, days=1) in dues and second + timedelta(hours=8) not in dues


# --- the calendar-day count and its warning ---------------------------------------------------------------------------

def dose_body(**kw):
    return {"id": str(uuid.uuid4()), "status": "given", "amount": 1.5, **kw}


def test_the_count_is_of_doses_given_on_the_calendar_day_and_it_says_when_the_day_ends(family, clock):
    m = make(family.owner, as_needed(clock, max_per_day=2))
    assert listing(family.owner)[0]["given_today"] == 0
    give(family.mom, m, dose_body(given_at=clock.at(0, 30).isoformat()))  # just after midnight today
    give(family.mom, m, dose_body(given_at=clock.at(9).isoformat()))
    give(family.mom, m, dose_body(given_at=clock.at(23, 30, days=-1).isoformat()))  # within 24 h, but yesterday
    give(family.mom, m, dose_body(status="skipped"))
    row = listing(family.owner)[0]
    assert row["given_today"] == 2
    assert when(row["day_ends_at"]) == clock.at(0, days=1)
    assert "given_last_24h" not in row


def test_the_count_starts_again_at_midnight(family, clock):
    m = make(family.owner, as_needed(clock, max_per_day=2))
    give(family.mom, m, dose_body(given_at=clock.at(8).isoformat()))
    give(family.mom, m, dose_body(given_at=clock.at(9).isoformat()))
    assert listing(family.owner)[0]["given_today"] == 2
    clock.now = clock.at(0, 1, days=1)  # the next calendar day
    assert listing(family.owner)[0]["given_today"] == 0


def test_sos_warns_once_the_maximum_is_reached_but_never_refuses(family, clock):
    m = make(family.owner, {**as_needed(clock), "max_per_day": 2, "min_gap_hours": None})
    first = give(family.mom, m, dose_body(given_at=clock.at(1).isoformat()))
    second = give(family.mom, m, dose_body(given_at=clock.at(5).isoformat()))
    assert first.json().get("max_warning") is None and second.json().get("max_warning") is None
    third = give(family.mom, m, dose_body(given_at=clock.now.isoformat()))
    assert third.status_code == 201
    assert third.json()["max_warning"] == {"count": 2, "max": 2}


def test_yesterdays_doses_do_not_trigger_the_warning_today(family, clock):
    m = make(family.owner, {**as_needed(clock), "max_per_day": 2, "min_gap_hours": None})
    give(family.mom, m, dose_body(given_at=clock.at(22, days=-1).isoformat()))
    give(family.mom, m, dose_body(given_at=clock.at(23, days=-1).isoformat()))
    today = give(family.mom, m, dose_body(given_at=clock.now.isoformat()))  # two doses in the last 24 h, none today
    assert today.status_code == 201 and today.json().get("max_warning") is None


def test_no_warning_without_a_maximum(family, clock):
    m = make(family.owner, {**as_needed(clock), "max_per_day": None})
    for h in (9, 6, 3):
        r = give(family.mom, m, dose_body(given_at=(clock.now - timedelta(hours=h)).isoformat()))
        assert r.json().get("max_warning") is None


def test_a_dose_given_in_pieces_counts_once_towards_the_maximum(family, clock):
    from tests.test_medicines import syrup

    m = make(family.owner, {**syrup(clock), "schedule_kind": "interval", "times": [], "interval_hours": 8, "first_dose_at": clock.at(9).isoformat(), "max_per_day": 2, "day_start": "09:00"})
    slot = listing(family.owner)[0]["slots"][0]["due_at"]
    a = give(family.mom, m, {"id": str(uuid.uuid4()), "status": "given", "amount": 0.25, "scheduled_for": slot, "given_at": clock.at(9, 5).isoformat()})
    b = give(family.mom, m, {"id": str(uuid.uuid4()), "status": "given", "amount": 0.25, "scheduled_for": slot, "given_at": clock.at(9, 20).isoformat()})
    assert a.status_code == 201 and b.status_code == 201
    assert listing(family.owner)[0]["given_today"] == 1
    assert b.json().get("max_warning") is None  # the second piece of the same dose is not a second dose


def test_the_last_dose_is_the_latest_one_given_not_a_later_skip(family, clock):
    m = make(family.owner, {**interval(clock), "first_dose_at": clock.at(9).isoformat()})
    first = listing(family.owner)[0]["slots"][0]["due_at"]
    assert give(family.mom, m, {"id": str(uuid.uuid4()), "status": "given", "amount": 2.5, "scheduled_for": first, "given_at": clock.at(9, 5).isoformat()}).status_code == 201
    second = listing(family.owner)[0]["slots"][0]["due_at"]
    assert give(family.mom, m, {"id": str(uuid.uuid4()), "status": "skipped", "scheduled_for": second}).status_code == 201
    row = listing(family.owner)[0]
    assert row["last_dose"]["status"] == "given" and when(row["last_dose"]["given_at"]) == clock.at(9, 5)
