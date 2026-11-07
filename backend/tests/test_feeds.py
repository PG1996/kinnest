import uuid
from datetime import UTC, datetime, timedelta

from app.models import Feed


def _feed(minutes_ago=0, **kw):
    body = {
        "id": str(uuid.uuid4()),
        "type": "formula",
        "started_at": (datetime.now(UTC) - timedelta(minutes=minutes_ago)).isoformat(),
        "quantity_ml": 60,
    }
    body.update(kw)
    return body


def test_post_feed_twice_same_id_keeps_one_row(family, db_session):
    body = _feed()
    assert family.mom.post("/api/feeds", json=body).status_code == 201
    again = family.mom.post("/api/feeds", json=body)
    assert again.status_code == 200 and again.json()["id"] == body["id"]
    assert db_session.query(Feed).count() == 1


def test_future_timestamp_rejected(family):
    assert family.mom.post("/api/feeds", json=_feed(minutes_ago=-10)).status_code == 422
    assert family.mom.post("/api/feeds", json=_feed(minutes_ago=-2)).status_code == 201
    assert family.mom.post("/api/feeds", json=_feed(minutes_ago=60 * 24 * 3)).status_code == 201


def test_naive_timestamp_rejected(family):
    assert family.mom.post("/api/feeds", json=_feed(started_at="2026-11-04T10:00:00")).status_code == 422


def test_second_caregiver_gets_recent_other_warning(family):
    first = family.owner.post("/api/feeds", json=_feed(minutes_ago=1)).json()
    assert first["recent_other"] is None
    second = family.mom.post("/api/feeds", json=_feed()).json()
    assert second["recent_other"]["user_name"] == "owner"
    assert family.mom.post("/api/feeds", json=_feed()).json()["recent_other"]["user_name"] == "owner"
    assert family.owner.post("/api/feeds", json=_feed(minutes_ago=-1)).json()["recent_other"]["user_name"] == "mom"


def test_viewer_post_is_403(family):
    assert family.aunt.post("/api/feeds", json=_feed()).status_code == 403
    assert family.aunt.get("/api/feeds").status_code == 200


def test_patch_and_soft_delete(family, db_session):
    body = _feed(minutes_ago=5)
    family.mom.post("/api/feeds", json=body)
    r = family.owner.patch(f"/api/feeds/{body['id']}", json={"quantity_ml": 90, "note": "burped"})
    assert r.status_code == 200 and r.json()["quantity_ml"] == 90
    assert family.mom.delete(f"/api/feeds/{body['id']}").status_code == 200
    assert family.aunt.get("/api/feeds").json() == []
    assert db_session.query(Feed).count() == 1  # soft delete keeps the row


def test_list_filters_by_range(family):
    old, new = _feed(minutes_ago=60 * 24 * 2), _feed(minutes_ago=10)
    family.mom.post("/api/feeds", json=old)
    family.mom.post("/api/feeds", json=new)
    since = (datetime.now(UTC) - timedelta(hours=1)).isoformat()
    ids = [f["id"] for f in family.aunt.get("/api/feeds", params={"from": since}).json()]
    assert ids == [new["id"]]


def test_breast_feed_needs_no_quantity(family):
    body = _feed(type="breast_left", quantity_ml=None, duration_min=12)
    assert family.mom.post("/api/feeds", json=body).status_code == 201
    assert family.mom.post("/api/feeds", json=_feed(type="soup")).status_code == 422


def test_same_person_logging_twice_is_not_warned(family):
    family.mom.post("/api/feeds", json=_feed(minutes_ago=1))
    assert family.mom.post("/api/feeds", json=_feed()).json()["recent_other"] is None


def test_unknown_fed_by_user_is_422(family, db_session):
    from app.models import User

    stranger = User(email="stranger@elsewhere.com", name="S")
    db_session.add(stranger)
    db_session.flush()
    for who in (str(uuid.uuid4()), str(stranger.id)):
        assert family.mom.post("/api/feeds", json=_feed(fed_by_user_id=who)).status_code == 422
    mom = family.mom.get("/api/me").json()["user"]["id"]
    assert family.owner.post("/api/feeds", json=_feed(fed_by_user_id=mom)).status_code == 201


def test_race_on_same_id_returns_existing_row(family, db_session, monkeypatch):
    body = _feed()
    assert family.mom.post("/api/feeds", json=body).status_code == 201
    db_session.expunge_all()  # a second request has its own session and has not seen the row yet
    real_get = type(db_session).get
    calls = []

    def blind_first_get(self, entity, ident, *a, **k):
        if entity is Feed:
            calls.append(ident)
            if len(calls) == 1:
                return None  # the id looks unused to this request, though a concurrent one just stored it
        return real_get(self, entity, ident, *a, **k)

    monkeypatch.setattr(type(db_session), "get", blind_first_get)
    again = family.mom.post("/api/feeds", json=body)
    assert again.status_code == 200 and again.json()["id"] == body["id"]
    assert db_session.query(Feed).count() == 1
