from app.models import NotificationPref, PushSubscription

SUB = {"endpoint": "https://push.test/abc", "keys": {"p256dh": "P", "auth": "A"}}


def test_public_key_is_served(family, app_overrides):
    from app.config import Settings, get_settings

    app_overrides.dependency_overrides[get_settings] = lambda: Settings(vapid_public_key="PUB", owner_email="owner@x.com", session_secret="test-secret")
    assert family.mom.get("/api/push/public-key").json() == {"public_key": "PUB"}


def test_subscribe_is_idempotent_and_per_user(family, db_session):
    assert family.mom.post("/api/push/subscribe", json=SUB).status_code == 200
    assert family.mom.post("/api/push/subscribe", json=SUB).status_code == 200
    assert db_session.query(PushSubscription).count() == 1
    # the same browser endpoint handed to another account moves to that account
    family.owner.post("/api/push/subscribe", json=SUB)
    me = family.owner.get("/api/me").json()["user"]["id"]
    assert str(db_session.query(PushSubscription).one().user_id) == me


def test_unsubscribe_removes_only_that_endpoint(family, db_session):
    family.mom.post("/api/push/subscribe", json=SUB)
    family.mom.post("/api/push/subscribe", json={**SUB, "endpoint": "https://push.test/other"})
    assert family.mom.request("DELETE", "/api/push/subscribe", json={"endpoint": SUB["endpoint"]}).status_code == 200
    assert [p.endpoint for p in db_session.query(PushSubscription)] == ["https://push.test/other"]


def test_viewer_can_subscribe_but_requires_login(family, make_client):
    assert family.aunt.post("/api/push/subscribe", json=SUB).status_code == 200
    assert make_client().post("/api/push/subscribe", json=SUB).status_code == 401


def test_notification_prefs_default_on_and_persist(family, db_session):
    on = {"feed": True, "diaper": True, "medicine": True, "vaccine": True, "visit": True}
    assert family.mom.get("/api/notification-prefs").json() == on
    assert family.mom.put("/api/notification-prefs", json={"feed": False, "diaper": True, "medicine": False}).status_code == 200
    assert family.mom.get("/api/notification-prefs").json() == {**on, "feed": False, "medicine": False}
    assert family.owner.get("/api/notification-prefs").json() == on
    assert db_session.query(NotificationPref).count() == 5  # one row per kind for mom


def test_older_client_without_medicine_key_keeps_it_on(family):
    assert family.mom.put("/api/notification-prefs", json={"feed": False, "diaper": True}).json() == {
        "feed": False, "diaper": True, "medicine": True, "vaccine": True, "visit": True,
    }
