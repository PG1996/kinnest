import uuid
from datetime import timedelta

from app.models import DoctorVisit, VitalEntry
from tests.test_vitals import vital


def _visit(client, clock, hours_ago=1, **kw):
    body = {"scheduled_at": (clock.now - timedelta(hours=hours_ago)).isoformat(), "doctor": "Dr. Brinda", "place": "Miracle Hospital", "status": "done"}
    body.update(kw)
    r = client.post("/api/visits", json=body)
    assert r.status_code == 201, r.text
    return r.json()


def test_a_hospital_reading_can_be_linked_to_a_visit(family, clock):
    v = _visit(family.mom, clock)
    r = family.mom.post("/api/vitals", json=vital(clock, place_kind="hospital", place_name="Miracle Hospital", visit_id=v["id"]))
    assert r.status_code == 201 and r.json()["visit_id"] == v["id"]


def test_without_a_link_the_reading_has_no_visit(family, clock):
    r = family.mom.post("/api/vitals", json=vital(clock, place_kind="hospital"))
    assert r.json()["visit_id"] is None


def test_create_visit_makes_a_done_visit_at_the_reading_s_place_and_time(family, clock, db_session):
    body = vital(clock, hours_ago=2, place_kind="clinic", place_name="Aster Whitefield", create_visit=True)
    r = family.mom.post("/api/vitals", json=body)
    assert r.status_code == 201
    visit = db_session.get(DoctorVisit, uuid.UUID(r.json()["visit_id"]))
    assert visit.status == "done" and visit.place == "Aster Whitefield" and visit.doctor == ""
    assert visit.scheduled_at == clock.now - timedelta(hours=2)
    # an offline retry of the same reading makes no second visit
    assert family.mom.post("/api/vitals", json=body).status_code == 200
    assert db_session.query(DoctorVisit).count() == 1


def test_a_home_reading_cannot_have_a_visit(family, clock):
    v = _visit(family.mom, clock)
    assert family.mom.post("/api/vitals", json=vital(clock, place_kind="home", visit_id=v["id"])).status_code == 422
    assert family.mom.post("/api/vitals", json=vital(clock, place_kind="home", create_visit=True)).status_code == 422


def test_an_unknown_or_deleted_visit_is_refused(family, clock):
    assert family.mom.post("/api/vitals", json=vital(clock, place_kind="hospital", visit_id=str(uuid.uuid4()))).status_code == 422
    v = _visit(family.mom, clock)
    assert family.mom.delete(f"/api/visits/{v['id']}").status_code == 200
    assert family.mom.post("/api/vitals", json=vital(clock, place_kind="hospital", visit_id=v["id"])).status_code == 422


def test_editing_links_unlinks_or_creates_a_visit(family, clock, db_session):
    made = family.mom.post("/api/vitals", json=vital(clock, place_kind="hospital", place_name="Miracle Hospital")).json()
    v = _visit(family.mom, clock)
    assert family.mom.patch(f"/api/vitals/{made['id']}", json={"visit_id": v["id"]}).json()["visit_id"] == v["id"]
    assert family.mom.patch(f"/api/vitals/{made['id']}", json={"visit_id": None}).json()["visit_id"] is None
    r = family.mom.patch(f"/api/vitals/{made['id']}", json={"create_visit": True})
    assert r.json()["visit_id"] not in (None, v["id"])
    # moving a linked reading home drops the link
    assert family.mom.patch(f"/api/vitals/{made['id']}", json={"place_kind": "home"}).json()["visit_id"] is None


def test_visits_list_the_readings_linked_to_them(family, clock):
    v = _visit(family.mom, clock)
    a = family.mom.post("/api/vitals", json=vital(clock, place_kind="hospital", weight_kg=3.42, visit_id=v["id"])).json()
    b = family.mom.post("/api/vitals", json=vital(clock, place_kind="hospital", temperature_c=37.0, visit_id=v["id"])).json()
    family.mom.delete(f"/api/vitals/{b['id']}")
    got = next(x for x in family.aunt.get("/api/visits").json() if x["id"] == v["id"])
    assert [x["id"] for x in got["vitals"]] == [a["id"]]
    assert got["vitals"][0]["weight_kg"] == 3.42


def test_deleting_a_visit_keeps_its_readings_but_unlinks_them(family, clock, db_session):
    v = _visit(family.mom, clock)
    a = family.mom.post("/api/vitals", json=vital(clock, place_kind="hospital", visit_id=v["id"])).json()
    family.mom.delete(f"/api/visits/{v['id']}")
    row = db_session.get(VitalEntry, uuid.UUID(a["id"]))
    assert row.deleted_at is None and row.visit_id is None


def test_bulk_rows_can_name_a_visit(family, clock):
    v = _visit(family.mom, clock)
    rows = [vital(clock, place_kind="hospital", visit_id=v["id"]), vital(clock, hours_ago=3, place_kind="hospital", visit_id=str(uuid.uuid4()))]
    r = family.mom.post("/api/vitals/bulk", json={"entries": rows})
    assert r.status_code == 422 and r.json()["errors"][0]["index"] == 1
    r = family.mom.post("/api/vitals/bulk", json={"entries": rows[:1]})
    assert r.status_code == 201 and r.json()["entries"][0]["visit_id"] == v["id"]
