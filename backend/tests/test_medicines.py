import uuid
from datetime import datetime, timedelta

from app.models import Medicine, MedicineDose


def fixed(clock, **kw):
    body = {
        "name": "Vitamin D", "dose": "5 drops", "schedule_kind": "fixed", "times": ["09:00", "21:00"],
        "start_date": (clock.day - timedelta(days=7)).isoformat(),
    }
    body.update(kw)
    return body


def interval(clock, **kw):
    return fixed(clock, name="Antibiotic", dose="2.5 ml", schedule_kind="interval", times=[], interval_hours=8,
                 first_dose_at=clock.at(8).isoformat(), **kw)


def as_needed(clock, **kw):
    return fixed(clock, name="Paracetamol", dose="1.5 ml", schedule_kind="as_needed", times=[], min_gap_hours=6, **kw)


def make(client, body):
    r = client.post("/api/medicines", json=body)
    assert r.status_code == 201, r.text
    return r.json()


def listing(client, **params):
    r = client.get("/api/medicines", params=params)
    assert r.status_code == 200, r.text
    return r.json()


def dose(**kw):
    body = {"id": str(uuid.uuid4()), "status": "given"}
    body.update(kw)
    return body


def when(s):
    return datetime.fromisoformat(s)


def test_only_admin_can_create_edit_delete_medicine(family, clock):
    assert family.mom.post("/api/medicines", json=fixed(clock)).status_code == 403
    assert family.aunt.post("/api/medicines", json=fixed(clock)).status_code == 403
    med = make(family.owner, fixed(clock))
    assert family.mom.patch(f"/api/medicines/{med['id']}", json={"name": "X"}).status_code == 403
    assert family.mom.delete(f"/api/medicines/{med['id']}").status_code == 403
    assert family.owner.patch(f"/api/medicines/{med['id']}", json={"name": "Vit D3"}).json()["name"] == "Vit D3"
    assert family.owner.delete(f"/api/medicines/{med['id']}").status_code == 200
    assert listing(family.owner) == []


def test_fixed_medicine_slots_listed_for_today(family, clock):
    make(family.owner, fixed(clock))
    for who in (family.owner, family.mom, family.aunt):  # everyone, viewers included, can read
        m = listing(who)[0]
        assert m["schedule_kind"] == "fixed" and m["times"] == ["09:00", "21:00"] and m["ended"] is False
        slots = [(when(s["due_at"]), s["status"]) for s in m["slots"]]
        assert (clock.at(9), "pending") in slots and (clock.at(21), "pending") in slots


def test_a_missed_slot_from_yesterday_still_shows_as_pending(family, clock):
    make(family.owner, fixed(clock))
    due = [when(s["due_at"]) for s in listing(family.mom)[0]["slots"]]
    # yesterday's 09:00 (25 h old) and 21:00 (13 h old) are inside the 36 h window; older ones are dropped
    assert due == [clock.at(9, days=-1), clock.at(21, days=-1), clock.at(9), clock.at(21)]


def test_give_dose_for_due_slot_is_201_and_marks_slot_given(family, clock):
    med = make(family.owner, fixed(clock))
    r = family.mom.post(f"/api/medicines/{med['id']}/doses", json=dose(scheduled_for=clock.at(9).isoformat()))
    assert r.status_code == 201 and r.json()["by_name"] == "mom" and r.json()["gap_warning"] is None
    m = listing(family.aunt)[0]
    nine = next(s for s in m["slots"] if when(s["due_at"]) == clock.at(9))
    assert nine["status"] == "given" and nine["dose_id"] == r.json()["id"] and nine["by_name"] == "mom"
    assert m["last_dose"]["id"] == r.json()["id"] and m["last_dose"]["status"] == "given"


def test_skip_marks_slot_skipped(family, clock):
    med = make(family.owner, fixed(clock))
    family.mom.post(f"/api/medicines/{med['id']}/doses", json=dose(status="skipped", scheduled_for=clock.at(9).isoformat()))
    nine = next(s for s in listing(family.mom)[0]["slots"] if when(s["due_at"]) == clock.at(9))
    assert nine["status"] == "skipped"


