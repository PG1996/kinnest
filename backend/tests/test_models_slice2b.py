import uuid
from datetime import UTC, date, datetime, timedelta
from decimal import Decimal

import pytest
from sqlalchemy.exc import IntegrityError

from app.models import Family, Kid, Medicine, MedicineDose, MedicineNudge, User

T0 = datetime(2026, 11, 8, 9, 0, tzinfo=UTC)


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


def medicine(b, **kw):
    data = dict(
        family_id=b.fam.id, kid_id=b.kid.id, name="Vit D", dose="", schedule_kind="fixed", times=["09:00"],
        start_date=date(2026, 11, 1), created_by=b.user.id, updated_by=b.user.id,
        dose_amount=Decimal("1.00"), dose_unit="ml",
    )
    data.update(kw)
    m = Medicine(**data)
    b.db.add(m)
    b.db.flush()
    return m


def piece(b, med, amount, scheduled_for=T0, deleted_at=None):
    return MedicineDose(
        id=uuid.uuid4(), family_id=b.fam.id, kid_id=b.kid.id, medicine_id=med.id, status="given",
        scheduled_for=scheduled_for, given_at=T0, amount=amount, by_user_id=b.user.id, created_by=b.user.id,
        updated_by=b.user.id, deleted_at=deleted_at,
    )


def test_dose_amount_roundtrips_as_an_exact_decimal(base):
    m = medicine(base, dose_amount=Decimal("0.25"))
    base.db.expire_all()
    assert base.db.get(Medicine, m.id).dose_amount == Decimal("0.25")


def test_several_pieces_can_share_a_slot(base):
    m = medicine(base)
    base.db.add_all([piece(base, m, Decimal("0.25")) for _ in range(4)])
    base.db.flush()  # no unique conflict any more
    assert base.db.query(MedicineDose).count() == 4


@pytest.mark.parametrize("amount", [Decimal("0"), Decimal("-1"), Decimal("10000.01")])
def test_dose_amount_must_be_positive_and_bounded(base, amount):
    with pytest.raises(IntegrityError):
        medicine(base, dose_amount=amount)


def test_dose_unit_must_be_known(base):
    with pytest.raises(IntegrityError):
        medicine(base, dose_unit="spoon")


def test_legacy_medicine_without_amount_is_allowed(base):
    medicine(base, dose_amount=None, dose_unit=None)


def test_piece_amount_must_be_positive_when_set(base):
    m = medicine(base)
    base.db.add(piece(base, m, Decimal("0")))
    with pytest.raises(IntegrityError):
        base.db.flush()


def test_nudge_roundtrip(base):
    m = medicine(base)
    n = MedicineNudge(
        id=uuid.uuid4(), family_id=base.fam.id, kid_id=base.kid.id, medicine_id=m.id, scheduled_for=T0,
        remind_at=T0 + timedelta(minutes=10), created_by=base.user.id,
    )
    base.db.add(n)
    base.db.flush()
    base.db.expire_all()
    got = base.db.get(MedicineNudge, n.id)
    assert got.fired_at is None and got.cancelled_at is None and got.remind_at == T0 + timedelta(minutes=10)
