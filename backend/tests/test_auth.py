from datetime import UTC, datetime, timedelta

from fastapi import Depends, FastAPI
from fastapi.testclient import TestClient

from app.auth import deps as auth_deps
from app.models import Family, Invite, Kid, MagicToken, Membership, User
from tests.conftest import OWNER, login


def test_owner_first_login_creates_family_as_admin(make_client, outbox, db_session):
    c = make_client()
    assert login(c, outbox, OWNER).status_code == 303
    me = c.get("/api/me").json()
    assert me["role"] == "admin" and me["family_id"] and me["kid_id"]
    assert db_session.query(Family).count() == 1
    assert db_session.query(Kid).one().name == "Baby"


def test_uninvited_email_gets_403(make_client, outbox, db_session, monkeypatch):
    # magic link: no email is sent to a stranger
    c = make_client()
    login(c, outbox, OWNER)
    other = make_client()
    outbox.clear()
    assert other.post("/api/auth/magic/request", json={"email": "stranger@x.com"}).status_code == 200
    assert outbox == []
    # google callback with an uninvited verified email
    async def fake_identity(request, settings):
        return "stranger@x.com", "S"

    monkeypatch.setattr("app.api.auth.fetch_google_identity", fake_identity)
    r = other.get("/api/auth/google/callback?code=x&state=y", follow_redirects=False)
    assert r.status_code == 403
    assert "set-cookie" not in r.headers
    assert db_session.query(User).filter_by(email="stranger@x.com").count() == 0


def test_invite_matches_case_insensitively(make_client, outbox, db_session):
    owner = make_client()
    login(owner, outbox, OWNER)
    fam = db_session.query(Family).one()
    db_session.add(Invite(family_id=fam.id, email="Nanny@X.com", role="caregiver"))
    db_session.flush()
    nanny = make_client()
    assert login(nanny, outbox, "nanny@x.COM").status_code == 303
    assert nanny.get("/api/me").json()["role"] == "caregiver"
    assert db_session.query(Invite).one().accepted_at is not None


def test_magic_token_single_use(make_client, outbox):
    c = make_client()
    login(c, outbox, OWNER)
    token = outbox[-1].body.split("token=")[1].split()[0]
    assert c.get(f"/api/auth/magic/verify?token={token}", follow_redirects=False).status_code == 400


def test_magic_token_expires(make_client, outbox, db_session):
    c = make_client()
    c.post("/api/auth/magic/request", json={"email": OWNER})
    token = outbox[-1].body.split("token=")[1].split()[0]
    db_session.query(MagicToken).update({"expires_at": datetime.now(UTC) - timedelta(minutes=1)})
    db_session.flush()
    assert c.get(f"/api/auth/magic/verify?token={token}", follow_redirects=False).status_code == 400


def test_removed_member_session_rejected(make_client, outbox, db_session):
    owner = make_client()
    login(owner, outbox, OWNER)
    fam = db_session.query(Family).one()
    db_session.add(Invite(family_id=fam.id, email="mom@x.com", role="caregiver"))
    db_session.flush()
    mom = make_client()
    login(mom, outbox, "mom@x.com")
    assert mom.get("/api/me").status_code == 200
    user = db_session.query(User).filter_by(email="mom@x.com").one()
    db_session.query(Membership).filter_by(user_id=user.id).delete()
    user.session_version += 1
    db_session.flush()
    assert mom.get("/api/me").status_code == 401


def test_viewer_cannot_use_caregiver_route(make_client, outbox, db_session, app_overrides):
    owner = make_client()
    login(owner, outbox, OWNER)
    fam = db_session.query(Family).one()
    db_session.add(Invite(family_id=fam.id, email="aunt@x.com", role="viewer"))
    db_session.flush()
    aunt = make_client()
    login(aunt, outbox, "aunt@x.com")

    probe = FastAPI()
    probe.dependency_overrides = app_overrides.dependency_overrides

    @probe.post("/write")
    def write(_m=Depends(auth_deps.require_caregiver)):
        return {"ok": True}

    @probe.get("/read")
    def read(_m=Depends(auth_deps.current_member)):
        return {"ok": True}

    pc = TestClient(probe)
    pc.cookies.update(aunt.cookies)
    assert pc.post("/write").status_code == 403
    assert pc.get("/read").status_code == 200
    oc = TestClient(probe)
    oc.cookies.update(owner.cookies)
    assert oc.post("/write").status_code == 200


def test_logout_clears_session(make_client, outbox):
    c = make_client()
    login(c, outbox, OWNER)
    assert c.get("/api/me").status_code == 200
    c.post("/api/auth/logout")
    assert c.get("/api/me").status_code == 401
