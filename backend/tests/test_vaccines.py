from datetime import date, timedelta

import pytest

from app.models import Vaccination
from app.services.vaccines import add_months, due_date_for, load_templates


def test_add_months_clamps_month_ends_and_handles_leap_day():
    assert add_months(date(2026, 1, 31), 1) == date(2026, 2, 28)
    assert add_months(date(2028, 1, 31), 1) == date(2028, 2, 29)
    assert add_months(date(2028, 2, 29), 12) == date(2029, 2, 28)
    assert add_months(date(2028, 2, 29), 48) == date(2032, 2, 29)
    assert add_months(date(2026, 10, 23), 3) == date(2027, 1, 23)
    assert add_months(date(2026, 8, 31), 1) == date(2026, 9, 30)
    assert add_months(date(2026, 5, 15), 0) == date(2026, 5, 15)


def test_due_dates_from_birth_date():
    birth = date(2026, 10, 23)
    assert due_date_for(birth, {"days": 0}) == birth
    assert due_date_for(birth, {"weeks": 6}) == date(2026, 12, 4)
    assert due_date_for(birth, {"months": 9}) == date(2027, 7, 23)
    assert due_date_for(birth, {"days": 10}) == date(2026, 11, 2)
    with pytest.raises(ValueError):
        due_date_for(birth, {"years": 1})


def test_template_files_are_well_formed():
    templates = load_templates()
    assert set(templates) == {"iap", "uip"}
    for t in templates.values():
        assert t["source_url"].startswith("https://") and t["source_date"] and t["retrieved_on"]
        keys = [(e["name"], e["dose_label"]) for e in t["entries"]]
        assert len(keys) == len(set(keys))
        for e in t["entries"]:
            due_date_for(date(2026, 1, 1), e["due_after"])


def set_birth(family, d):
    assert family.owner.patch("/api/kid", json={"birth_date": d.isoformat()}).status_code == 200


def test_templates_listed_with_source(family):
    got = {t["id"]: t for t in family.aunt.get("/api/vaccines/templates").json()}
    assert set(got) == {"iap", "uip"}
    assert got["uip"]["count"] == len(load_templates()["uip"]["entries"])
    assert got["iap"]["source_url"].startswith("https://") and got["iap"]["source_date"]
    assert got["iap"]["name"] and got["iap"]["description"]


def test_apply_template_fills_the_schedule(family, clock):
    birth = clock.day - timedelta(days=10)
    set_birth(family, birth)
    r = family.mom.post("/api/vaccines/apply-template", json={"template_id": "uip", "mode": "fill"})
    assert r.status_code == 201 and r.json()["created"] == len(load_templates()["uip"]["entries"])
    rows = family.aunt.get("/api/vaccines").json()
    assert len(rows) == r.json()["created"]
    bcg = next(v for v in rows if v["name"] == "BCG")
    assert bcg["due_date"] == birth.isoformat() and bcg["status"] == "pending" and bcg["source"] == "uip"
    penta = next(v for v in rows if v["name"] == "Pentavalent" and v["dose_label"] == "1")
    assert penta["due_date"] == (birth + timedelta(weeks=6)).isoformat()
    assert [v["due_date"] for v in rows] == sorted(v["due_date"] for v in rows)


def test_apply_twice_is_409_and_creates_nothing(family, clock, db_session):
    set_birth(family, clock.day)
    family.mom.post("/api/vaccines/apply-template", json={"template_id": "iap", "mode": "fill"})
    n = db_session.query(Vaccination).count()
    r = family.mom.post("/api/vaccines/apply-template", json={"template_id": "uip", "mode": "fill"})
    assert r.status_code == 409 and r.json()["existing"] == n and r.json()["detail"]
    assert db_session.query(Vaccination).count() == n


