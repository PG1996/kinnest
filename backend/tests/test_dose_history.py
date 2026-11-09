import uuid
from datetime import UTC, datetime, timedelta

from app.models import MedicineDose
from tests.test_medicines import as_needed, fixed, give, listing, make, syrup


def hist(client, med, body):
    return client.post(f"/api/medicines/{med['id']}/doses/history", json=body)


def hbody(clock, days_ago=10, hour=9, **kw):
    body = {"id": str(uuid.uuid4()), "status": "given", "amount": 1,
            "given_at": clock.at(hour, days=-days_ago).isoformat()}
    body.update(kw)
    return body


# --- add a past dose (admin only) ------------------------------------------------------------------------------------

def test_admin_records_a_past_dose_without_slot_rules(family, clock, db_session):
    med = make(family.owner, syrup(clock))
    body = hbody(clock, days_ago=10, scheduled_for=clock.at(9, days=-10).isoformat())
    r = hist(family.owner, med, body)
    assert r.status_code == 201, r.text
    got = r.json()
    assert got["status"] == "given" and got["amount"] == 1.0 and got["scheduled_for"] == body["scheduled_for"]
    assert db_session.get(MedicineDose, uuid.UUID(body["id"])).given_at == clock.at(9, days=-10)


def test_past_dose_without_a_slot_is_allowed_for_every_schedule_kind(family, clock):
    for body in (syrup(clock), as_needed(clock), fixed(clock)):
        med = make(family.owner, body)
        assert hist(family.owner, med, hbody(clock, amount=0.5)).status_code == 201


def test_past_dose_is_idempotent_on_its_id(family, clock, db_session):
    med = make(family.owner, syrup(clock))
    body = hbody(clock)
    assert hist(family.owner, med, body).status_code == 201
    assert hist(family.owner, med, body).status_code == 200
    assert db_session.query(MedicineDose).filter_by(id=uuid.UUID(body["id"])).count() == 1


def test_past_dose_refuses_the_future_and_bad_amounts(family, clock):
    med = make(family.owner, syrup(clock))
    # the future is judged by the real clock (the `clock` fixture only pins the API's "now" for slots)
    assert hist(family.owner, med, hbody(clock, given_at=(datetime.now(UTC) + timedelta(days=1)).isoformat())).status_code == 422
    assert hist(family.owner, med, hbody(clock, amount=0)).status_code == 422
    assert hist(family.owner, med, hbody(clock, given_at="2026-11-01T10:00:00")).status_code == 422  # no timezone


def test_only_the_admin_records_past_doses(family, clock):
    med = make(family.owner, syrup(clock))
    assert hist(family.mom, med, hbody(clock)).status_code == 403
    assert hist(family.aunt, med, hbody(clock)).status_code == 403


def test_past_skipped_dose_has_no_amount(family, clock, db_session):
    med = make(family.owner, syrup(clock))
    body = hbody(clock, status="skipped", amount=1)
    r = hist(family.owner, med, body)
    assert r.status_code == 201 and r.json()["amount"] is None


def test_past_dose_shows_in_history_and_not_in_other_families_medicine(family, clock):
    med = make(family.owner, syrup(clock))
    body = hbody(clock, days_ago=5)
    hist(family.owner, med, body)
    rows = family.owner.get(f"/api/medicines/{med['id']}/doses").json()
    assert [r["id"] for r in rows] == [body["id"]]


# --- fix a recorded dose (admin only) --------------------------------------------------------------------------------

def patch(client, med, dose_id, body):
    return client.patch(f"/api/medicines/{med['id']}/doses/{dose_id}", json=body)


def test_admin_fixes_amount_time_and_note(family, clock):
    med = make(family.owner, syrup(clock))
    body = hbody(clock, days_ago=3)
    hist(family.owner, med, body)
    new_time = clock.at(21, days=-3)
    r = patch(family.owner, med, body["id"], {"amount": 0.5, "given_at": new_time.isoformat(), "note": "gave half"})
    assert r.status_code == 200, r.text
    got = r.json()
    assert got["amount"] == 0.5 and got["note"] == "gave half" and got["given_at"].startswith(new_time.isoformat()[:16])


def test_admin_can_turn_a_given_dose_into_skipped_and_back(family, clock):
    med = make(family.owner, syrup(clock))
    body = hbody(clock)
    hist(family.owner, med, body)
    r = patch(family.owner, med, body["id"], {"status": "skipped"})
    assert r.json()["status"] == "skipped" and r.json()["amount"] is None
    r = patch(family.owner, med, body["id"], {"status": "given", "amount": 1})
    assert r.json()["status"] == "given" and r.json()["amount"] == 1.0


