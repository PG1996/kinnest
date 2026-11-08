import uuid
from datetime import timedelta

import pytest

from app.models import VitalEntry


MEASURED = {"weight_kg", "height_cm", "head_cm", "temperature_c", "heart_rate", "resp_rate", "spo2"}


def vital(clock, hours_ago: float = 1, **values):
    body = {"id": str(uuid.uuid4()), "measured_at": (clock.now - timedelta(hours=hours_ago)).isoformat(),
            "place_kind": "home"}
    if not MEASURED & values.keys():
        body["weight_kg"] = 3.4
    body.update(values)
    return body


def test_create_entry_201_and_same_id_200(family, clock, db_session):
    body = vital(clock, weight_kg=3.42, temperature_c=36.8, place_kind="hospital", place_name="City Hospital",
                 measured_by="Nurse", note="after bath")
    r = family.mom.post("/api/vitals", json=body)
    assert r.status_code == 201
    got = r.json()
    assert got["id"] == body["id"] and got["weight_kg"] == 3.42 and got["temperature_c"] == 36.8
    assert got["height_cm"] is None and got["spo2"] is None
    assert (got["place_kind"], got["place_name"], got["measured_by"], got["note"]) == (
        "hospital", "City Hospital", "Nurse", "after bath",
    )
    assert got["entered_by_name"] == "mom"
    again = family.mom.post("/api/vitals", json={**body, "weight_kg": 9})
    assert again.status_code == 200 and again.json()["weight_kg"] == 3.42
    assert db_session.query(VitalEntry).count() == 1


def test_fahrenheit_temperature_refused_with_a_hint(family, clock):
    r = family.mom.post("/api/vitals", json=vital(clock, temperature_c=98.6))
    assert r.status_code == 422
    detail = r.json()["detail"]
    assert "30 to 45 degrees Celsius" in detail and "Fahrenheit" in detail


@pytest.mark.parametrize(
    "field,value,words",
    [
        ("weight_kg", 62, "0.3 to 60 kg"),
        ("weight_kg", 0, "0.3 to 60 kg"),
        ("weight_kg", -1, "0.3 to 60 kg"),
        ("height_cm", 151, "20 to 150 cm"),
        ("head_cm", 10, "20 to 60 cm"),
        ("temperature_c", 29, "30 to 45 degrees Celsius"),
        ("heart_rate", 301, "30 to 300"),
        ("resp_rate", 0, "5 to 120"),
        ("spo2", 101, "50 to 100"),
    ],
)
def test_values_outside_ranges_refused(family, clock, field, value, words):
    r = family.mom.post("/api/vitals", json=vital(clock, **{field: value}))
    assert r.status_code == 422 and words in r.json()["detail"]


def test_valid_edge_values_accepted(family, clock):
    r = family.mom.post("/api/vitals", json=vital(
        clock, weight_kg=0.3, height_cm=150, head_cm=20, temperature_c=45, heart_rate=30, resp_rate=120, spo2=100,
    ))
    assert r.status_code == 201


def test_empty_entry_refused(family, clock):
    body = vital(clock, weight_kg=None)
    r = family.mom.post("/api/vitals", json=body)
    assert r.status_code == 422 and "at least one measurement" in r.json()["detail"]


def test_reading_before_birth_refused_and_future_refused(family, clock):
    assert family.owner.patch("/api/kid", json={"birth_date": clock.day.isoformat()}).status_code == 200
    before = vital(clock, hours_ago=24)
    r = family.mom.post("/api/vitals", json=before)
    assert r.status_code == 422 and "birth" in r.json()["detail"]
    future = vital(clock, hours_ago=-1)
    r = family.mom.post("/api/vitals", json=future)
    assert r.status_code == 422 and "future" in r.json()["detail"]
    assert family.mom.post("/api/vitals", json=vital(clock, hours_ago=-0.05)).status_code == 201  # 3 minutes ahead


def test_bulk_all_or_nothing_reports_row_errors(family, clock, db_session):
    rows = [vital(clock, hours_ago=h, weight_kg=3 + h / 10) for h in (5, 4, 3, 2)]
    rows[2]["temperature_c"] = 98.6
    rows[3]["weight_kg"] = None
    r = family.mom.post("/api/vitals/bulk", json={"entries": rows})
    assert r.status_code == 422
    errors = r.json()["errors"]
    assert [e["index"] for e in errors] == [2, 3]
    assert "Fahrenheit" in errors[0]["detail"] and "at least one measurement" in errors[1]["detail"]
    assert db_session.query(VitalEntry).count() == 0


def test_bulk_bad_types_are_row_errors(family, clock, db_session):
    rows = [vital(clock), {**vital(clock), "place_kind": "car"}, {**vital(clock), "measured_at": "yesterday"}]
    r = family.mom.post("/api/vitals/bulk", json={"entries": rows})
    assert r.status_code == 422 and [e["index"] for e in r.json()["errors"]] == [1, 2]
    assert db_session.query(VitalEntry).count() == 0


def test_bulk_resubmit_creates_no_duplicates(family, clock, db_session):
    rows = [vital(clock, hours_ago=h) for h in (3, 2, 1)]
    first = family.mom.post("/api/vitals/bulk", json={"entries": rows})
    assert first.status_code == 201 and first.json()["created"] == 3 and first.json()["existing"] == 0
    again = family.mom.post("/api/vitals/bulk", json={"entries": rows + [vital(clock)]})
    assert again.json()["created"] == 1 and again.json()["existing"] == 2 + 1
    assert len(again.json()["entries"]) == 4
    assert db_session.query(VitalEntry).count() == 4