def test_same_slot_from_two_phones_keeps_one_row_returns_200(family, clock, db_session):
    med = make(family.owner, fixed(clock))
    slot = clock.at(9).isoformat()
    first = family.mom.post(f"/api/medicines/{med['id']}/doses", json=dose(scheduled_for=slot))
    second = family.owner.post(f"/api/medicines/{med['id']}/doses", json=dose(scheduled_for=slot))
    assert first.status_code == 201 and second.status_code == 200
    assert second.json()["id"] == first.json()["id"] and second.json()["by_name"] == "mom"
    assert db_session.query(MedicineDose).count() == 1


def test_same_dose_id_resent_returns_200(family, clock, db_session):
    med = make(family.owner, fixed(clock))
    body = dose(scheduled_for=clock.at(9).isoformat())
    assert family.mom.post(f"/api/medicines/{med['id']}/doses", json=body).status_code == 201
    assert family.mom.post(f"/api/medicines/{med['id']}/doses", json=body).status_code == 200
    assert db_session.query(MedicineDose).count() == 1


def test_dose_for_unknown_slot_is_409(family, clock, db_session):
    med = make(family.owner, fixed(clock))
    for bad in (clock.at(9, 30), clock.at(9, days=-3), clock.at(9, days=1)):
        r = family.mom.post(f"/api/medicines/{med['id']}/doses", json=dose(scheduled_for=bad.isoformat()))
        assert r.status_code == 409, bad
    assert db_session.query(MedicineDose).count() == 0


def test_scheduled_dose_needs_scheduled_for(family, clock):
    med = make(family.owner, fixed(clock))
    assert family.mom.post(f"/api/medicines/{med['id']}/doses", json=dose()).status_code == 422


def test_viewer_cannot_give_dose(family, clock):
    med = make(family.owner, fixed(clock))
    r = family.aunt.post(f"/api/medicines/{med['id']}/doses", json=dose(scheduled_for=clock.at(9).isoformat()))
    assert r.status_code == 403


def test_as_needed_inside_min_gap_saves_with_warning(family, clock, db_session):
    med = make(family.owner, as_needed(clock))
    url = f"/api/medicines/{med['id']}/doses"
    first_at = clock.now - timedelta(hours=5)
    first = family.mom.post(url, json=dose(given_at=first_at.isoformat()))
    assert first.status_code == 201 and first.json()["gap_warning"] is None
    second = family.owner.post(url, json=dose(given_at=(clock.now - timedelta(hours=1)).isoformat()))
    assert second.status_code == 201  # never blocked
    assert when(second.json()["gap_warning"]["last_given_at"]) == first_at
    assert db_session.query(MedicineDose).count() == 2
    assert when(listing(family.mom)[0]["last_dose"]["given_at"]) == clock.now - timedelta(hours=1)


def test_as_needed_outside_min_gap_has_no_warning(family, clock):
    med = make(family.owner, as_needed(clock))
    url = f"/api/medicines/{med['id']}/doses"
    family.mom.post(url, json=dose(given_at=(clock.now - timedelta(hours=9)).isoformat()))
    r = family.mom.post(url, json=dose(given_at=(clock.now - timedelta(hours=1)).isoformat()))
    assert r.json()["gap_warning"] is None


def test_as_needed_rejects_scheduled_for_and_skipped(family, clock):
    med = make(family.owner, as_needed(clock))
    url = f"/api/medicines/{med['id']}/doses"
    assert family.mom.post(url, json=dose(scheduled_for=clock.at(9).isoformat())).status_code == 422
    assert family.mom.post(url, json=dose(status="skipped")).status_code == 422


def test_interval_next_slot_moves_after_late_dose(family, clock):
    med = make(family.owner, interval(clock))
    assert [when(s["due_at"]) for s in listing(family.mom)[0]["slots"]] == [clock.at(8)]
    r = family.mom.post(
        f"/api/medicines/{med['id']}/doses",
        json=dose(scheduled_for=clock.at(8).isoformat(), given_at=clock.at(9, 15).isoformat()),
    )
    assert r.status_code == 201
    slots = listing(family.mom)[0]["slots"]
    assert [(when(s["due_at"]), s["status"]) for s in slots] == [(clock.at(17, 15), "pending")]


def test_ended_medicine_hidden_unless_included(family, clock):
    make(family.owner, fixed(clock, end_date=(clock.day - timedelta(days=1)).isoformat()))
    assert listing(family.mom) == []
    past = listing(family.mom, include_ended="true")
    assert len(past) == 1 and past[0]["ended"] is True and past[0]["slots"] == []


