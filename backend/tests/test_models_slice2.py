import uuid
from datetime import UTC, date, datetime, timedelta

import pytest
from sqlalchemy.exc import IntegrityError

from app.models import Family, Kid, Medicine, MedicineDose, ReminderState, SleepSession, User

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
    med = Medicine(
        family_id=fam.id, kid_id=kid.id, name="Vit D", dose="5 drops", schedule_kind="fixed",
        times=["09:00", "21:00"], start_date=date(2026, 11, 1), created_by=user.id, updated_by=user.id,
    )
    db_session.add(med)
    db_session.flush()
    return SimpleNamespace(db=db_session, fam=fam, kid=kid, user=user, med=med)


def dose(b, scheduled_for, deleted_at=None):
    return MedicineDose(
        id=uuid.uuid4(), family_id=b.fam.id, kid_id=b.kid.id, medicine_id=b.med.id, status="given",
        scheduled_for=scheduled_for, given_at=T0, by_user_id=b.user.id, created_by=b.user.id,
        updated_by=b.user.id, deleted_at=deleted_at,
    )


def sleep(b, ended_at=None, deleted_at=None):
    return SleepSession(
        id=uuid.uuid4(), family_id=b.fam.id, kid_id=b.kid.id, started_at=T0, ended_at=ended_at,
        started_by_user_id=b.user.id, created_by=b.user.id, updated_by=b.user.id, deleted_at=deleted_at,
    )


def test_medicine_times_roundtrip_as_a_list(base):
    base.db.expire_all()
    assert base.db.get(Medicine, base.med.id).times == ["09:00", "21:00"]


def test_one_live_dose_per_medicine_slot(base):
    base.db.add(dose(base, T0))
    base.db.flush()
    base.db.add(dose(base, T0))
    with pytest.raises(IntegrityError):
        base.db.flush()


def test_an_undone_dose_frees_the_slot(base):
    base.db.add(dose(base, T0, deleted_at=T0))
    base.db.flush()
    base.db.add(dose(base, T0))
    base.db.flush()  # no conflict


def test_as_needed_doses_have_no_slot_and_can_repeat(base):
    base.db.add_all([dose(base, None), dose(base, None)])
    base.db.flush()


def test_only_one_open_sleep_per_kid(base):
    base.db.add(sleep(base))
    base.db.flush()
    base.db.add(sleep(base))
    with pytest.raises(IntegrityError):
        base.db.flush()


def test_closed_and_deleted_sleeps_do_not_count_as_open(base):
    base.db.add_all([sleep(base, ended_at=T0 + timedelta(hours=1)), sleep(base, deleted_at=T0), sleep(base)])
    base.db.flush()


def test_reminder_state_unique_even_when_subject_is_null(base):
    def state(subject):
        return ReminderState(kid_id=base.kid.id, kind="feed", anchor_at=T0, level=0, subject_id=subject)

    base.db.add(state(None))
    base.db.flush()
    base.db.add(state(uuid.uuid4()))  # a different subject is a different chain
    base.db.flush()
    base.db.add(state(None))
    with pytest.raises(IntegrityError):
        base.db.flush()
