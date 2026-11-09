import uuid
from datetime import timedelta

from app.models import Feed

URL = "/api/timeline"


def _range(clock, hours_before=24, hours_after=0):
    return {"from": (clock.now - timedelta(hours=hours_before)).isoformat(), "to": (clock.now + timedelta(hours=hours_after)).isoformat()}


def _feed(clock, minutes_ago, **kw):
    body = {"id": str(uuid.uuid4()), "type": "formula", "quantity_ml": 60,
            "started_at": (clock.now - timedelta(minutes=minutes_ago)).isoformat(), **kw}
    r = family_post("/api/feeds", body)
    return body


_client = {}


def family_post(path, body):
    r = _client["c"].post(path, json=body)
    assert r.status_code in (200, 201), r.text
    return r.json()


def _setup(family):
    _client["c"] = family.mom


def _everything(family, clock):
    _setup(family)
    feed = _feed(clock, 30)
    diaper = {"id": str(uuid.uuid4()), "kind": "wet", "at": (clock.now - timedelta(minutes=20)).isoformat()}
    family_post("/api/diapers", diaper)
    sleep = {"id": str(uuid.uuid4()), "started_at": (clock.now - timedelta(minutes=200)).isoformat()}
    family_post("/api/sleep", sleep)
    vital = {"id": str(uuid.uuid4()), "measured_at": (clock.now - timedelta(minutes=50)).isoformat(),
             "place_kind": "home", "weight_kg": 3.4}
    family_post("/api/vitals", vital)
    med = family.owner.post("/api/medicines", json={
        "name": "Syrup", "dose_amount": 1, "dose_unit": "ml", "schedule_kind": "as_needed", "times": [],
        "start_date": (clock.day - timedelta(days=3)).isoformat()}).json()
    dose = {"id": str(uuid.uuid4()), "status": "given", "amount": 1,
            "given_at": (clock.now - timedelta(minutes=10)).isoformat()}
    r = family.mom.post(f"/api/medicines/{med['id']}/doses", json=dose)
    assert r.status_code == 201, r.text
    visit = family.mom.post("/api/visits", json={"scheduled_at": (clock.now + timedelta(hours=2)).isoformat(),
                                                 "doctor": "Dr Rao", "place": "Clinic", "reason": "check"}).json()
    vac = family.mom.post("/api/vaccines", json={"name": "BCG", "dose_label": "1", "due_date": clock.day.isoformat(),
                                                 "status": "given", "given_on": clock.day.isoformat()}).json()
    return {"feed": feed["id"], "diaper": diaper["id"], "sleep": sleep["id"], "vital": vital["id"],
            "dose": dose["id"], "visit": visit["id"], "vaccine": vac["id"]}


def test_timeline_merges_kinds_newest_first(family, clock):
    ids = _everything(family, clock)
    r = family.mom.get(URL, params=_range(clock, 24, 6))
    assert r.status_code == 200, r.text
    items = r.json()["items"]
    assert {i["kind"] for i in items} == {"feed", "diaper", "sleep", "dose", "vital", "vaccine", "visit"}
    assert {i["id"] for i in items} >= set(ids.values())
    ats = [i["at"] for i in items]
    assert ats == sorted(ats, reverse=True)
    dose = next(i for i in items if i["kind"] == "dose")
    assert dose["data"]["medicine_name"] == "Syrup" and dose["data"]["dose_unit"] == "ml"
    assert dose["data"]["status"] == "given"


def test_kinds_filter_limits_the_result(family, clock):
    _everything(family, clock)
    r = family.mom.get(URL, params={**_range(clock, 24, 6), "kinds": "feed,diaper"})
    assert {i["kind"] for i in r.json()["items"]} == {"feed", "diaper"}


def test_unknown_kind_is_422(family, clock):
    assert family.mom.get(URL, params={**_range(clock), "kinds": "feed,banana"}).status_code == 422


def test_range_over_31_days_is_422(family, clock):
    r = family.mom.get(URL, params={"from": (clock.now - timedelta(days=32)).isoformat(), "to": clock.now.isoformat()})
    assert r.status_code == 422
    ok = family.mom.get(URL, params={"from": (clock.now - timedelta(days=31)).isoformat(), "to": clock.now.isoformat()})
    assert ok.status_code == 200


def test_to_before_from_is_422(family, clock):
    r = family.mom.get(URL, params={"from": clock.now.isoformat(), "to": (clock.now - timedelta(hours=1)).isoformat()})
    assert r.status_code == 422


def test_naive_range_is_422(family, clock):
    assert family.mom.get(URL, params={"from": "2026-11-08T00:00:00", "to": "2026-11-09T00:00:00"}).status_code == 422


def test_deleted_rows_are_excluded(family, clock):
    _setup(family)
    body = _feed(clock, 15)
    assert family.mom.delete(f"/api/feeds/{body['id']}").status_code == 200
    items = family.mom.get(URL, params=_range(clock)).json()["items"]
    assert body["id"] not in {i["id"] for i in items}


def test_cancelled_visits_and_pending_vaccines_are_excluded(family, clock):
    _setup(family)
    v = family.mom.post("/api/visits", json={"scheduled_at": (clock.now + timedelta(hours=1)).isoformat(), "doctor": "A"}).json()
    family.mom.patch(f"/api/visits/{v['id']}", json={"status": "cancelled"})
    p = family.mom.post("/api/vaccines", json={"name": "X", "due_date": clock.day.isoformat()}).json()
    items = family.mom.get(URL, params=_range(clock, 24, 6)).json()["items"]
    assert v["id"] not in {i["id"] for i in items} and p["id"] not in {i["id"] for i in items}


def test_other_family_rows_are_excluded(family, clock, db_session):
    from app.models import Family, Kid, User

    other = Family(name="Other")
    db_session.add(other)
    db_session.flush()
    kid = Kid(family_id=other.id, name="Other kid")
    u = User(email="z@z.com", name="Z")
    db_session.add_all([kid, u])
    db_session.flush()
    foreign = Feed(id=uuid.uuid4(), family_id=other.id, kid_id=kid.id, type="formula", started_at=clock.now - timedelta(minutes=5),
                   fed_by_user_id=u.id, created_by=u.id, updated_by=u.id)
    db_session.add(foreign)
    db_session.flush()
    items = family.mom.get(URL, params=_range(clock)).json()["items"]
    assert str(foreign.id) not in {i["id"] for i in items}


def test_viewer_can_read(family, clock):
    _everything(family, clock)
    r = family.aunt.get(URL, params=_range(clock, 24, 6))
    assert r.status_code == 200 and len(r.json()["items"]) >= 7


def test_signed_out_is_401(make_client, clock):
    r = make_client().get(URL, params=_range(clock))
    assert r.status_code == 401


def test_skipped_doses_appear_with_status_skipped(family, clock):
    _setup(family)
    med = family.owner.post("/api/medicines", json={
        "name": "Syrup", "dose_amount": 1, "dose_unit": "ml", "schedule_kind": "fixed", "times": ["09:00"],
        "start_date": (clock.day - timedelta(days=3)).isoformat()}).json()
    sid = str(uuid.uuid4())
    r = family.mom.post(f"/api/medicines/{med['id']}/doses", json={"id": sid, "status": "skipped",
                                                                  "scheduled_for": clock.at(9).isoformat()})
    assert r.status_code == 201, r.text
    items = family.mom.get(URL, params=_range(clock, 24, 6)).json()["items"]
    skipped = next(i for i in items if i["id"] == sid)
    assert skipped["data"]["status"] == "skipped"
