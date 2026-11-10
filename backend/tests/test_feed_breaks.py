"""Pausing a feed timer, the breaks saved with a feed, and the 'feeding now' notification."""

import uuid
from datetime import UTC, datetime, timedelta

from app.models import Feed
from tests.test_feed_timer import _timer

SUB = {"endpoint": "https://push.test/mom", "keys": {"p256dh": "P", "auth": "A"}}


# --- pausing --------------------------------------------------------------------------------------------------------------

def test_a_new_timer_has_no_pause(family):
    t = family.mom.post("/api/feed-timer", json=_timer()).json()
    assert t["paused_at"] is None and t["paused_total_s"] == 0


def test_pause_and_resume_add_up_the_break(family, clock):
    start = clock.now - timedelta(minutes=20)
    family.mom.post("/api/feed-timer", json=_timer(started_at=start.isoformat()))
    paused = family.mom.patch("/api/feed-timer", json={"paused": True}).json()
    assert datetime.fromisoformat(paused["paused_at"]) == clock.now
    clock.now += timedelta(minutes=4)
    resumed = family.mom.patch("/api/feed-timer", json={"paused": False}).json()
    assert resumed["paused_at"] is None and resumed["paused_total_s"] == 240
    family.mom.patch("/api/feed-timer", json={"paused": True})
    clock.now += timedelta(minutes=6)
    assert family.owner.patch("/api/feed-timer", json={"paused": False}).json()["paused_total_s"] == 240 + 360  # breaks add up


def test_pausing_twice_or_resuming_when_not_paused_changes_nothing(family, clock):
    family.mom.post("/api/feed-timer", json=_timer(started_at=(clock.now - timedelta(minutes=9)).isoformat()))
    first = family.mom.patch("/api/feed-timer", json={"paused": True}).json()["paused_at"]
    clock.now += timedelta(minutes=2)
    assert family.mom.patch("/api/feed-timer", json={"paused": True}).json()["paused_at"] == first  # the first pause stands
    family.mom.patch("/api/feed-timer", json={"paused": False})
    assert family.mom.patch("/api/feed-timer", json={"paused": False}).json()["paused_total_s"] == 120


def test_stopping_while_paused_ends_the_feed_when_the_pause_began(family, clock):
    family.mom.post("/api/feed-timer", json=_timer(started_at=(clock.now - timedelta(minutes=30)).isoformat()))
    family.mom.patch("/api/feed-timer", json={"paused": True})
    pause_began = clock.now
    clock.now += timedelta(minutes=5)
    stopped = family.mom.patch("/api/feed-timer", json={"ended_at": clock.now.isoformat()}).json()
    assert datetime.fromisoformat(stopped["ended_at"]) == pause_began
    assert stopped["paused_at"] is None


def test_resuming_after_a_stop_counts_the_gap_as_a_break(family, clock):
    family.mom.post("/api/feed-timer", json=_timer(started_at=(clock.now - timedelta(minutes=30)).isoformat()))
    family.mom.patch("/api/feed-timer", json={"ended_at": clock.now.isoformat()})
    clock.now += timedelta(minutes=7)
    resumed = family.mom.patch("/api/feed-timer", json={"ended_at": None}).json()
    assert resumed["ended_at"] is None and resumed["paused_total_s"] == 7 * 60


def test_a_stopped_timer_cannot_be_paused(family, clock):
    family.mom.post("/api/feed-timer", json=_timer(started_at=(clock.now - timedelta(minutes=10)).isoformat()))
    family.mom.patch("/api/feed-timer", json={"ended_at": clock.now.isoformat()})
    assert family.mom.patch("/api/feed-timer", json={"paused": True}).status_code == 409


def test_a_viewer_cannot_pause(family):
    family.mom.post("/api/feed-timer", json=_timer())
    assert family.aunt.patch("/api/feed-timer", json={"paused": True}).status_code == 403


def test_the_summary_carries_the_pause(family, clock):
    family.mom.post("/api/feed-timer", json=_timer(started_at=(clock.now - timedelta(minutes=10)).isoformat()))
    family.mom.patch("/api/feed-timer", json={"paused": True})
    assert family.aunt.get("/api/summary").json()["feed_timer"]["paused_at"] is not None


# --- breaks saved with a feed ----------------------------------------------------------------------------------------------

