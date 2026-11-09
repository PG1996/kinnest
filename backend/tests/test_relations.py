import uuid
from datetime import UTC, datetime, timedelta

from app.models import Family, Feed, Invite
from tests.conftest import OWNER, login


def _uid(client) -> str:
    return client.get("/api/me").json()["user"]["id"]


def _set(owner, user_id, relation):
    return owner.patch(f"/api/family/members/{user_id}", json={"relation": relation})


def _feed(**kw):
    body = {"id": str(uuid.uuid4()), "type": "formula", "started_at": (datetime.now(UTC) - timedelta(minutes=5)).isoformat(), "quantity_ml": 60}
    body.update(kw)
    return body


def test_a_new_family_needs_a_parent_until_mom_or_dad_is_set(family):
    me = family.owner.get("/api/me").json()
    assert me["relation"] is None and me["needs_parent"] is True
    assert _set(family.owner, _uid(family.owner), "dad").status_code == 200
    me = family.owner.get("/api/me").json()
    assert me["relation"] == "dad" and me["needs_parent"] is False


def test_relation_is_optional_and_listed_for_admins_and_caregivers(family):
    assert _set(family.owner, _uid(family.mom), "nanny").status_code == 200
    rows = {m["email"]: m for m in family.owner.get("/api/family/members").json()}
    assert rows["mom@x.com"]["relation"] == "nanny"
    assert rows[OWNER]["relation"] is None
    assert _set(family.owner, _uid(family.mom), None).status_code == 200  # clearing a non-parent relation is fine


def test_only_an_admin_sets_a_relation_and_unknown_ones_are_refused(family):
    assert _set(family.mom, _uid(family.mom), "mom").status_code == 403
    assert _set(family.owner, _uid(family.mom), "uncle-bob").status_code == 422


def test_only_one_mom_and_one_dad(family):
    assert _set(family.owner, _uid(family.owner), "dad").status_code == 200
    assert _set(family.owner, _uid(family.mom), "mom").status_code == 200
    assert _set(family.owner, _uid(family.aunt), "mom").status_code == 409
    assert _set(family.owner, _uid(family.aunt), "dad").status_code == 409


def test_the_last_mom_or_dad_cannot_be_cleared_changed_or_removed(family):
    me = _uid(family.owner)
    assert _set(family.owner, me, "dad").status_code == 200
    assert _set(family.owner, me, None).status_code == 409
    assert _set(family.owner, me, "other").status_code == 409
    assert family.owner.delete(f"/api/family/members/{me}").status_code == 409
    # with a second parent, either can go
    assert _set(family.owner, _uid(family.mom), "mom").status_code == 200
    assert _set(family.owner, me, None).status_code == 200


def test_a_caregiver_who_is_the_only_parent_cannot_be_removed(family):
    assert _set(family.owner, _uid(family.mom), "mom").status_code == 200
    assert family.owner.delete(f"/api/family/members/{_uid(family.mom)}").status_code == 409


def test_an_invite_can_carry_a_relation_that_is_applied_on_first_login(make_client, outbox, db_session):
    owner = make_client()
    login(owner, outbox, OWNER)
    assert owner.post("/api/family/invites", json={"email": "wife@x.com", "role": "caregiver", "relation": "mom"}).status_code == 200
    pending = [m for m in owner.get("/api/family/members").json() if m["pending"]]
    assert pending[0]["relation"] == "mom"
    wife = make_client()
    login(wife, outbox, "wife@x.com")
    assert wife.get("/api/me").json()["relation"] == "mom"


def test_an_invite_for_a_taken_mom_or_dad_is_refused(family):
    assert _set(family.owner, _uid(family.mom), "mom").status_code == 200
    r = family.owner.post("/api/family/invites", json={"email": "x@x.com", "role": "caregiver", "relation": "mom"})
    assert r.status_code == 409


def test_a_breast_feed_is_always_fed_by_mom(family):
    assert _set(family.owner, _uid(family.mom), "mom").status_code == 200
    mom_id = _uid(family.mom)
    # the dad logs it, and even names himself: it still says mom
    for kind in ("breast_left", "breast_right", "breast_both"):
        r = family.owner.post("/api/feeds", json=_feed(type=kind, quantity_ml=None, duration_min=10, fed_by_user_id=_uid(family.owner)))
        assert r.status_code == 201 and r.json()["fed_by_user_id"] == mom_id


def test_a_bottle_feed_can_name_any_admin_or_caregiver_but_not_a_viewer(family):
    assert _set(family.owner, _uid(family.mom), "mom").status_code == 200
    r = family.mom.post("/api/feeds", json=_feed(fed_by_user_id=_uid(family.owner)))
    assert r.status_code == 201 and r.json()["fed_by_user_id"] == _uid(family.owner)
    assert family.mom.post("/api/feeds", json=_feed(fed_by_user_id=_uid(family.aunt))).status_code == 422
    # unnamed: the person logging it
    assert family.owner.post("/api/feeds", json=_feed()).json()["fed_by_user_id"] == _uid(family.owner)


def test_without_a_mom_a_breast_feed_falls_back_to_the_logger(family):
    assert _set(family.owner, _uid(family.owner), "dad").status_code == 200
    r = family.owner.post("/api/feeds", json=_feed(type="breast_left", quantity_ml=None, duration_min=8))
    assert r.json()["fed_by_user_id"] == _uid(family.owner)


def test_changing_a_feed_to_breast_makes_it_mom_s_and_bottle_keeps_who_fed(family, db_session):
    assert _set(family.owner, _uid(family.mom), "mom").status_code == 200
    made = family.owner.post("/api/feeds", json=_feed()).json()
    assert made["fed_by_user_id"] == _uid(family.owner)
    r = family.owner.patch(f"/api/feeds/{made['id']}", json={"type": "breast_left", "quantity_ml": None, "duration_min": 9})
    assert r.json()["fed_by_user_id"] == _uid(family.mom)
    r = family.owner.patch(f"/api/feeds/{made['id']}", json={"type": "formula", "quantity_ml": 50, "fed_by_user_id": _uid(family.owner)})
    assert r.json()["fed_by_user_id"] == _uid(family.owner)
    r = family.owner.patch(f"/api/feeds/{made['id']}", json={"fed_by_user_id": _uid(family.aunt)})
    assert r.status_code == 422


def _diaper(**kw):
    body = {"id": str(uuid.uuid4()), "kind": "wet", "at": (datetime.now(UTC) - timedelta(minutes=5)).isoformat()}
    body.update(kw)
    return body


def test_a_diaper_can_be_changed_by_any_admin_or_caregiver_but_not_a_viewer(family):
    # dad logs it, the nanny (a caregiver) changed it
    r = family.owner.post("/api/diapers", json=_diaper(changed_by_user_id=_uid(family.mom)))
    assert r.status_code == 201 and r.json()["changed_by_user_id"] == _uid(family.mom)
    assert family.owner.post("/api/diapers", json=_diaper(changed_by_user_id=_uid(family.aunt))).status_code == 422
    assert family.owner.post("/api/diapers", json=_diaper()).json()["changed_by_user_id"] == _uid(family.owner)  # unnamed: the logger


def test_editing_a_diaper_can_change_who_changed_it(family):
    made = family.owner.post("/api/diapers", json=_diaper()).json()
    r = family.owner.patch(f"/api/diapers/{made['id']}", json={"changed_by_user_id": _uid(family.mom)})
    assert r.json()["changed_by_user_id"] == _uid(family.mom)
    assert family.owner.patch(f"/api/diapers/{made['id']}", json={"changed_by_user_id": _uid(family.aunt)}).status_code == 422
