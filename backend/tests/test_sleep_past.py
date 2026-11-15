import uuid
from datetime import UTC, datetime, timedelta

from app.models import SleepSession

URL = "/api/sleep/past"


def ago(hours: float) -> str:
    return (datetime.now(UTC) - timedelta(hours=hours)).isoformat()


def past(start_h: float, end_h: float, **kw) -> dict:
    return {"id": str(uuid.uuid4()), "started_at": ago(start_h), "ended_at": ago(end_h), **kw}


def test_a_finished_past_sleep_is_recorded(family, db_session):
    body = past(30, 27, note="after bath")
    r = family.mom.post(URL, json=body)
    assert r.status_code == 201, r.text
    got = r.json()
    assert got["duration_min"] == 180 and got["note"] == "after bath" and got["ended_at"] is not None
    assert got["started_by_name"] and got["ended_by_name"]
    assert db_session.get(SleepSession, uuid.UUID(body["id"])).ended_at is not None


def test_a_past_sleep_can_be_added_while_she_is_asleep_now(family):
    assert family.mom.post("/api/sleep", json={"id": str(uuid.uuid4()), "started_at": ago(1)}).status_code == 201
    assert family.mom.post(URL, json=past(10, 8)).status_code == 201


def test_same_id_twice_keeps_one(family, db_session):
    body = past(10, 8)
    assert family.mom.post(URL, json=body).status_code == 201
    assert family.mom.post(URL, json=body).status_code == 200
    assert db_session.query(SleepSession).filter_by(id=uuid.UUID(body["id"])).count() == 1


def test_overlapping_another_sleep_is_refused_with_the_other_one(family):
    first = past(10, 8)
    family.mom.post(URL, json=first)
    r = family.mom.post(URL, json=past(9, 7))
    assert r.status_code == 409
    assert r.json()["overlaps"]["id"] == first["id"]
    assert family.mom.post(URL, json=past(8, 7)).status_code == 201  # touching end to start is fine


def test_overlapping_the_sleep_happening_now_is_refused(family):
    family.mom.post("/api/sleep", json={"id": str(uuid.uuid4()), "started_at": ago(2)})
    assert family.mom.post(URL, json=past(3, 1)).status_code == 409


def test_bad_times_are_refused(family):
    assert family.mom.post(URL, json=past(5, 6)).status_code == 422  # ends before it starts
    same = ago(5)
    assert family.mom.post(URL, json={"id": str(uuid.uuid4()), "started_at": same, "ended_at": same}).status_code == 422  # no length
    assert family.mom.post(URL, json={"id": str(uuid.uuid4()), "started_at": ago(2), "ended_at": ago(-2)}).status_code == 422  # future
    assert family.mom.post(URL, json=past(40, 10)).status_code == 422  # longer than 24 hours


def still_asleep(start_h: float) -> dict:
    return {"id": str(uuid.uuid4()), "started_at": ago(start_h), "ended_at": None}


def test_a_past_sleep_still_going_is_recorded_as_open(family, db_session):
    body = still_asleep(2)
    r = family.mom.post(URL, json=body)
    assert r.status_code == 201, r.text
    assert r.json()["ended_at"] is None and r.json()["duration_min"] is None
    assert db_session.get(SleepSession, uuid.UUID(body["id"])).ended_at is None
    # it is the sleep going on now: the summary shows it and starting another is refused
    assert family.mom.get("/api/summary").json()["sleep"]["open"]["id"] == body["id"]
    assert family.mom.post("/api/sleep", json={"id": str(uuid.uuid4()), "started_at": ago(0.1)}).status_code == 409


def test_a_past_sleep_still_going_needs_no_other_sleep_going_on(family):
    family.mom.post("/api/sleep", json={"id": str(uuid.uuid4()), "started_at": ago(1)})
    r = family.mom.post(URL, json=still_asleep(3))
    assert r.status_code == 409 and r.json()["detail"] == "already asleep"


def test_a_past_sleep_still_going_may_not_run_over_a_finished_one(family):
    done = past(3, 2)
    family.mom.post(URL, json=done)
    r = family.mom.post(URL, json=still_asleep(4))
    assert r.status_code == 409 and r.json()["overlaps"]["id"] == done["id"]
    assert family.mom.post(URL, json=still_asleep(1.5)).status_code == 201  # starting after it woke up is fine


def test_a_past_sleep_still_going_is_held_to_24_hours_and_no_future_start(family):
    assert family.mom.post(URL, json=still_asleep(25)).status_code == 422
    assert family.mom.post(URL, json=still_asleep(-1)).status_code == 422


def test_viewer_cannot_add_past_sleep(family):
    assert family.aunt.post(URL, json=past(10, 8)).status_code == 403


def test_editing_a_sleep_into_another_one_is_refused(family):
    a, b = past(10, 8), past(6, 5)
    family.mom.post(URL, json=a)
    family.mom.post(URL, json=b)
    r = family.mom.patch(f"/api/sleep/{b['id']}", json={"started_at": ago(9)})
    assert r.status_code == 409 and r.json()["overlaps"]["id"] == a["id"]
    assert family.mom.patch(f"/api/sleep/{b['id']}", json={"started_at": ago(7)}).status_code == 200
