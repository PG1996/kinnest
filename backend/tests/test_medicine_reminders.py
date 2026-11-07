import uuid
from datetime import UTC, date, datetime, timedelta

from app.models import Medicine, MedicineDose, NotificationPref, ReminderState
from app.worker.reminders import tick
from tests.test_reminders import FakeSender, ids, world  # noqa: F401  (world is a fixture)

SLOT = datetime(2026, 11, 8, 3, 30, tzinfo=UTC)  # 09:00 on 8 Nov in Kolkata


class ParamSender(FakeSender):
    """FakeSender that also remembers the text parameters, to check which medicine a message is about."""

    def __init__(self, *a, **k):
        super().__init__(*a, **k)
        self.params = []

    def __call__(self, sub, title_key, body_params, urgency, url="/"):
        self.params.append(body_params)
        return super().__call__(sub, title_key, body_params, urgency, url)


def add_med(w, kind="fixed", name="Vitamin D", **kw):
    admin = w.users["owner"]
    data = dict(
        family_id=w.kid.family_id, kid_id=w.kid.id, name=name, dose="5 drops", schedule_kind=kind,
        times=["09:00"] if kind == "fixed" else [], start_date=date(2026, 11, 1), created_by=admin.id, updated_by=admin.id,
        created_at=SLOT - timedelta(days=2),  # added well before the slots under test
    )
    data.update(kw)
    m = Medicine(**data)
    w.db.add(m)
    w.db.flush()
    return m


def add_dose(w, med, scheduled_for, status="given", given_at=None):
    u = w.users["mom"]
    d = MedicineDose(
        id=uuid.uuid4(), family_id=w.kid.family_id, kid_id=w.kid.id, medicine_id=med.id, status=status,
        scheduled_for=scheduled_for, given_at=given_at or scheduled_for, by_user_id=u.id, created_by=u.id, updated_by=u.id,
    )
    w.db.add(d)
    w.db.flush()
    return d


def test_fixed_dose_level0_to_caregivers_not_viewers(world):
    add_med(world)
    s = FakeSender()
    tick(world.db, SLOT, s)
    assert s.recipients() == ids(world, "owner", "mom")
    assert {x[1] for x in s.sent} == {"med_due"} and {x[2] for x in s.sent} == {"normal"}
    assert {x[3] for x in s.sent} == {"/?log=medicine"}


def test_nothing_before_the_slot_is_due(world):
    add_med(world)
    s = FakeSender()
    tick(world.db, SLOT - timedelta(minutes=1), s)
    assert [x for x in s.sent if x[1].startswith("med")] == []


def test_level1_and_level2_admin_only_high(world):
    add_med(world)
    s = FakeSender()
    tick(world.db, SLOT, s)
    s.sent.clear()
    tick(world.db, SLOT + timedelta(minutes=15), s)
    assert s.recipients() == ids(world, "owner", "mom") and {x[1] for x in s.sent} == {"med_due_again"}
    s.sent.clear()
    tick(world.db, SLOT + timedelta(minutes=30), s)
    assert s.sent == [(world.users["owner"].id, "med_overdue_admin", "high", "/?log=medicine")]


def test_given_dose_stops_chain(world):
    med = add_med(world)
    s = FakeSender()
    tick(world.db, SLOT, s)
    add_dose(world, med, SLOT, given_at=SLOT + timedelta(minutes=5))
    s.sent.clear()
    tick(world.db, SLOT + timedelta(minutes=20), s)
    tick(world.db, SLOT + timedelta(minutes=40), s)
    assert s.sent == []


def test_skipped_dose_stops_chain(world):
    med = add_med(world)
    s = FakeSender()
    tick(world.db, SLOT, s)
    add_dose(world, med, SLOT, status="skipped")
    s.sent.clear()
    tick(world.db, SLOT + timedelta(minutes=20), s)
    assert s.sent == []


def test_interval_chain_anchored_to_last_given(world):
    first = datetime(2026, 11, 8, 2, 30, tzinfo=UTC)
    med = add_med(world, "interval", name="Antibiotic", interval_hours=8, first_dose_at=first)
    add_dose(world, med, first, given_at=first + timedelta(hours=1))  # given an hour late: next due at 11:30Z
    s = FakeSender()
    tick(world.db, datetime(2026, 11, 8, 11, 29, tzinfo=UTC), s)
    assert s.sent == []
    tick(world.db, datetime(2026, 11, 8, 11, 30, tzinfo=UTC), s)
    assert {x[1] for x in s.sent} == {"med_due"}


