import uuid
from datetime import UTC, datetime, timedelta

import pytest

from app.models import Diaper, Feed, Kid, NotificationPref, PushSubscription, ReminderState, User
from app.worker.reminders import tick

BASE = datetime(2026, 11, 4, 10, 0, tzinfo=UTC)  # last feed time
DUE = BASE + timedelta(minutes=180)


class FakeSender:
    def __init__(self, results=None):
        self.sent = []
        self.results = results or {}

    def __call__(self, sub, title_key, body_params, urgency, url="/"):
        self.sent.append((sub.user_id, title_key, urgency, url))
        return self.results.get(sub.endpoint, "ok")

    def recipients(self):
        return {s[0] for s in self.sent}


@pytest.fixture
def world(family, db_session):
    from types import SimpleNamespace

    users = {n: db_session.query(User).filter_by(email=e).one() for n, e in
             [("owner", "owner@x.com"), ("mom", "mom@x.com"), ("aunt", "aunt@x.com")]}
    for name, u in users.items():
        db_session.add(PushSubscription(user_id=u.id, endpoint=f"https://push.test/{name}", p256dh="k", auth="a"))
    kid = db_session.query(Kid).one()
    db_session.flush()
    return SimpleNamespace(db=db_session, users=users, kid=kid)


def add_feed(w, at):
    u = w.users["mom"]
    w.db.add(Feed(id=uuid.uuid4(), family_id=w.kid.family_id, kid_id=w.kid.id, type="formula", started_at=at,
                  fed_by_user_id=u.id, created_by=u.id, updated_by=u.id))
    w.db.flush()


def add_diaper(w, at):
    u = w.users["mom"]
    w.db.add(Diaper(id=uuid.uuid4(), family_id=w.kid.family_id, kid_id=w.kid.id, kind="wet", at=at,
                    changed_by_user_id=u.id, created_by=u.id, updated_by=u.id))
    w.db.flush()


def ids(w, *names):
    return {w.users[n].id for n in names}


def test_no_feed_logged_ever_sends_nothing(world):
    s = FakeSender()
    assert tick(world.db, DUE + timedelta(hours=5), s) == []
    assert s.sent == []


def test_no_reminder_before_due(world):
    add_feed(world, BASE)
    s = FakeSender()
    tick(world.db, DUE - timedelta(minutes=1), s)
    assert s.sent == []


def test_level0_at_due_goes_to_all_caregivers_not_viewers(world):
    add_feed(world, BASE)
    s = FakeSender()
    tick(world.db, DUE, s)
    assert s.recipients() == ids(world, "owner", "mom")
    assert {x[1] for x in s.sent} == {"feed_due"} and {x[2] for x in s.sent} == {"normal"}
    assert {x[3] for x in s.sent} == {"/?log=feed"}


def test_level1_after_15_min_if_unlogged(world):
    add_feed(world, BASE)
    s = FakeSender()
    tick(world.db, DUE, s)
    s.sent.clear()
    tick(world.db, DUE + timedelta(minutes=14), s)
    assert s.sent == []
    tick(world.db, DUE + timedelta(minutes=15), s)
    assert s.recipients() == ids(world, "owner", "mom") and {x[1] for x in s.sent} == {"feed_due_again"}
    s.sent.clear()
    tick(world.db, DUE + timedelta(minutes=16), s)
    assert s.sent == []


def test_level2_after_30_min_goes_only_to_admin_high_urgency(world):
    add_feed(world, BASE)
    s = FakeSender()
    for m in (0, 15):
        tick(world.db, DUE + timedelta(minutes=m), s)
    s.sent.clear()
    tick(world.db, DUE + timedelta(minutes=30), s)
    assert s.sent == [(world.users["owner"].id, "feed_overdue_admin", "high", "/?log=feed")]


def test_logging_feed_stops_chain(world):
    add_feed(world, BASE)
    s = FakeSender()
    tick(world.db, DUE, s)
    add_feed(world, DUE + timedelta(minutes=5))
    s.sent.clear()
    tick(world.db, DUE + timedelta(minutes=20), s)
    tick(world.db, DUE + timedelta(minutes=40), s)
    assert s.sent == []


