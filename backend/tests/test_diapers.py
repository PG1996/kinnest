import uuid
from datetime import UTC, datetime, timedelta


def _diaper(minutes_ago=0, kind="wet"):
    return {
        "id": str(uuid.uuid4()),
        "kind": kind,
        "at": (datetime.now(UTC) - timedelta(minutes=minutes_ago)).isoformat(),
    }


def test_post_diaper_idempotent(family):
    body = _diaper()
    assert family.mom.post("/api/diapers", json=body).status_code == 201
    assert family.mom.post("/api/diapers", json=body).status_code == 200
    assert len(family.aunt.get("/api/diapers").json()) == 1


def test_diaper_rules(family):
    assert family.mom.post("/api/diapers", json=_diaper(minutes_ago=-10)).status_code == 422
    assert family.mom.post("/api/diapers", json=_diaper(kind="mud")).status_code == 422
    assert family.aunt.post("/api/diapers", json=_diaper()).status_code == 403


def test_diaper_warning_patch_delete(family):
    first = _diaper(minutes_ago=1)
    family.owner.post("/api/diapers", json=first)
    r = family.mom.post("/api/diapers", json=_diaper()).json()
    assert r["recent_other"]["user_name"] == "owner"
    assert family.mom.patch(f"/api/diapers/{first['id']}", json={"kind": "both"}).json()["kind"] == "both"
    assert family.mom.delete(f"/api/diapers/{first['id']}").status_code == 200
    assert len(family.mom.get("/api/diapers").json()) == 1


def test_unknown_changed_by_user_is_422(family):
    body = {**_diaper(), "changed_by_user_id": str(uuid.uuid4())}
    assert family.mom.post("/api/diapers", json=body).status_code == 422


def test_race_on_same_id_returns_existing_diaper(family, db_session, monkeypatch):
    from app.models import Diaper

    body = _diaper()
    assert family.mom.post("/api/diapers", json=body).status_code == 201
    db_session.expunge_all()
    real_get = type(db_session).get
    calls = []

    def blind_first_get(self, entity, ident, *a, **k):
        if entity is Diaper:
            calls.append(ident)
            if len(calls) == 1:
                return None  # the id looks unused to this request, though a concurrent one just stored it
        return real_get(self, entity, ident, *a, **k)

    monkeypatch.setattr(type(db_session), "get", blind_first_get)
    again = family.mom.post("/api/diapers", json=body)
    assert again.status_code == 200
    assert db_session.query(Diaper).count() == 1