def test_ended_or_deleted_medicine_sends_nothing(world):
    add_med(world, name="Ended", end_date=date(2026, 11, 7))
    add_med(world, name="Gone", deleted_at=SLOT - timedelta(days=1))
    s = FakeSender()
    tick(world.db, SLOT, s)
    tick(world.db, SLOT + timedelta(minutes=30), s)
    assert s.sent == []


def test_medicine_ending_mid_chain_stops_reminding(world):
    med = add_med(world)
    s = FakeSender()
    tick(world.db, SLOT, s)
    med.end_date = date(2026, 11, 7)
    world.db.flush()
    s.sent.clear()
    tick(world.db, SLOT + timedelta(minutes=15), s)
    assert s.sent == []


def test_as_needed_never_reminds(world):
    add_med(world, "as_needed", name="Paracetamol", min_gap_hours=6)
    s = FakeSender()
    for minutes in (0, 15, 30, 600):
        tick(world.db, SLOT + timedelta(minutes=minutes), s)
    assert s.sent == []


def test_stale_interval_slot_over_36h_sends_nothing(world):
    add_med(world, "interval", name="Old", interval_hours=8, first_dose_at=SLOT - timedelta(days=5))
    s = FakeSender()
    tick(world.db, SLOT, s)
    assert s.sent == []


def test_restart_does_not_resend_medicine_level(world):
    add_med(world)
    tick(world.db, SLOT, FakeSender())
    after_restart = FakeSender()
    tick(world.db, SLOT, after_restart)
    tick(world.db, SLOT + timedelta(minutes=1), after_restart)
    assert after_restart.sent == []
    assert world.db.query(ReminderState).filter_by(kind="medicine").one().level == 0


def test_medicine_pref_off_skips_user(world):
    add_med(world)
    world.db.add(NotificationPref(user_id=world.users["mom"].id, kind="medicine", enabled=False))
    world.db.flush()
    s = FakeSender()
    tick(world.db, SLOT, s)
    assert s.recipients() == ids(world, "owner")


def test_two_medicines_have_independent_chains(world):
    a = add_med(world, name="Vitamin D")
    add_med(world, name="Iron")
    s = ParamSender()
    tick(world.db, SLOT, s)
    assert sorted({p["medicine"] for p in s.params}) == ["Iron", "Vitamin D"]
    add_dose(world, a, SLOT)  # Vitamin D given, Iron still pending
    s.sent.clear()
    s.params.clear()
    tick(world.db, SLOT + timedelta(minutes=15), s)
    assert {p["medicine"] for p in s.params} == {"Iron"} and {x[1] for x in s.sent} == {"med_due_again"}


def test_old_medicine_state_purged_but_newest_per_medicine_kept(world):
    a, b = add_med(world, name="A"), add_med(world, name="B")
    now = SLOT + timedelta(days=10, hours=1)  # past the start window, so no fresh chain muddies the check
    for med in (a, b):
        for days in (30, 20):
            world.db.add(ReminderState(kid_id=world.kid.id, kind="medicine", subject_id=med.id,
                                       anchor_at=SLOT - timedelta(days=days), level=2))
    world.db.flush()
    tick(world.db, now, FakeSender())
    left = {(r.subject_id, r.anchor_at) for r in world.db.query(ReminderState).filter(
        ReminderState.anchor_at < now - timedelta(days=7))}
    assert left == {(a.id, SLOT - timedelta(days=20)), (b.id, SLOT - timedelta(days=20))}


def test_slot_before_the_medicine_was_added_is_not_reminded(world):
    add_med(world, created_at=SLOT + timedelta(minutes=10))  # added at 09:10, after the 09:00 slot
    s = FakeSender()
    tick(world.db, SLOT + timedelta(minutes=15), s)
    assert s.sent == []


def test_a_late_first_tick_skips_old_slots_instead_of_flooding(world):
    add_med(world)
    s = FakeSender()  # e.g. the Mac slept until the slot was 2 hours old, and yesterday's slots are 24 h old
    tick(world.db, SLOT + timedelta(hours=2), s)
    assert s.sent == []


def test_a_chain_that_already_started_keeps_going_after_a_delay(world):
    add_med(world)
    s = FakeSender()
    tick(world.db, SLOT, s)
    s.sent.clear()
    tick(world.db, SLOT + timedelta(hours=2), s)
    assert {x[1] for x in s.sent} == {"med_due_again"}