def test_add_missing_skips_existing_and_keeps_given(family, clock, db_session):
    set_birth(family, clock.day - timedelta(days=3))
    family.mom.post("/api/vaccines/apply-template", json={"template_id": "uip", "mode": "fill"})
    bcg = next(v for v in family.mom.get("/api/vaccines").json() if v["name"] == "BCG")
    family.mom.patch(f"/api/vaccines/{bcg['id']}", json={
        "status": "given", "given_on": clock.day.isoformat(), "place": "City Hospital", "notes": "left arm",
    })
    opv = next(v for v in family.mom.get("/api/vaccines").json() if v["name"] == "OPV" and v["dose_label"] == "1")
    family.mom.delete(f"/api/vaccines/{opv['id']}")
    r = family.mom.post("/api/vaccines/apply-template", json={"template_id": "uip", "mode": "add_missing"})
    assert r.status_code == 201 and r.json()["created"] == 1  # only the deleted OPV-1 comes back
    again = family.mom.post("/api/vaccines/apply-template", json={"template_id": "uip", "mode": "add_missing"})
    assert again.json()["created"] == 0
    bcg_now = next(v for v in family.mom.get("/api/vaccines").json() if v["name"] == "BCG")
    assert (bcg_now["status"], bcg_now["given_on"], bcg_now["place"]) == ("given", clock.day.isoformat(), "City Hospital")
    # IAP on top of UIP adds IAP's own names only
    iap = family.mom.post("/api/vaccines/apply-template", json={"template_id": "iap", "mode": "add_missing"})
    assert iap.status_code == 201 and 0 < iap.json()["created"] < len(load_templates()["iap"]["entries"])


def test_apply_without_birth_date_409(family):
    r = family.mom.post("/api/vaccines/apply-template", json={"template_id": "iap", "mode": "fill"})
    assert r.status_code == 409 and r.json()["detail"] == "birth date not set"


def test_apply_unknown_template_404(family, clock):
    set_birth(family, clock.day)
    assert family.mom.post("/api/vaccines/apply-template", json={"template_id": "xx", "mode": "fill"}).status_code == 404


def manual(family, **kw):
    body = {"name": "Meningococcal", "dose_label": "1", "due_date": "2027-07-01", **kw}
    r = family.mom.post("/api/vaccines", json=body)
    assert r.status_code == 201, r.text
    return r.json()


def test_mark_given_requires_a_valid_date(family, clock):
    set_birth(family, clock.day - timedelta(days=30))
    v = manual(family)
    url = f"/api/vaccines/{v['id']}"
    assert family.mom.patch(url, json={"status": "given"}).status_code == 422
    future = family.mom.patch(url, json={"status": "given", "given_on": (clock.day + timedelta(days=2)).isoformat()})
    assert future.status_code == 422 and "future" in future.json()["detail"]
    before = family.mom.patch(url, json={"status": "given", "given_on": (clock.day - timedelta(days=40)).isoformat()})
    assert before.status_code == 422 and "birth" in before.json()["detail"]
    ok = family.mom.patch(url, json={"status": "given", "given_on": clock.day.isoformat(), "place": "Clinic", "notes": "ok"})
    assert ok.status_code == 200
    assert (ok.json()["status"], ok.json()["given_on"], ok.json()["place"], ok.json()["notes"]) == (
        "given", clock.day.isoformat(), "Clinic", "ok",
    )
    back = family.mom.patch(url, json={"status": "pending"})
    assert back.json()["status"] == "pending" and back.json()["given_on"] is None


