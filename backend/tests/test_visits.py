from datetime import timedelta

from app.models import DoctorVisit


def visit(family, clock, hours=24, client=None, **kw):
    body = {"scheduled_at": (clock.now + timedelta(hours=hours)).isoformat(), "doctor": "Dr Rao",
            "place": "City Clinic", "reason": "6 week check", **kw}
    r = (client or family.mom).post("/api/visits", json=body)
    assert r.status_code == 201, r.text
    return r.json()


def test_visit_crud_and_status_changes(family, clock, db_session):
    v = visit(family, clock)
    assert (v["doctor"], v["place"], v["reason"], v["status"]) == ("Dr Rao", "City Clinic", "6 week check", "upcoming")
    assert v["notes"] == "" and v["prescription_notes"] == ""
    url = f"/api/visits/{v['id']}"
    moved = family.owner.patch(url, json={"scheduled_at": (clock.now + timedelta(hours=48)).isoformat()})
    assert moved.status_code == 200 and moved.json()["scheduled_at"] != v["scheduled_at"]
    done = family.mom.patch(url, json={"status": "done", "notes": "all fine", "prescription_notes": "Vit D 400 IU daily"})
    assert done.status_code == 200
    assert (done.json()["status"], done.json()["notes"], done.json()["prescription_notes"]) == (
        "done", "all fine", "Vit D 400 IU daily",
    )
    other = visit(family, clock, hours=72)
    assert family.mom.patch(f"/api/visits/{other['id']}", json={"status": "cancelled"}).json()["status"] == "cancelled"
    assert family.mom.delete(url).status_code == 200
    assert v["id"] not in [x["id"] for x in family.mom.get("/api/visits").json()]
    assert db_session.query(DoctorVisit).filter(DoctorVisit.deleted_at.is_not(None)).count() == 1
    assert family.mom.patch(url, json={"notes": "x"}).status_code == 404


def test_listing_order_for_upcoming_and_past(family, clock):
    later = visit(family, clock, hours=72)
    soon = visit(family, clock, hours=5)
    old = visit(family, clock, hours=-72)
    recent = visit(family, clock, hours=-5)
    for x in (old, recent):
        family.mom.patch(f"/api/visits/{x['id']}", json={"status": "done"})
    ids = lambda r: [x["id"] for x in r.json()]
    assert ids(family.aunt.get("/api/visits", params={"status": "upcoming"})) == [soon["id"], later["id"]]
    assert ids(family.aunt.get("/api/visits", params={"status": "done"})) == [recent["id"], old["id"]]
    assert ids(family.aunt.get("/api/visits")) == [soon["id"], later["id"], recent["id"], old["id"]]
    since = (clock.now - timedelta(hours=10)).isoformat()
    until = (clock.now + timedelta(hours=10)).isoformat()
    assert ids(family.aunt.get("/api/visits", params={"from": since, "to": until})) == [soon["id"], recent["id"]]


def test_visit_in_the_past_can_be_logged_as_done(family, clock):
    v = visit(family, clock, hours=-30, status="done", notes="weighed", prescription_notes="none")
    assert v["status"] == "done" and v["notes"] == "weighed"


def test_viewer_read_only_and_cross_family_404(family, clock, make_client, db_session):
    from app.auth.sessions import make_session_value
    from app.config import Settings
    from app.models import Family, Kid, Membership, User

    body = {"scheduled_at": clock.now.isoformat()}
    assert family.aunt.post("/api/visits", json=body).status_code == 403
    v = visit(family, clock)
    assert family.aunt.patch(f"/api/visits/{v['id']}", json={"notes": "x"}).status_code == 403
    assert family.aunt.delete(f"/api/visits/{v['id']}").status_code == 403
    assert len(family.aunt.get("/api/visits").json()) == 1

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
    assert client.get("/api/visits").json() == []
    assert client.patch(f"/api/visits/{v['id']}", json={"notes": "x"}).status_code == 404
    assert client.delete(f"/api/visits/{v['id']}").status_code == 404


def test_validation(family, clock):
    v = visit(family, clock, doctor="", reason="", place="")
    assert v["doctor"] == "" and v["reason"] == ""
    assert family.mom.post("/api/visits", json={"scheduled_at": clock.now.isoformat(), "status": "maybe"}).status_code == 422
    assert family.mom.post("/api/visits", json={"scheduled_at": "2027-01-01T10:00:00"}).status_code == 422  # no timezone
    assert family.mom.post("/api/visits", json={"doctor": "x"}).status_code == 422
    assert family.mom.patch(f"/api/visits/{v['id']}", json={"status": "maybe"}).status_code == 422
    assert family.mom.patch(f"/api/visits/{v['id']}", json={"scheduled_at": None}).status_code == 422