def test_fix_refuses_the_future_a_zero_amount_and_empty_changes(family, clock):
    med = make(family.owner, syrup(clock))
    body = hbody(clock)
    hist(family.owner, med, body)
    assert patch(family.owner, med, body["id"], {"given_at": (datetime.now(UTC) + timedelta(days=1)).isoformat()}).status_code == 422
    assert patch(family.owner, med, body["id"], {"amount": 0}).status_code == 422
    assert patch(family.owner, med, body["id"], {}).status_code == 422


def test_only_the_admin_fixes_doses(family, clock):
    med = make(family.owner, syrup(clock))
    body = hbody(clock)
    hist(family.owner, med, body)
    assert patch(family.mom, med, body["id"], {"amount": 0.5}).status_code == 403
    assert patch(family.aunt, med, body["id"], {"amount": 0.5}).status_code == 403


def test_fix_404s_for_deleted_and_other_medicine_doses(family, clock):
    a = make(family.owner, syrup(clock))
    b = make(family.owner, syrup(clock, ))
    body = hbody(clock)
    hist(family.owner, a, body)
    assert patch(family.owner, b, body["id"], {"amount": 0.5}).status_code == 404  # another medicine's dose
    family.owner.delete(f"/api/medicines/{a['id']}/doses/{body['id']}")
    assert patch(family.owner, a, body["id"], {"amount": 0.5}).status_code == 404  # already deleted
    assert patch(family.owner, a, str(uuid.uuid4()), {"amount": 0.5}).status_code == 404


def test_fixing_a_dose_updates_the_slot_progress(family, clock):
    med = make(family.owner, syrup(clock))
    slot = listing(family.owner)[0]["slots"][0]
    first = {"id": str(uuid.uuid4()), "status": "given", "amount": 0.25, "scheduled_for": slot["due_at"]}
    assert give(family.mom, med, first).status_code == 201
    patch(family.owner, med, first["id"], {"amount": 0.75})
    again = listing(family.owner)[0]["slots"][0]
    assert again["given_amount"] == 0.75 and again["remaining"] == 0.25


# --- move a dose to another slot --------------------------------------------------------------------------------------

def slot_status(client, due):
    from tests.test_medicines import when

    m = listing(client)[0]
    return next((s["status"] for s in m["slots"] if when(s["due_at"]) == due), None)  # a resolved old slot is not listed


def test_admin_moves_a_dose_from_yesterdays_slot_to_todays(family, clock):
    med = make(family.owner, syrup(clock))
    yesterday_slot, today_slot = clock.at(9, days=-1), clock.at(9)
    d = {"id": str(uuid.uuid4()), "status": "given", "amount": 1, "scheduled_for": yesterday_slot.isoformat()}
    assert give(family.mom, med, d).status_code == 201
    assert slot_status(family.owner, yesterday_slot) is None and slot_status(family.owner, today_slot) == "pending"
    r = patch(family.owner, med, d["id"], {"scheduled_for": today_slot.isoformat()})
    assert r.status_code == 200, r.text
    assert slot_status(family.owner, today_slot) == "given" and slot_status(family.owner, yesterday_slot) == "pending"


def test_admin_can_take_a_dose_off_its_slot(family, clock):
    med = make(family.owner, syrup(clock))
    slot = clock.at(9)
    d = {"id": str(uuid.uuid4()), "status": "given", "amount": 1, "scheduled_for": slot.isoformat()}
    give(family.mom, med, d)
    r = patch(family.owner, med, d["id"], {"scheduled_for": None})
    assert r.status_code == 200 and r.json()["scheduled_for"] is None
    assert slot_status(family.owner, slot) == "pending"


def test_a_dose_can_only_move_to_a_real_slot(family, clock):
    med = make(family.owner, syrup(clock))
    d = {"id": str(uuid.uuid4()), "status": "given", "amount": 1, "scheduled_for": clock.at(9).isoformat()}
    give(family.mom, med, d)
    assert patch(family.owner, med, d["id"], {"scheduled_for": clock.at(10, 30).isoformat()}).status_code == 422
    assert patch(family.owner, med, d["id"], {"scheduled_for": "2026-11-01T09:00:00"}).status_code == 422  # no timezone


def test_as_needed_doses_have_no_slot_to_move_to(family, clock):
    med = make(family.owner, as_needed(clock))
    body = hbody(clock, days_ago=1)
    hist(family.owner, med, body)
    assert patch(family.owner, med, body["id"], {"scheduled_for": clock.at(9).isoformat()}).status_code == 422
    assert patch(family.owner, med, body["id"], {"scheduled_for": None}).status_code == 200  # clearing a slot is always fine
