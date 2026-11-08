import uuid
from datetime import UTC, datetime
from decimal import Decimal

import pytest
from sqlalchemy.exc import IntegrityError

from app.models import Family, Kid, User, VitalEntry

T0 = datetime(2026, 11, 9, 9, 0, tzinfo=UTC)


@pytest.fixture
def base(db_session):
    from types import SimpleNamespace

    fam = Family(name="F")
    db_session.add(fam)
    db_session.flush()
    kid = Kid(family_id=fam.id, name="Baby")
    user = User(email="mom@x.com", name="Mom")
    db_session.add_all([kid, user])
    db_session.flush()
    return SimpleNamespace(db=db_session, fam=fam, kid=kid, user=user)


def entry(b, place_kind="home", **values):
    e = VitalEntry(
        id=uuid.uuid4(), family_id=b.fam.id, kid_id=b.kid.id, measured_at=T0, place_kind=place_kind,
        created_by=b.user.id, updated_by=b.user.id, **values,
    )
    b.db.add(e)
    b.db.flush()
    return e


def test_entry_roundtrips_exact_decimals(base):
    e = entry(base, weight_kg=Decimal("3.25"), height_cm=Decimal("51.5"), head_cm=Decimal("35.2"),
              temperature_c=Decimal("36.8"), heart_rate=140, resp_rate=40, spo2=98)
    base.db.expire_all()
    got = base.db.get(VitalEntry, e.id)
    assert (got.weight_kg, got.height_cm, got.head_cm, got.temperature_c) == (
        Decimal("3.25"), Decimal("51.5"), Decimal("35.2"), Decimal("36.8"),
    )
    assert (got.heart_rate, got.resp_rate, got.spo2) == (140, 40, 98)
    assert got.place_name == "" and got.measured_by == "" and got.note == ""


@pytest.mark.parametrize(
    "field,value",
    [
        ("weight_kg", Decimal("0.2")), ("weight_kg", Decimal("61")),
        ("height_cm", Decimal("19.9")), ("height_cm", Decimal("150.1")),
        ("head_cm", Decimal("19.9")), ("head_cm", Decimal("60.1")),
        ("temperature_c", Decimal("29.9")), ("temperature_c", Decimal("45.1")),
        ("heart_rate", 29), ("heart_rate", 301),
        ("resp_rate", 4), ("resp_rate", 121),
        ("spo2", 49), ("spo2", 101),
    ],
)
def test_each_range_is_enforced(base, field, value):
    with pytest.raises(IntegrityError):
        entry(base, **{field: value})


@pytest.mark.parametrize(
    "field,value",
    [
        ("weight_kg", Decimal("0.3")), ("weight_kg", Decimal("60")), ("height_cm", Decimal("20")),
        ("height_cm", Decimal("150")), ("head_cm", Decimal("60")), ("temperature_c", Decimal("30")),
        ("temperature_c", Decimal("45")), ("heart_rate", 300), ("resp_rate", 5), ("spo2", 100),
    ],
)
def test_range_edges_are_accepted(base, field, value):
    entry(base, **{field: value})


def test_entry_with_no_measurement_is_refused(base):
    with pytest.raises(IntegrityError):
        entry(base)


def test_place_kind_is_checked(base):
    with pytest.raises(IntegrityError):
        entry(base, place_kind="car", weight_kg=Decimal("3"))


def test_prefs_default_on_for_new_kinds_and_old_clients_keep_working(family):
    all_on = {"feed": True, "diaper": True, "medicine": True, "vaccine": True, "visit": True}
    assert family.mom.get("/api/notification-prefs").json() == all_on
    # an older client sends only the first three; the new kinds stay on
    assert family.mom.put("/api/notification-prefs", json={"feed": False, "diaper": True, "medicine": True}).json() == {
        **all_on, "feed": False,
    }
    got = family.mom.put(
        "/api/notification-prefs",
        json={"feed": True, "diaper": True, "medicine": True, "vaccine": False, "visit": False},
    ).json()
    assert got == {**all_on, "vaccine": False, "visit": False}
