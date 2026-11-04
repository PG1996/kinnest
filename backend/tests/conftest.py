import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.orm import Session

from app.config import get_settings

TEST_DB = "kinnest_test"


def _admin_url() -> str:
    return get_settings().database_url.rsplit("/", 1)[0] + "/postgres"


def _test_url() -> str:
    return get_settings().database_url.rsplit("/", 1)[0] + f"/{TEST_DB}"


@pytest.fixture(scope="session")
def engine():
    from app.models import Base

    admin = create_engine(_admin_url(), isolation_level="AUTOCOMMIT")
    with admin.connect() as c:
        c.execute(text(f"DROP DATABASE IF EXISTS {TEST_DB}"))
        c.execute(text(f"CREATE DATABASE {TEST_DB}"))
    eng = create_engine(_test_url())
    Base.metadata.create_all(eng)
    yield eng
    eng.dispose()
    with admin.connect() as c:
        c.execute(text(f"DROP DATABASE IF EXISTS {TEST_DB} WITH (FORCE)"))
    admin.dispose()


@pytest.fixture
def db_session(engine):
    conn = engine.connect()
    outer = conn.begin()
    session = Session(conn, join_transaction_mode="create_savepoint", expire_on_commit=False)
    yield session
    session.close()
    outer.rollback()
    conn.close()


OWNER = "owner@x.com"


@pytest.fixture
def app_overrides(db_session):
    from app.config import Settings, get_settings
    from app.db import get_session
    from app.main import app

    app.dependency_overrides[get_session] = lambda: db_session
    app.dependency_overrides[get_settings] = lambda: Settings(
        owner_email=OWNER, session_secret="test-secret", smtp_url=""
    )
    yield app
    app.dependency_overrides.clear()


@pytest.fixture
def make_client(app_overrides):
    from fastapi.testclient import TestClient

    return lambda: TestClient(app_overrides)


@pytest.fixture
def outbox():
    from app.services import email

    email.OUTBOX.clear()
    return email.OUTBOX


def login(client, outbox, email: str):
    """Log in through the magic-link flow; returns the verify response."""
    outbox.clear()
    assert client.post("/api/auth/magic/request", json={"email": email}).status_code == 200
    token = outbox[-1].body.split("token=")[1].split()[0]
    return client.get(f"/api/auth/magic/verify?token={token}", follow_redirects=False)


@pytest.fixture
def family(make_client, outbox, db_session):
    """Owner (admin), mom (caregiver), aunt (viewer), each with a logged-in client."""
    from types import SimpleNamespace

    from app.models import Family, Invite

    owner = make_client()
    login(owner, outbox, OWNER)
    fam = db_session.query(Family).one()
    db_session.add_all(
        [
            Invite(family_id=fam.id, email="mom@x.com", role="caregiver"),
            Invite(family_id=fam.id, email="aunt@x.com", role="viewer"),
        ]
    )
    db_session.flush()
    mom, aunt = make_client(), make_client()
    login(mom, outbox, "mom@x.com")
    login(aunt, outbox, "aunt@x.com")
    return SimpleNamespace(owner=owner, mom=mom, aunt=aunt)