def test_restart_does_not_resend_same_level(world):
    add_feed(world, BASE)
    tick(world.db, DUE, FakeSender())
    after_restart = FakeSender()
    tick(world.db, DUE, after_restart)
    tick(world.db, DUE + timedelta(minutes=1), after_restart)
    assert after_restart.sent == []
    assert world.db.query(ReminderState).filter_by(kind="feed").one().level == 0


def test_catch_up_after_outage_sends_one_level_per_tick(world):
    add_feed(world, BASE)
    s = FakeSender()
    late = DUE + timedelta(minutes=40)
    tick(world.db, late, s)
    assert {x[1] for x in s.sent} == {"feed_due"}
    s.sent.clear()
    tick(world.db, late + timedelta(minutes=1), s)
    assert {x[1] for x in s.sent} == {"feed_due_again"}
    s.sent.clear()
    tick(world.db, late + timedelta(minutes=2), s)
    assert {x[1] for x in s.sent} == {"feed_overdue_admin"}


def test_gone_subscription_deleted_and_others_still_sent(world):
    add_feed(world, BASE)
    s = FakeSender({"https://push.test/owner": "gone"})
    tick(world.db, DUE, s)
    assert s.recipients() == ids(world, "owner", "mom")
    left = {p.endpoint for p in world.db.query(PushSubscription)}
    assert "https://push.test/owner" not in left and "https://push.test/mom" in left


def test_failed_send_is_retried_next_tick(world):
    add_feed(world, BASE)
    down = FakeSender({"https://push.test/owner": "error", "https://push.test/mom": "error"})
    tick(world.db, DUE, down)
    retry = FakeSender()
    tick(world.db, DUE + timedelta(minutes=1), retry)
    assert {x[1] for x in retry.sent} == {"feed_due"}


def test_pref_off_skips_user(world):
    add_feed(world, BASE)
    world.db.add(NotificationPref(user_id=world.users["mom"].id, kind="feed", enabled=False))
    world.db.flush()
    s = FakeSender()
    tick(world.db, DUE, s)
    assert s.recipients() == ids(world, "owner")


def test_diaper_alert_once_per_anchor(world):
    add_diaper(world, BASE)
    s = FakeSender()
    tick(world.db, BASE + timedelta(minutes=239), s)
    assert s.sent == []
    tick(world.db, BASE + timedelta(minutes=240), s)
    assert s.recipients() == ids(world, "owner", "mom") and {x[1] for x in s.sent} == {"diaper_alert"}
    assert {x[3] for x in s.sent} == {"/?log=diaper"}
    s.sent.clear()
    tick(world.db, BASE + timedelta(minutes=300), s)
    assert s.sent == []


def test_old_reminder_state_is_kept_so_a_stale_chain_does_not_storm(world):
    add_feed(world, BASE)
    add_diaper(world, BASE)
    s = FakeSender()
    late = BASE + timedelta(days=10)  # nothing logged for 10 days
    for m in range(3):
        tick(world.db, late + timedelta(minutes=m), s)
    assert sorted({x[1] for x in s.sent}) == ["diaper_alert", "feed_due", "feed_due_again", "feed_overdue_admin"]
    s.sent.clear()
    for m in range(3, 9):
        tick(world.db, late + timedelta(minutes=m), s)
    assert s.sent == []


def test_state_is_committed_per_chain_so_a_later_failure_cannot_cause_resends(world, monkeypatch):
    from app.worker import reminders

    add_feed(world, BASE)
    monkeypatch.setattr(reminders, "_diaper_alert", lambda *a, **k: (_ for _ in ()).throw(RuntimeError("boom")))
    with pytest.raises(RuntimeError):
        tick(world.db, DUE, FakeSender())
    world.db.rollback()
    assert world.db.query(ReminderState).filter_by(kind="feed").one().level == 0


def test_a_crashing_sender_counts_as_a_failed_send_not_a_crashed_tick(world):
    add_feed(world, BASE)

    def sender(sub, title_key, body_params, urgency, url="/"):
        if sub.endpoint.endswith("/mom"):
            raise ConnectionError("push service down")
        return "ok"

    sent = tick(world.db, DUE, sender)
    assert {s.user_id for s in sent} == ids(world, "owner")
    assert world.db.query(ReminderState).filter_by(kind="feed").one().level == 0
