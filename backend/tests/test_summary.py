import uuid
from datetime import UTC, datetime, timedelta

from app.models import Diaper, Feed, Kid
from app.services.summary import build_summary


def _post_feed(client, minutes_ago, **kw):
    body = {
        "id": str(uuid.uuid4()),
        "type": "formula",
        "quantity_ml": 60,
        "started_at": (datetime.now(UTC) - timedelta(minutes=minutes_ago)).isoformat(),
    }
    body.update(kw)
    assert client.post("/api/feeds", json=body).status_code == 201
    return body


def test_summary_empty(family):
    s = family.aunt.get("/api/summary").json()
    assert s["last_feed"] is None and s["next_feed_due_at"] is None and s["feeds_today"] == 0


def test_summary_next_due_is_last_feed_plus_interval(family):
    _post_feed(family.mom, 300)
    last = _post_feed(family.mom, 60)
    s = family.aunt.get("/api/summary").json()
    assert s["last_feed"]["id"] == last["id"]
    assert s["last_feed"]["fed_by_name"] == "mom"
    due = datetime.fromisoformat(s["next_feed_due_at"])
    assert due == datetime.fromisoformat(last["started_at"]) + timedelta(minutes=180)
    family.owner.patch("/api/kid", json={"feed_interval_minutes": 120})
    due = datetime.fromisoformat(family.aunt.get("/api/summary").json()["next_feed_due_at"])
    assert due == datetime.fromisoformat(last["started_at"]) + timedelta(minutes=120)


def test_deleted_feed_ignored_in_summary(family):
    older = _post_feed(family.mom, 120)
    newer = _post_feed(family.mom, 10)
    family.mom.delete(f"/api/feeds/{newer['id']}")
    assert family.aunt.get("/api/summary").json()["last_feed"]["id"] == older["id"]


def test_summary_today_boundary_uses_kolkata_midnight(family, db_session):
    kid = db_session.query(Kid).one()
    uid = family.mom.get("/api/me").json()["user"]["id"]
    now = datetime(2026, 11, 4, 20, 0, tzinfo=UTC)  # 01:30 on 5 Nov in Kolkata

    def feed(ts):
        return Feed(
            id=uuid.uuid4(), family_id=kid.family_id, kid_id=kid.id, type="formula", started_at=ts,
            fed_by_user_id=uid, created_by=uid, updated_by=uid,
        )

    db_session.add_all(
        [
            feed(datetime(2026, 11, 4, 17, 0, tzinfo=UTC)),  # 22:30 on 4 Nov IST -> yesterday
            feed(datetime(2026, 11, 4, 19, 0, tzinfo=UTC)),  # 00:30 on 5 Nov IST -> today
            Diaper(id=uuid.uuid4(), family_id=kid.family_id, kid_id=kid.id, kind="wet",
                   at=datetime(2026, 11, 4, 19, 30, tzinfo=UTC), changed_by_user_id=uid,
                   created_by=uid, updated_by=uid),
            Diaper(id=uuid.uuid4(), family_id=kid.family_id, kid_id=kid.id, kind="both",
                   at=datetime(2026, 11, 4, 19, 40, tzinfo=UTC), changed_by_user_id=uid,
                   created_by=uid, updated_by=uid),
        ]
    )
    db_session.flush()
    s = build_summary(db_session, kid, now)
    assert s.feeds_today == 1
    assert s.diapers_today == {"wet": 1, "dirty": 0, "both": 1}
