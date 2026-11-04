import uuid
from datetime import UTC, date, datetime

import pytest
from sqlalchemy.exc import IntegrityError

from app.models import Family, Feed, Kid, User


def _family_kid_user(db):
    fam = Family(name="Fam")
    db.add(fam)
    db.flush()
    kid = Kid(family_id=fam.id, name="Baby", birth_date=date(2026, 10, 23))
    user = User(email="mom@x.com", name="Mom")
    db.add_all([kid, user])
    db.flush()
    return fam, kid, user


def _feed(fam, kid, user, feed_id):
    return Feed(
        id=feed_id,
        family_id=fam.id,
        kid_id=kid.id,
        type="formula",
        started_at=datetime.now(UTC),
        fed_by_user_id=user.id,
        created_by=user.id,
        updated_by=user.id,
    )


def test_feed_id_is_client_supplied_and_unique(db_session):
    fam, kid, user = _family_kid_user(db_session)
    fid = uuid.uuid4()
    db_session.add(_feed(fam, kid, user, fid))
    db_session.flush()
    assert db_session.get(Feed, fid).id == fid
    db_session.add(_feed(fam, kid, user, fid))
    with pytest.raises(IntegrityError):
        db_session.flush()


def test_email_unique_case_insensitive(db_session):
    db_session.add(User(email="A@x.com", name="A"))
    db_session.flush()
    first = db_session.query(User).one()
    assert first.email == "a@x.com"
    db_session.add(User(email="a@X.com", name="Dup"))
    with pytest.raises(IntegrityError):
        db_session.flush()