def test_bulk_same_id_twice_in_one_batch_is_a_row_error(family, clock):
    row = vital(clock)
    r = family.mom.post("/api/vitals/bulk", json={"entries": [row, row]})
    assert r.status_code == 422 and r.json()["errors"][0]["index"] == 1


def test_bulk_over_200_refused(family, clock, db_session):
    rows = [vital(clock) for _ in range(201)]
    r = family.mom.post("/api/vitals/bulk", json={"entries": rows})
    assert r.status_code == 422 and "200" in r.json()["detail"]
    assert family.mom.post("/api/vitals/bulk", json={"entries": rows[:200]}).status_code == 201
    assert family.mom.post("/api/vitals/bulk", json={"entries": []}).status_code == 422


def test_filters_by_range_and_place(family, clock):
    a = vital(clock, hours_ago=30, place_kind="hospital")
    b = vital(clock, hours_ago=20)
    c = vital(clock, hours_ago=2, place_kind="hospital")
    for x in (a, b, c):
        family.mom.post("/api/vitals", json=x)
    ids = lambda r: [e["id"] for e in r.json()]
    assert ids(family.aunt.get("/api/vitals")) == [c["id"], b["id"], a["id"]]
    assert ids(family.aunt.get("/api/vitals", params={"place_kind": "hospital"})) == [c["id"], a["id"]]
    since = (clock.now - timedelta(hours=25)).isoformat()
    until = (clock.now - timedelta(hours=10)).isoformat()
    assert ids(family.aunt.get("/api/vitals", params={"from": since, "to": until})) == [b["id"]]
    assert ids(family.aunt.get("/api/vitals", params={"limit": 1})) == [c["id"]]


def test_viewer_read_only_and_cross_family_404(family, clock, make_client, outbox, db_session):
    from app.models import Family, Kid, User, Membership
    from app.auth.sessions import make_session_value
    from app.config import Settings

    body = vital(clock)
    assert family.aunt.post("/api/vitals", json=body).status_code == 403
    assert family.aunt.post("/api/vitals/bulk", json={"entries": [body]}).status_code == 403
    created = family.mom.post("/api/vitals", json=body).json()
    assert family.aunt.patch(f"/api/vitals/{created['id']}", json={"note": "x"}).status_code == 403
    assert family.aunt.delete(f"/api/vitals/{created['id']}").status_code == 403

    other = Family(name="Other")
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
    assert client.get("/api/vitals").json() == []
    assert client.patch(f"/api/vitals/{created['id']}", json={"note": "x"}).status_code == 404
    assert client.delete(f"/api/vitals/{created['id']}").status_code == 404
    # reusing another family's id is refused, never returns their row
    assert client.post("/api/vitals", json=body).status_code == 409


def test_patch_revalidates_the_whole_entry(family, clock):
    created = family.mom.post("/api/vitals", json=vital(clock, weight_kg=3.4)).json()
    url = f"/api/vitals/{created['id']}"
    r = family.mom.patch(url, json={"weight_kg": None})
    assert r.status_code == 422 and "at least one measurement" in r.json()["detail"]
    assert family.mom.patch(url, json={"temperature_c": 98.6}).status_code == 422
    ok = family.owner.patch(url, json={"weight_kg": None, "height_cm": 52.5, "place_kind": "clinic"})
    assert ok.status_code == 200
    assert (ok.json()["weight_kg"], ok.json()["height_cm"], ok.json()["place_kind"]) == (None, 52.5, "clinic")
    assert family.mom.patch(url, json={"measured_at": (clock.now + timedelta(hours=1)).isoformat()}).status_code == 422


def test_delete_hides_but_keeps_the_row(family, clock, db_session):
    created = family.mom.post("/api/vitals", json=vital(clock)).json()
    assert family.mom.delete(f"/api/vitals/{created['id']}").status_code == 200
    assert family.mom.get("/api/vitals").json() == []
    assert db_session.query(VitalEntry).one().deleted_at is not None
    assert family.mom.patch(f"/api/vitals/{created['id']}", json={"note": "x"}).status_code == 404


def test_summary_latest_per_measurement(family, clock):
    old = vital(clock, hours_ago=30, weight_kg=3.3, height_cm=51, place_kind="hospital")
    new = vital(clock, hours_ago=2, weight_kg=3.5)
    temp = vital(clock, hours_ago=1, temperature_c=36.9)
    gone = vital(clock, hours_ago=0.5, head_cm=35)
    for x in (old, new, temp, gone):
        family.mom.post("/api/vitals", json=x)
    family.mom.delete(f"/api/vitals/{gone['id']}")
    latest = family.aunt.get("/api/summary").json()["vitals"]["latest"]
    assert latest["weight_kg"]["id"] == new["id"] and latest["weight_kg"]["weight_kg"] == 3.5
    assert latest["height_cm"]["id"] == old["id"] and latest["height_cm"]["place_kind"] == "hospital"
    assert latest["temperature_c"]["id"] == temp["id"]
    assert latest["head_cm"] is None
