from datetime import UTC, date, datetime, time, timedelta
from zoneinfo import ZoneInfo

from app.models import DoctorVisit, NotificationPref, ReminderState, Vaccination
from app.worker.reminders import tick
from tests.test_reminders import FakeSender, ids, world  # noqa: F401  (world is a fixture)

IST = ZoneInfo("Asia/Kolkata")
DUE = date(2026, 11, 20)


def at(d: date, hh: int, mm: int = 0) -> datetime:
    return datetime.combine(d, time(hh, mm), tzinfo=IST).astimezone(UTC)


EVE = at(DUE - timedelta(days=1), 18)
MORNING = at(DUE, 8)
LONG_AGO = datetime(2026, 11, 1, tzinfo=UTC)


class ParamSender(FakeSender):
    def __init__(self, *a, **k):
        super().__init__(*a, **k)
        self.params = []

    def __call__(self, sub, title_key, body_params, urgency, url="/"):
        self.params.append(body_params)
        return super().__call__(sub, title_key, body_params, urgency, url)


def add_vax(w, name="BCG", due=DUE, status="pending", created_at=LONG_AGO, **kw):
    u = w.users["owner"]
    v = Vaccination(family_id=w.kid.family_id, kid_id=w.kid.id, name=name, dose_label=kw.pop("dose_label", "1"),
                    due_date=due, status=status, created_by=u.id, updated_by=u.id, created_at=created_at,
                    given_on=due if status == "given" else None, **kw)
    w.db.add(v)
    w.db.flush()
    return v


def add_visit(w, when, status="upcoming", created_at=LONG_AGO, **kw):
    u = w.users["owner"]
    v = DoctorVisit(family_id=w.kid.family_id, kid_id=w.kid.id, scheduled_at=when, status=status, doctor="Dr Rao",
                    place="City Clinic", reason="check-up", created_by=u.id, updated_by=u.id, created_at=created_at, **kw)
    w.db.add(v)
    w.db.flush()
    return v


def keys(s, prefix):
    return [x[1] for x in s.sent if x[1].startswith(prefix)]


def test_vaccine_evening_before_then_morning_of(world):
    add_vax(world, "BCG")
    add_vax(world, "OPV", dose_label="0")
    s = ParamSender()
    tick(world.db, EVE - timedelta(minutes=1), s)
    assert keys(s, "vaccine") == []
    tick(world.db, EVE, s)
    assert sorted(keys(s, "vaccine")) == ["vaccine_eve", "vaccine_eve"]  # one message per caregiver, both vaccines in it
    assert s.recipients() == ids(world, "owner", "mom")
    assert "BCG" in s.params[-1]["vaccines"] and "OPV 0" in s.params[-1]["vaccines"]
    assert {x[3] for x in s.sent} == {"/?log=vaccine"}
    s.sent.clear()
    tick(world.db, EVE + timedelta(hours=1), s)
    assert keys(s, "vaccine") == []
    tick(world.db, MORNING, s)
    assert keys(s, "vaccine") == ["vaccine_today", "vaccine_today"]


def test_each_moment_fires_once_and_survives_restart(world):
    v = add_vax(world)
    s = FakeSender()
    tick(world.db, EVE, s)
    world.db.expire_all()  # a new worker process reads only what was committed
    tick(world.db, EVE + timedelta(minutes=1), s)
    tick(world.db, MORNING, s)
    tick(world.db, MORNING + timedelta(minutes=30), s)
    assert sorted(keys(s, "vaccine")) == ["vaccine_eve"] * 2 + ["vaccine_today"] * 2
    states = world.db.query(ReminderState).filter_by(kind="vaccine", subject_id=v.id).all()
    assert sorted(x.anchor_at for x in states) == [EVE, MORNING]


def test_given_skipped_deleted_vaccine_never_reminds(world):
    add_vax(world, "A", status="given")
    add_vax(world, "B", status="skipped")
    add_vax(world, "C", deleted_at=LONG_AGO)
    add_vax(world, "D", due=DUE + timedelta(days=1))  # not due yet
    s = FakeSender()
    tick(world.db, EVE, s)
    tick(world.db, MORNING, s)
    assert keys(s, "vaccine") == []


def test_retry_when_every_send_failed(world):
    add_vax(world)
    failing = FakeSender({f"https://push.test/{n}": "error" for n in ("owner", "mom", "aunt")})
    tick(world.db, EVE, failing)
    assert world.db.query(ReminderState).filter_by(kind="vaccine").count() == 0
    s = FakeSender()
    tick(world.db, EVE + timedelta(minutes=1), s)
    assert keys(s, "vaccine") == ["vaccine_eve", "vaccine_eve"]


