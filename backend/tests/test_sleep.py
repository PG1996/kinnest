import uuid
from datetime import UTC, datetime, timedelta

from app.models import SleepSession


def ago(minutes):
    return (datetime.now(UTC) - timedelta(minutes=minutes)).isoformat()


def start(client, minutes_ago=0, **kw):
    body = {"id": str(uuid.uuid4()), "started_at": ago(minutes_ago)}
    body.update(kw)
    return client.post("/api/sleep", json=body), body


def test_start_sleep_201_then_same_id_200(family, db_session):
    r, body = start(family.mom, 10)
    assert r.status_code == 201 and r.json()["id"] == body["id"] and r.json()["started_by_name"] == "mom"
    assert r.json()["ended_at"] is None and r.json()["duration_min"] is None
    again = family.mom.post("/api/sleep", json=body)
    assert again.status_code == 200 and db_session.query(SleepSession).count() == 1


def test_start_while_open_is_409_with_the_open_session(family, db_session):
    first, a = start(family.mom, 20)
    r, _ = start(family.owner, 1)
    assert r.status_code == 409
    assert r.json()["open"]["id"] == a["id"] and r.json()["open"]["started_by_name"] == "mom"
    assert db_session.query(SleepSession).count() == 1


def test_concurrent_start_race_also_returns_409(family, db_session, monkeypatch):
    from app.api import sleep as sleep_api

    _, a = start(family.mom, 20)
    real = sleep_api._open_session
    calls = []

    def blind_first(db, kid_id):
        calls.append(1)
        return None if len(calls) == 1 else real(db, kid_id)  # the other request had not committed yet

    monkeypatch.setattr(sleep_api, "_open_session", blind_first)
    r, _ = start(family.owner, 1)
    assert r.status_code == 409 and r.json()["open"]["id"] == a["id"]


def test_end_sleep_sets_duration(family):
    _, body = start(family.mom, 90)
    r = family.owner.post(f"/api/sleep/{body['id']}/end", json={"ended_at": ago(30)})
    assert r.status_code == 200 and r.json()["duration_min"] == 60 and r.json()["ended_by_name"] == "owner"


def test_end_before_start_is_422(family):
    _, body = start(family.mom, 30)
    assert family.mom.post(f"/api/sleep/{body['id']}/end", json={"ended_at": ago(60)}).status_code == 422


def test_end_is_idempotent_for_same_time(family):
    _, body = start(family.mom, 90)
    ended = ago(30)
    assert family.mom.post(f"/api/sleep/{body['id']}/end", json={"ended_at": ended}).status_code == 200
    assert family.mom.post(f"/api/sleep/{body['id']}/end", json={"ended_at": ended}).status_code == 200
    assert family.mom.post(f"/api/sleep/{body['id']}/end", json={"ended_at": ago(10)}).status_code == 409


def test_future_times_rejected(family):
    assert start(family.mom, -10)[0].status_code == 422
    _, body = start(family.mom, 5)
    assert family.mom.post(f"/api/sleep/{body['id']}/end", json={"ended_at": ago(-10)}).status_code == 422


def test_viewer_cannot_start_or_end_but_can_read(family):
    assert start(family.aunt)[0].status_code == 403
    _, body = start(family.mom, 30)
    assert family.aunt.post(f"/api/sleep/{body['id']}/end", json={"ended_at": ago(1)}).status_code == 403
    assert len(family.aunt.get("/api/sleep").json()) == 1


def test_can_start_a_new_session_after_ending_or_deleting(family):
    _, a = start(family.mom, 60)
    family.mom.post(f"/api/sleep/{a['id']}/end", json={"ended_at": ago(30)})
    r, b = start(family.mom, 10)
    assert r.status_code == 201
    assert family.mom.delete(f"/api/sleep/{b['id']}").status_code == 200
    assert start(family.mom, 5)[0].status_code == 201


def test_patch_validates_and_updates(family):
    _, body = start(family.mom, 60)
    family.mom.post(f"/api/sleep/{body['id']}/end", json={"ended_at": ago(30)})
    ok = family.owner.patch(f"/api/sleep/{body['id']}", json={"note": "woke early", "started_at": ago(120)})
    assert ok.status_code == 200 and ok.json()["note"] == "woke early" and ok.json()["duration_min"] in (89, 90)  # the two times are computed a few ms apart
    assert family.owner.patch(f"/api/sleep/{body['id']}", json={"started_at": ago(5)}).status_code == 422  # after the end
    assert family.aunt.patch(f"/api/sleep/{body['id']}", json={"note": "x"}).status_code == 403


def test_history_newest_first_with_range(family):
    for minutes in (600, 300):
        _, b = start(family.mom, minutes)
        family.mom.post(f"/api/sleep/{b['id']}/end", json={"ended_at": ago(minutes - 60)})
    rows = family.aunt.get("/api/sleep").json()
    assert len(rows) == 2 and rows[0]["started_at"] > rows[1]["started_at"]
    assert len(family.aunt.get("/api/sleep", params={"from": ago(400)}).json()) == 1


def test_reopening_an_ended_session_while_another_is_open_is_409_not_500(family, db_session):
    _, a = start(family.mom, 120)
    family.mom.post(f"/api/sleep/{a['id']}/end", json={"ended_at": ago(90)})
    _, b = start(family.mom, 10)  # b is open now
    r = family.owner.patch(f"/api/sleep/{a['id']}", json={"ended_at": None})
    assert r.status_code == 409 and r.json()["open"]["id"] == b["id"]
    assert db_session.get(SleepSession, uuid.UUID(a["id"])).ended_at is not None  # unchanged


def test_reopening_clears_who_ended_it_when_nothing_else_is_open(family):
    _, a = start(family.mom, 120)
    family.mom.post(f"/api/sleep/{a['id']}/end", json={"ended_at": ago(90)})
    r = family.owner.patch(f"/api/sleep/{a['id']}", json={"ended_at": None})
    assert r.status_code == 200 and r.json()["ended_at"] is None and r.json()["ended_by_name"] is None
    assert family.aunt.get("/api/summary").json()["sleep"]["open"]["id"] == a["id"]
