from app.models import Family, Invite
from tests.conftest import OWNER, login


def _owner_and_caregiver(make_client, outbox, db_session):
    owner = make_client()
    login(owner, outbox, OWNER)
    fam = db_session.query(Family).one()
    db_session.add(Invite(family_id=fam.id, email="mom@x.com", role="caregiver"))
    db_session.flush()
    mom = make_client()
    login(mom, outbox, "mom@x.com")
    return owner, mom


def test_only_admin_can_invite(make_client, outbox, db_session):
    owner, mom = _owner_and_caregiver(make_client, outbox, db_session)
    body = {"email": "Aunt@X.com", "role": "viewer"}
    assert mom.post("/api/family/invites", json=body).status_code == 403
    outbox.clear()
    assert owner.post("/api/family/invites", json=body).status_code == 200
    assert outbox and outbox[0].to == "aunt@x.com"
    members = owner.get("/api/family/members").json()
    assert any(m["email"] == "aunt@x.com" and m["pending"] and m["role"] == "viewer" for m in members)


def test_cannot_demote_last_admin(make_client, outbox, db_session):
    owner, _ = _owner_and_caregiver(make_client, outbox, db_session)
    me = owner.get("/api/me").json()["user"]["id"]
    assert owner.patch(f"/api/family/members/{me}", json={"role": "caregiver"}).status_code == 409
    assert owner.delete(f"/api/family/members/{me}").status_code == 409


def test_remove_member_revokes_access(make_client, outbox, db_session):
    owner, mom = _owner_and_caregiver(make_client, outbox, db_session)
    mom_id = mom.get("/api/me").json()["user"]["id"]
    assert mom.delete(f"/api/family/members/{mom_id}").status_code == 403
    assert owner.delete(f"/api/family/members/{mom_id}").status_code == 200
    assert mom.get("/api/me").status_code == 401
    emails = [m["email"] for m in owner.get("/api/family/members").json()]
    assert "mom@x.com" not in emails


def test_role_change_applies(make_client, outbox, db_session):
    owner, mom = _owner_and_caregiver(make_client, outbox, db_session)
    mom_id = mom.get("/api/me").json()["user"]["id"]
    assert owner.patch(f"/api/family/members/{mom_id}", json={"role": "viewer"}).status_code == 200
    assert mom.get("/api/me").json()["role"] == "viewer"


def test_patch_kid_interval_rejects_nonpositive(make_client, outbox, db_session):
    owner, mom = _owner_and_caregiver(make_client, outbox, db_session)
    assert owner.patch("/api/kid", json={"feed_interval_minutes": 0}).status_code == 422
    assert owner.patch("/api/kid", json={"feed_interval_minutes": 150, "name": "Aanya"}).status_code == 200
    kid = mom.get("/api/kid").json()
    assert kid["feed_interval_minutes"] == 150 and kid["name"] == "Aanya"
    assert mom.patch("/api/kid", json={"name": "X"}).status_code == 403