VISIT_AT = at(DUE, 11)


def test_visit_evening_before_and_one_hour_before(world):
    add_visit(world, VISIT_AT)
    s = ParamSender()
    tick(world.db, EVE, s)
    assert keys(s, "visit") == ["visit_eve", "visit_eve"] and {x[3] for x in s.sent} == {"/?log=visit"}
    assert s.params[-1]["time"] == "11:00 AM" and "Dr Rao" in s.params[-1]["what"]
    s.sent.clear()
    tick(world.db, VISIT_AT - timedelta(hours=1, minutes=1), s)
    assert keys(s, "visit") == []
    tick(world.db, VISIT_AT - timedelta(hours=1), s)
    tick(world.db, VISIT_AT - timedelta(minutes=30), s)
    assert keys(s, "visit") == ["visit_soon", "visit_soon"]


def test_just_after_midnight_visit_gets_both_moments(world):
    # 00:30 on the 20th: evening before is 18:00 on the 19th, one hour before is 23:30 on the 19th
    add_visit(world, at(DUE, 0, 30))
    s = FakeSender()
    tick(world.db, EVE, s)
    tick(world.db, at(DUE - timedelta(days=1), 23, 30), s)
    assert keys(s, "visit") == ["visit_eve"] * 2 + ["visit_soon"] * 2


def test_cancelled_or_done_visit_never_reminds(world):
    add_visit(world, VISIT_AT, status="cancelled")
    add_visit(world, VISIT_AT, status="done")
    add_visit(world, VISIT_AT, deleted_at=LONG_AGO)
    s = FakeSender()
    tick(world.db, EVE, s)
    tick(world.db, VISIT_AT - timedelta(hours=1), s)
    assert keys(s, "visit") == []


def test_rescheduled_visit_reminds_for_the_new_time(world):
    v = add_visit(world, VISIT_AT)
    s = FakeSender()
    tick(world.db, EVE, s)
    v.scheduled_at = VISIT_AT + timedelta(days=1)
    world.db.flush()
    tick(world.db, EVE + timedelta(days=1), s)
    assert keys(s, "visit") == ["visit_eve"] * 4


def test_a_late_tick_after_a_sleep_skips_old_moments(world):
    add_vax(world)
    add_visit(world, VISIT_AT)
    s = FakeSender()
    tick(world.db, EVE + timedelta(hours=3, minutes=1), s)  # the Mac slept through the evening reminder
    assert keys(s, "vaccine") == [] and keys(s, "visit") == []
    tick(world.db, MORNING + timedelta(hours=2), s)  # within 3 hours of the morning one
    assert keys(s, "vaccine") == ["vaccine_today"] * 2


def test_created_after_the_moment_is_not_reminded(world):
    add_vax(world, created_at=EVE + timedelta(minutes=5))
    add_visit(world, VISIT_AT, created_at=EVE + timedelta(minutes=5))
    s = FakeSender()
    tick(world.db, EVE + timedelta(minutes=10), s)
    assert keys(s, "vaccine") == [] and keys(s, "visit") == []
    tick(world.db, MORNING, s)
    assert keys(s, "vaccine") == ["vaccine_today"] * 2


def test_prefs_off_skips_user_and_viewers_never_get_them(world):
    world.db.add(NotificationPref(user_id=world.users["mom"].id, kind="vaccine", enabled=False))
    world.db.add(NotificationPref(user_id=world.users["owner"].id, kind="visit", enabled=False))
    world.db.flush()
    add_vax(world)
    add_visit(world, VISIT_AT)
    s = FakeSender()
    tick(world.db, EVE, s)
    got = {(x[0], x[1]) for x in s.sent}
    assert got == {(world.users["owner"].id, "vaccine_eve"), (world.users["mom"].id, "visit_eve")}


def test_family_timezone_is_used_around_midnight(world):
    # due 20 Nov in Kolkata: the evening-before moment is 18:00 IST on the 19th (12:30 UTC), not 18:00 UTC
    add_vax(world)
    s = FakeSender()
    tick(world.db, datetime(2026, 11, 19, 12, 30, tzinfo=UTC), s)
    assert keys(s, "vaccine") == ["vaccine_eve"] * 2
    # a visit just after midnight IST on the 20th (18:45 UTC on the 19th) belongs to the 20th: its evening-before
    # moment is 18:00 IST on the 19th
    add_visit(world, at(DUE, 0, 15), created_at=LONG_AGO)
    s2 = FakeSender()
    tick(world.db, datetime(2026, 11, 19, 12, 31, tzinfo=UTC), s2)
    assert keys(s2, "visit") == ["visit_eve"] * 2