def _feed(**kw):
    body = {"id": str(uuid.uuid4()), "type": "breast_left", "started_at": (datetime.now(UTC) - timedelta(minutes=60)).isoformat(), "duration_min": 35}
    body.update(kw)
    return body


def test_a_feed_keeps_its_breaks_and_defaults_to_none(family):
    plain = family.mom.post("/api/feeds", json=_feed()).json()
    assert plain["break_min"] == 0
    with_breaks = family.mom.post("/api/feeds", json=_feed(break_min=15)).json()
    assert with_breaks["break_min"] == 15 and with_breaks["duration_min"] == 35


def test_breaks_can_be_fixed_later_and_are_limited(family):
    f = family.mom.post("/api/feeds", json=_feed(break_min=10)).json()
    assert family.owner.patch(f"/api/feeds/{f['id']}", json={"break_min": 20}).json()["break_min"] == 20
    assert family.mom.post("/api/feeds", json=_feed(break_min=-1)).status_code == 422
    assert family.mom.post("/api/feeds", json=_feed(break_min=601)).status_code == 422


def test_the_next_feed_is_due_from_the_real_end_including_breaks(family):
    started = datetime.now(UTC) - timedelta(minutes=60)
    family.mom.post("/api/feeds", json=_feed(started_at=started.isoformat(), duration_min=35, break_min=15))
    kid = family.mom.get("/api/kid").json()
    due = datetime.fromisoformat(family.aunt.get("/api/summary").json()["next_feed_due_at"])
    assert due == started + timedelta(minutes=35 + 15 + kid["feed_interval_minutes"])


def test_breaks_travel_in_the_lists_and_summary(family):
    f = family.mom.post("/api/feeds", json=_feed(break_min=12)).json()
    assert family.aunt.get("/api/summary").json()["last_feed"]["break_min"] == 12
    assert any(x["id"] == f["id"] and x["break_min"] == 12 for x in family.aunt.get("/api/feeds").json())


# --- the "feeding now" notification ----------------------------------------------------------------------------------------

def _record_pushes(monkeypatch):
    sent: list[tuple[str, dict]] = []
    monkeypatch.setattr("app.api.feed_timer.send_payload", lambda sub, payload, urgency="normal": sent.append((sub.endpoint, payload)) or "ok")
    return sent


def test_starting_a_feed_notifies_the_phones_of_whoever_started_it(family, monkeypatch):
    sent = _record_pushes(monkeypatch)
    family.mom.post("/api/push/subscribe", json=SUB)
    family.mom.post("/api/push/subscribe", json={**SUB, "endpoint": "https://push.test/mom2"})
    family.owner.post("/api/push/subscribe", json={**SUB, "endpoint": "https://push.test/dad"})
    started = _timer(type="breast_left")
    family.mom.post("/api/feed-timer", json=started)
    assert sorted(e for e, _ in sent) == ["https://push.test/mom", "https://push.test/mom2"]  # not the owner's phone
    payload = sent[0][1]
    assert payload["tag"] == "feed_timer" and payload["silent"] is True
    assert "Feeding since" in payload["title"] and "mom" in payload["body"]
    assert payload["url"] == "/?log=feed"
    assert payload["actions"] == [{"action": "stop", "title": "Stop"}]
    assert payload["stopUrl"] == "/?log=feed&timer=stop"
    assert payload["timestamp"] == int(datetime.fromisoformat(started["started_at"]).timestamp() * 1000)


def test_a_repeated_start_or_a_refused_second_timer_sends_nothing_more(family, monkeypatch):
    sent = _record_pushes(monkeypatch)
    family.mom.post("/api/push/subscribe", json=SUB)
    body = _timer()
    family.mom.post("/api/feed-timer", json=body)
    family.mom.post("/api/feed-timer", json=body)  # the same id again
    family.mom.post("/api/feed-timer", json=_timer())  # a second timer: refused
    assert len(sent) == 1


def test_a_failing_push_service_does_not_stop_the_timer(family, monkeypatch):
    def boom(sub, payload, urgency="normal"):
        raise RuntimeError("push service down")

    monkeypatch.setattr("app.api.feed_timer.send_payload", boom)
    family.mom.post("/api/push/subscribe", json=SUB)
    assert family.mom.post("/api/feed-timer", json=_timer()).status_code == 201
    assert family.mom.get("/api/feed-timer").json() is not None