def test_skip_and_delete_template_entries(family, clock, db_session):
    set_birth(family, clock.day)
    family.mom.post("/api/vaccines/apply-template", json={"template_id": "uip", "mode": "fill"})
    rows = family.mom.get("/api/vaccines").json()
    skip = family.mom.patch(f"/api/vaccines/{rows[0]['id']}", json={"status": "skipped", "notes": "given at birth hospital"})
    assert skip.status_code == 200 and skip.json()["status"] == "skipped" and skip.json()["overdue"] is False
    moved = family.mom.patch(f"/api/vaccines/{rows[1]['id']}", json={"due_date": "2027-01-15", "name": "OPV (zero)"})
    assert moved.json()["due_date"] == "2027-01-15" and moved.json()["name"] == "OPV (zero)"
    assert family.mom.delete(f"/api/vaccines/{rows[2]['id']}").status_code == 200
    assert rows[2]["id"] not in [v["id"] for v in family.mom.get("/api/vaccines").json()]
    assert db_session.get(Vaccination, __import__("uuid").UUID(rows[2]["id"])).deleted_at is not None


def test_manual_entry_crud(family, clock):
    v = manual(family, notes="travel")
    assert v["source"] == "manual" and v["status"] == "pending" and v["notes"] == "travel"
    assert family.mom.post("/api/vaccines", json={"name": "", "due_date": "2027-01-01"}).status_code == 422
    assert family.mom.post("/api/vaccines", json={"name": "X", "due_date": "2027-01-01", "status": "nope"}).status_code == 422
    r = family.owner.patch(f"/api/vaccines/{v['id']}", json={"notes": "changed"})
    assert r.json()["notes"] == "changed"
    assert family.owner.delete(f"/api/vaccines/{v['id']}").status_code == 200
    assert family.owner.patch(f"/api/vaccines/{v['id']}", json={"notes": "x"}).status_code == 404


def test_overdue_and_days_until(family, clock):
    past = manual(family, due_date=(clock.day - timedelta(days=3)).isoformat())
    today = manual(family, dose_label="2", due_date=clock.day.isoformat())
    later = manual(family, dose_label="3", due_date=(clock.day + timedelta(days=10)).isoformat())
    got = {v["id"]: v for v in family.mom.get("/api/vaccines").json()}
    assert (got[past["id"]]["overdue"], got[past["id"]]["days_until"]) == (True, -3)
    assert (got[today["id"]]["overdue"], got[today["id"]]["days_until"]) == (False, 0)
    assert (got[later["id"]]["overdue"], got[later["id"]]["days_until"]) == (False, 10)
    family.mom.patch(f"/api/vaccines/{past['id']}", json={"status": "given", "given_on": clock.day.isoformat()})
    assert family.mom.get("/api/vaccines").json()[0]["overdue"] is False


def test_viewer_read_only_and_cross_family_404(family, clock, make_client, db_session):
    from app.auth.sessions import make_session_value
    from app.config import Settings
    from app.models import Family, Kid, Membership, User

    set_birth(family, clock.day)
    assert family.aunt.post("/api/vaccines", json={"name": "X", "due_date": "2027-01-01"}).status_code == 403
    assert family.aunt.post("/api/vaccines/apply-template", json={"template_id": "iap", "mode": "fill"}).status_code == 403
    v = manual(family)
    assert family.aunt.patch(f"/api/vaccines/{v['id']}", json={"notes": "x"}).status_code == 403
    assert family.aunt.delete(f"/api/vaccines/{v['id']}").status_code == 403
    assert len(family.aunt.get("/api/vaccines").json()) == 1

    other = Family(name="O")
    db_session.add(other)
    db_session.flush()
    stranger = User(email="s@y.com", name="S")
    db_session.add_all([Kid(family_id=other.id, name="K"), stranger])
    db_session.flush()
    db_session.add(Membership(family_id=other.id, user_id=stranger.id, role="admin"))
    db_session.flush()
    client = make_client()
    client.cookies.set("kinnest_session", make_session_value(
        Settings(owner_email="owner@x.com", session_secret="test-secret", smtp_url=""), stranger))
    assert client.get("/api/vaccines").json() == []
    assert client.patch(f"/api/vaccines/{v['id']}", json={"notes": "x"}).status_code == 404
    assert client.delete(f"/api/vaccines/{v['id']}").status_code == 404
