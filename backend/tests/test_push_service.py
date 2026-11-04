from types import SimpleNamespace

from pywebpush import WebPushException

from app.config import Settings
from app.models import PushSubscription
from app.services import push

PARAMS = {"kid": "Baby", "name": "Mom", "time": "1:00 PM"}


def _sub():
    return PushSubscription(endpoint="https://push.test/x", p256dh="p", auth="a")


def test_send_sets_a_network_timeout(monkeypatch):
    seen = {}
    monkeypatch.setattr(push, "webpush", lambda **kw: seen.update(kw))
    monkeypatch.setattr(push, "get_settings", lambda: Settings(vapid_private_key="k"))
    assert push.send(_sub(), "feed_due", PARAMS) == "ok"
    assert seen["timeout"] == 10


def test_410_means_gone_and_other_failures_are_errors(monkeypatch):
    monkeypatch.setattr(push, "get_settings", lambda: Settings(vapid_private_key="k"))

    def fail(status):
        def _raise(**kw):
            raise WebPushException("nope", response=SimpleNamespace(status_code=status))

        return _raise

    monkeypatch.setattr(push, "webpush", fail(410))
    assert push.send(_sub(), "feed_due", PARAMS) == "gone"
    monkeypatch.setattr(push, "webpush", fail(503))
    assert push.send(_sub(), "feed_due", PARAMS) == "error"
