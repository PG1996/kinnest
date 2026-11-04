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
