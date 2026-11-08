import uuid
from datetime import timedelta

import pytest

from app.services import who

# Copied from the official WHO girls tables (tab_wfa_girls_p_0_5, tab_lhfa_girls_p_0_2, tab_lhfa_girls_p_2_5,
# tab_hcfa_girls_p_0_5), retrieved 2026-11-08: month, L, M, S, P3, P97.
OFFICIAL = {
    "weight": [(0, 0.3809, 3.2322, 0.14171, 2.4, 4.2), (30, -0.3101, 12.7055, 0.12587, 10.1, 16.2),
               (60, -0.3518, 18.2193, 0.14821, 14.0, 24.4)],
    "height": [(0, 1.0, 49.1477, 0.0379, 45.6, 52.7), (12, 1.0, 74.015, 0.03479, 69.2, 78.9),
               (24, 1.0, 85.7153, 0.03764, 79.6, 91.8), (60, 1.0, 109.4233, 0.04347, 100.5, 118.4)],
    "head": [(0, 1.0, 33.8787, 0.03496, 31.7, 36.1), (30, 1.0, 47.934, 0.02933, 45.3, 50.6),
             (60, 1.0, 49.9229, 0.0285, 47.2, 52.6)],
}
CASES = [(kind, *row) for kind, rows in OFFICIAL.items() for row in rows]


@pytest.mark.parametrize("kind,month,L,M,S,p3,p97", CASES)
def test_lms_matches_the_official_table_values(kind, month, L, M, S, p3, p97):
    assert who.lms(kind, month) == (L, M, S)


@pytest.mark.parametrize("kind,month,L,M,S,p3,p97", CASES)
def test_computed_percentiles_match_the_published_ones(kind, month, L, M, S, p3, p97):
    assert who.value_at_percentile(kind, month, 3) == pytest.approx(p3, abs=0.051)
    assert who.value_at_percentile(kind, month, 97) == pytest.approx(p97, abs=0.051)


def test_interpolates_between_months():
    _, m0, _ = who.lms("weight", 0)
    _, m1, _ = who.lms("weight", 1)
    assert who.lms("weight", 0.25)[1] == pytest.approx(m0 + (m1 - m0) * 0.25)


def test_median_is_the_50th_percentile():
    for kind in ("weight", "height", "head"):
        for month in (0, 7.5, 24, 59.9):
            assert who.percentile_of(kind, month, who.lms(kind, month)[1]) == 50.0


def test_percentile_roundtrip():
    for p in (3, 15, 50, 85, 97):
        v = who.value_at_percentile("weight", 5.3, p)
        assert who.percentile_of("weight", 5.3, v) == pytest.approx(p, abs=0.1)


def test_far_outside_the_curves_is_clamped_not_an_error():
    assert who.percentile_of("weight", 3, 0.5) == 0.0
    assert who.percentile_of("weight", 3, 40) == 100.0


def test_outside_range_raises():
    for bad in (-0.1, 60.01):
        with pytest.raises(ValueError):
            who.lms("weight", bad)
    with pytest.raises(ValueError):
        who.lms("bmi", 3)


def test_switch_at_24_months_uses_height_table():
    assert who.lms("height", 24)[1] == 85.7153  # height table, not the length table's 86.4153
    assert who.lms("height", 23.999)[1] > 86.4  # still length, near the length table's month 24
    assert who.lms("height", 60)[1] == 109.4233


def test_source_is_named():
    src = who.source("weight")
    assert src["url"].startswith("https://www.who.int/") and src["retrieved_on"] == "2026-11-08" and src["name"]


# --- endpoint ---


def _post(client, clock, at, **values):
    body = {"id": str(uuid.uuid4()), "measured_at": at.isoformat(), "place_kind": "home", **values}
    r = client.post("/api/vitals", json=body)
    assert r.status_code == 201, r.text
    return body


def test_growth_endpoint_curves_and_points(family, clock):
    birth = clock.day - timedelta(days=61)
    family.owner.patch("/api/kid", json={"birth_date": birth.isoformat()})
    at = clock.at(9)
    age = 61 / who.DAYS_PER_MONTH
    median = round(who.lms("weight", age)[1], 2)
    body = _post(family.mom, clock, at, weight_kg=median, place_kind="hospital")
    r = family.aunt.get("/api/vitals/growth/weight")
    assert r.status_code == 200
    got = r.json()
    assert got["birth_date"] == birth.isoformat()
    assert got["source"]["url"].startswith("https://www.who.int/") and got["source"]["retrieved_on"]
    assert sorted(got["curves"], key=int) == ["3", "15", "50", "85", "97"]
    assert len(got["curves"]["50"]) == 61 and got["curves"]["50"][0] == [0, 3.2322]
    (point,) = got["points"]
    assert point["id"] == body["id"] and point["value"] == median and point["place_kind"] == "hospital"
    assert point["age_months"] == pytest.approx(age, abs=0.01)
    assert point["percentile"] == pytest.approx(50.0, abs=0.2)


def test_growth_endpoint_without_birth_date_is_409(family):
    r = family.mom.get("/api/vitals/growth/height")
    assert r.status_code == 409 and r.json()["detail"] == "birth date not set"


def test_unknown_kind_is_422(family):
    assert family.mom.get("/api/vitals/growth/bmi").status_code == 422


def test_points_exclude_deleted_and_other_measurements(family, clock):
    family.owner.patch("/api/kid", json={"birth_date": (clock.day - timedelta(days=30)).isoformat()})
    keep = _post(family.mom, clock, clock.at(8), weight_kg=4.1)
    gone = _post(family.mom, clock, clock.at(8, 30), weight_kg=4.2)
    _post(family.mom, clock, clock.at(9), temperature_c=36.8)
    _post(family.mom, clock, clock.at(9, 30), height_cm=54)
    family.mom.delete(f"/api/vitals/{gone['id']}")
    assert [p["id"] for p in family.mom.get("/api/vitals/growth/weight").json()["points"]] == [keep["id"]]


def test_other_family_points_not_shown(family, clock, db_session):
    from app.models import Family, Kid, User, VitalEntry
    from datetime import UTC, datetime
    from decimal import Decimal

    family.owner.patch("/api/kid", json={"birth_date": (clock.day - timedelta(days=30)).isoformat()})
    other = Family(name="O")
    db_session.add(other)
    db_session.flush()
    kid, u = Kid(family_id=other.id, name="K"), User(email="o@y.com")
    db_session.add_all([kid, u])
    db_session.flush()
    db_session.add(VitalEntry(id=uuid.uuid4(), family_id=other.id, kid_id=kid.id, measured_at=datetime.now(UTC),
                              place_kind="home", weight_kg=Decimal("4"), created_by=u.id, updated_by=u.id))
    db_session.flush()
    assert family.mom.get("/api/vitals/growth/weight").json()["points"] == []