def test_delete_medicine_keeps_history(family, clock, db_session):
    med = make(family.owner, fixed(clock))
    family.mom.post(f"/api/medicines/{med['id']}/doses", json=dose(scheduled_for=clock.at(9).isoformat()))
    assert family.owner.delete(f"/api/medicines/{med['id']}").status_code == 200
    assert listing(family.owner) == []
    assert db_session.query(MedicineDose).count() == 1
    assert db_session.query(Medicine).one().deleted_at is not None
    gone = family.mom.post(f"/api/medicines/{med['id']}/doses", json=dose(scheduled_for=clock.at(21).isoformat()))
    assert gone.status_code == 404


def test_undo_dose_reopens_slot(family, clock):
    med = make(family.owner, fixed(clock))
    slot = clock.at(9).isoformat()
    first = family.mom.post(f"/api/medicines/{med['id']}/doses", json=dose(scheduled_for=slot)).json()
    assert family.mom.delete(f"/api/medicines/{med['id']}/doses/{first['id']}").status_code == 200
    nine = next(s for s in listing(family.mom)[0]["slots"] if when(s["due_at"]) == clock.at(9))
    assert nine["status"] == "pending"
    again = family.owner.post(f"/api/medicines/{med['id']}/doses", json=dose(scheduled_for=slot))
    assert again.status_code == 201 and again.json()["id"] != first["id"]
    assert family.aunt.delete(f"/api/medicines/{med['id']}/doses/{again.json()['id']}").status_code == 403


def test_dose_history_is_readable_by_everyone(family, clock):
    med = make(family.owner, as_needed(clock))
    url = f"/api/medicines/{med['id']}/doses"
    family.mom.post(url, json=dose(given_at=(clock.now - timedelta(hours=8)).isoformat()))
    family.mom.post(url, json=dose(given_at=(clock.now - timedelta(hours=1)).isoformat()))
    rows = family.aunt.get(url).json()
    assert len(rows) == 2 and when(rows[0]["given_at"]) > when(rows[1]["given_at"])  # newest first
    since = (clock.now - timedelta(hours=3)).isoformat()
    assert len(family.aunt.get(url, params={"from": since}).json()) == 1


def test_future_given_at_is_422(family, clock):
    med = make(family.owner, as_needed(clock))
    future = (datetime.now(clock.now.tzinfo) + timedelta(hours=1)).isoformat()
    assert family.mom.post(f"/api/medicines/{med['id']}/doses", json=dose(given_at=future)).status_code == 422


def test_validation_errors_422(family, clock):
    def post(**kw):
        return family.owner.post("/api/medicines", json=fixed(clock, **kw)).status_code

    assert post(times=["9:00"]) == 422  # not HH:MM
    assert post(times=["25:00"]) == 422
    assert post(times=[]) == 422  # fixed needs at least one time
    assert post(times=["09:00", "09:00"]) == 422  # duplicates
    assert post(schedule_kind="interval", times=[]) == 422  # needs hours and first dose
    assert post(schedule_kind="interval", times=[], interval_hours=0, first_dose_at=clock.at(8).isoformat()) == 422
    assert post(schedule_kind="interval", times=[], interval_hours=100, first_dose_at=clock.at(8).isoformat()) == 422
    assert post(schedule_kind="as_needed", times=[], min_gap_hours=0) == 422
    assert post(end_date=(clock.day - timedelta(days=30)).isoformat()) == 422  # before start
    assert post(name="") == 422
    assert post(schedule_kind="weekly") == 422


def test_patch_is_validated_against_the_merged_medicine(family, clock):
    med = make(family.owner, fixed(clock))
    assert family.owner.patch(f"/api/medicines/{med['id']}", json={"schedule_kind": "interval"}).status_code == 422
    ok = family.owner.patch(
        f"/api/medicines/{med['id']}",
        json={"schedule_kind": "interval", "interval_hours": 6, "first_dose_at": clock.at(8).isoformat()},
    )
    assert ok.status_code == 200 and ok.json()["schedule_kind"] == "interval"
    assert family.owner.patch(f"/api/medicines/{uuid.uuid4()}", json={"name": "x"}).status_code == 404
