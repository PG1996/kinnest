import uuid
from datetime import UTC, datetime, timedelta

from app.models import FeedTimer
from app.worker.reminders import tick
from tests.test_reminders import BASE, DUE, FakeSender, add_feed, world  # noqa: F401  (world is a fixture)


def _timer(minutes_ago=5, **kw):
    body = {"id": str(uuid.uuid4()), "type": "breast_left", "started_at": (datetime.now(UTC) - timedelta(minutes=minutes_ago)).isoformat()}
    body.update(kw)
    return body


def test_start_returns_the_timer_and_everyone_can_read_it(family):
    body = _timer()
    r = family.mom.post("/api/feed-timer", json=body)
    assert r.status_code == 201
    t = r.json()
    assert t["id"] == body["id"] and t["type"] == "breast_left" and t["ended_at"] is None and t["started_by_name"] == "mom"
    for who in (family.owner, family.aunt):  # a viewer too
        assert who.get("/api/feed-timer").json()["id"] == body["id"]


def test_no_timer_reads_as_null(family):
    assert family.aunt.get("/api/feed-timer").json() is None


def test_starting_again_with_the_same_id_is_safe_and_a_second_timer_is_refused(family, db_session):
    body = _timer()
    assert family.mom.post("/api/feed-timer", json=body).status_code == 201
    again = family.mom.post("/api/feed-timer", json=body)
    assert again.status_code == 200 and again.json()["id"] == body["id"]
    other = family.owner.post("/api/feed-timer", json=_timer())
    assert other.status_code == 409 and other.json()["detail"]["timer"]["id"] == body["id"]  # says which is running
    assert db_session.query(FeedTimer).count() == 1


def test_a_viewer_cannot_start_change_or_discard_a_timer(family):
    assert family.aunt.post("/api/feed-timer", json=_timer()).status_code == 403
    family.mom.post("/api/feed-timer", json=_timer())
    assert family.aunt.patch("/api/feed-timer", json={"type": "formula"}).status_code == 403
    assert family.aunt.delete("/api/feed-timer").status_code == 403


def test_the_start_cannot_be_in_the_future(family):
    assert family.mom.post("/api/feed-timer", json=_timer(minutes_ago=-30)).status_code == 422


def test_the_summary_carries_the_running_timer(family):
    assert family.aunt.get("/api/summary").json()["feed_timer"] is None
    body = _timer()
    family.mom.post("/api/feed-timer", json=body)
    assert family.aunt.get("/api/summary").json()["feed_timer"]["id"] == body["id"]


def test_the_type_can_change_while_it_runs_and_it_can_be_stopped_and_resumed(family):
    family.mom.post("/api/feed-timer", json=_timer(minutes_ago=10))
    assert family.owner.patch("/api/feed-timer", json={"type": "breast_right"}).json()["type"] == "breast_right"
    stopped = family.owner.patch("/api/feed-timer", json={"ended_at": datetime.now(UTC).isoformat()}).json()
    assert stopped["ended_at"] is not None
    resumed = family.mom.patch("/api/feed-timer", json={"ended_at": None}).json()
    assert resumed["ended_at"] is None
    assert family.mom.patch("/api/feed-timer", json={"type": "nope"}).status_code == 422


def test_a_stop_before_the_start_is_refused(family):
    t = family.mom.post("/api/feed-timer", json=_timer(minutes_ago=10)).json()
    early = (datetime.fromisoformat(t["started_at"]) - timedelta(minutes=1)).isoformat()
    assert family.mom.patch("/api/feed-timer", json={"ended_at": early}).status_code == 422


def test_discarding_removes_it_and_a_new_one_can_start(family):
    family.mom.post("/api/feed-timer", json=_timer())
    assert family.owner.delete("/api/feed-timer").status_code == 200
    assert family.aunt.get("/api/feed-timer").json() is None
    assert family.mom.post("/api/feed-timer", json=_timer()).status_code == 201
    assert family.owner.delete("/api/feed-timer").status_code == 200
    assert family.owner.delete("/api/feed-timer").status_code == 200  # nothing there: still fine


def test_saving_the_feed_with_the_timer_id_removes_the_timer(family, db_session):
    t = family.mom.post("/api/feed-timer", json=_timer(minutes_ago=12)).json()
    feed = {"id": str(uuid.uuid4()), "type": "breast_left", "started_at": t["started_at"], "duration_min": 12, "timer_id": t["id"]}
    assert family.mom.post("/api/feeds", json=feed).status_code == 201
    assert family.aunt.get("/api/feed-timer").json() is None
    # a retry of the same save (the phone was offline) is fine: the timer is already gone
    assert family.mom.post("/api/feeds", json=feed).status_code == 200


def test_a_feed_with_someone_elses_or_unknown_timer_id_is_still_saved(family):
    feed = {"id": str(uuid.uuid4()), "type": "formula", "quantity_ml": 60, "started_at": datetime.now(UTC).isoformat(), "timer_id": str(uuid.uuid4())}
    assert family.mom.post("/api/feeds", json=feed).status_code == 201


def test_no_feed_reminder_while_a_feed_is_being_timed(world, db_session):  # noqa: F811
    add_feed(world, BASE)
    db_session.add(FeedTimer(id=uuid.uuid4(), family_id=world.kid.family_id, kid_id=world.kid.id, type="breast_left",
                             started_at=DUE, started_by_user_id=world.users["mom"].id))
    db_session.flush()
    s = FakeSender()
    tick(db_session, DUE + timedelta(minutes=20), s)
    assert [x for x in s.sent if x[1].startswith("feed")] == []
