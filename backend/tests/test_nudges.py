import uuid
from datetime import timedelta
from decimal import Decimal

from app.models import MedicineDose, MedicineNudge, NotificationPref
from app.worker.reminders import tick
from tests.test_medicine_reminders import SLOT, ParamSender, add_med
from tests.test_medicines import give, listing, make, piece, syrup
from tests.test_reminders import FakeSender, ids, world  # noqa: F401  (world is a fixture)


def nudge_body(slot, minutes=10, base=None, **kw):
    body = {"id": str(uuid.uuid4()), "scheduled_for": slot.isoformat(), "remind_at": ((base or slot) + timedelta(minutes=minutes)).isoformat()}
    body.update(kw)
    return body


def post_nudge(client, med, body):
    return client.post(f"/api/medicines/{med['id']}/nudges", json=body)


def slot_json(client, due):
    from tests.test_medicines import when

    return next(s for s in listing(client)[0]["slots"] if when(s["due_at"]) == due)


# --- API ---------------------------------------------------------------------------------------------------------


def test_nudge_only_for_a_slot_with_partial_progress(family, clock):
    med = make(family.owner, syrup(clock))
    slot = clock.at(9)
    assert post_nudge(family.mom, med, nudge_body(slot, base=clock.now)).status_code == 409  # nothing given yet
    give(family.mom, med, piece(0.25, slot))
    assert post_nudge(family.mom, med, nudge_body(slot, base=clock.now)).status_code == 201
    give(family.mom, med, piece(0.75, slot))  # now complete
    assert post_nudge(family.mom, med, nudge_body(slot, base=clock.now)).status_code == 409


def test_nudge_time_must_be_soon_and_in_the_future(family, clock):
    med = make(family.owner, syrup(clock))
    slot = clock.at(9)
    give(family.mom, med, piece(0.25, slot))
    assert post_nudge(family.mom, med, nudge_body(slot, minutes=-5, base=clock.now)).status_code == 422
    assert post_nudge(family.mom, med, nudge_body(slot, minutes=60 * 25, base=clock.now)).status_code == 422
    assert post_nudge(family.mom, med, nudge_body(slot, minutes=60 * 24, base=clock.now)).status_code == 201


def test_nudge_is_listed_on_the_slot_and_cancel_removes_it(family, clock):
    med = make(family.owner, syrup(clock))
    slot = clock.at(9)
    give(family.mom, med, piece(0.25, slot))
    created = post_nudge(family.mom, med, nudge_body(slot, base=clock.now)).json()
    listed = slot_json(family.aunt, slot)["nudge"]
    assert listed["id"] == created["id"]
    assert family.owner.delete(f"/api/medicines/{med['id']}/nudges/{created['id']}").status_code == 200
    assert slot_json(family.aunt, slot)["nudge"] is None
    assert family.owner.delete(f"/api/medicines/{med['id']}/nudges/{uuid.uuid4()}").status_code == 404


def test_a_new_nudge_replaces_the_previous_one_for_the_slot(family, clock, db_session):
    med = make(family.owner, syrup(clock))
    slot = clock.at(9)
    give(family.mom, med, piece(0.25, slot))
    first = post_nudge(family.mom, med, nudge_body(slot, minutes=10, base=clock.now)).json()
    second = post_nudge(family.owner, med, nudge_body(slot, minutes=30, base=clock.now)).json()
    assert slot_json(family.aunt, slot)["nudge"]["id"] == second["id"]
    assert db_session.get(MedicineNudge, uuid.UUID(first["id"])).cancelled_at is not None


def test_nudge_same_id_is_idempotent_and_viewers_cannot_create(family, clock, db_session):
    med = make(family.owner, syrup(clock))
    slot = clock.at(9)
    give(family.mom, med, piece(0.25, slot))
    body = nudge_body(slot, base=clock.now)
    assert post_nudge(family.mom, med, body).status_code == 201
    assert post_nudge(family.mom, med, body).status_code == 200
    assert db_session.query(MedicineNudge).count() == 1
    assert post_nudge(family.aunt, med, nudge_body(slot, base=clock.now)).status_code == 403


# --- worker ------------------------------------------------------------------------------------------------------


def one_ml(world, **kw):
    return add_med(world, name="Syrup", dose_amount=Decimal("1.00"), dose_unit="ml", **kw)


def add_piece(w, med, amount, status="given"):
    u = w.users["mom"]
    d = MedicineDose(
        id=uuid.uuid4(), family_id=w.kid.family_id, kid_id=w.kid.id, medicine_id=med.id, status=status,
        scheduled_for=SLOT, given_at=SLOT + timedelta(minutes=1), amount=Decimal(amount) if amount else None,
        by_user_id=u.id, created_by=u.id, updated_by=u.id,
    )
    w.db.add(d)
    w.db.flush()
    return d


def add_nudge(w, med, minutes=10):
    n = MedicineNudge(
        id=uuid.uuid4(), family_id=w.kid.family_id, kid_id=w.kid.id, medicine_id=med.id, scheduled_for=SLOT,
        remind_at=SLOT + timedelta(minutes=minutes), created_by=w.users["mom"].id,
    )
    w.db.add(n)
    w.db.flush()
    return n


def nudges(sender):
    return [x for x in sender.sent if x[1] == "med_nudge"]


def test_nudge_fires_once_at_its_time_to_all_caregivers_not_viewers(world):
    med = one_ml(world)
    add_piece(world, med, "0.25")
    n = add_nudge(world, med)
    s = FakeSender()
    tick(world.db, SLOT + timedelta(minutes=9), s)
    assert nudges(s) == []
    tick(world.db, SLOT + timedelta(minutes=10), s)
    assert {x[0] for x in nudges(s)} == ids(world, "owner", "mom") and {x[2] for x in nudges(s)} == {"normal"}
    assert {x[3] for x in nudges(s)} == {"/?log=medicine"}
    assert n.fired_at is not None
    s.sent.clear()
    tick(world.db, SLOT + timedelta(minutes=11), s)
    assert nudges(s) == []


def test_nudge_text_says_what_is_left(world):
    med = one_ml(world)
    add_piece(world, med, "0.25")
    add_nudge(world, med)
    s = ParamSender()
    tick(world.db, SLOT + timedelta(minutes=10), s)
    params = [p for p, x in zip(s.params, s.sent) if x[1] == "med_nudge"]
    assert params and params[0]["left"] == "0.75 ml" and params[0]["dose"] == "1 ml" and params[0]["medicine"] == "Syrup"


def test_nudge_is_cancelled_silently_when_the_slot_completes_first(world):
    med = one_ml(world)
    add_piece(world, med, "0.25")
    n = add_nudge(world, med)
    add_piece(world, med, "0.75")
    s = FakeSender()
    tick(world.db, SLOT + timedelta(minutes=10), s)
    assert nudges(s) == [] and n.cancelled_at is not None and n.fired_at is None


def test_nudge_is_cancelled_when_the_slot_is_skipped_or_pieces_are_undone(world):
    med = one_ml(world)
    first = add_piece(world, med, "0.25")
    skipped = add_nudge(world, med)
    add_piece(world, med, None, status="skipped")
    s = FakeSender()
    tick(world.db, SLOT + timedelta(minutes=10), s)
    assert nudges(s) == [] and skipped.cancelled_at is not None
    other = one_ml(world)  # undo case: the only piece is removed, nothing partial is left
    piece_ = add_piece(world, other, "0.25")
    undone = add_nudge(world, other)
    piece_.deleted_at = SLOT
    world.db.flush()
    tick(world.db, SLOT + timedelta(minutes=11), s)
    assert nudges(s) == [] and undone.cancelled_at is not None
    assert first.deleted_at is None


def test_a_stale_nudge_after_an_outage_is_dropped_without_sending(world):
    med = one_ml(world)
    add_piece(world, med, "0.25")
    n = add_nudge(world, med)
    s = FakeSender()
    tick(world.db, SLOT + timedelta(minutes=10, hours=1), s)  # the Mac slept for an hour
    assert nudges(s) == [] and n.fired_at is not None


def test_nudge_for_an_ended_or_deleted_medicine_is_cancelled(world):
    med = one_ml(world)
    add_piece(world, med, "0.25")
    n = add_nudge(world, med)
    med.deleted_at = SLOT
    world.db.flush()
    s = FakeSender()
    tick(world.db, SLOT + timedelta(minutes=10), s)
    assert nudges(s) == [] and n.cancelled_at is not None


def test_nudge_respects_medicine_pref(world):
    med = one_ml(world)
    add_piece(world, med, "0.25")
    add_nudge(world, med)
    world.db.add(NotificationPref(user_id=world.users["mom"].id, kind="medicine", enabled=False))
    world.db.flush()
    s = FakeSender()
    tick(world.db, SLOT + timedelta(minutes=10), s)
    assert {x[0] for x in nudges(s)} == ids(world, "owner")


def test_partial_slot_keeps_escalating_and_says_what_is_left(world):
    med = one_ml(world)
    s = ParamSender()
    tick(world.db, SLOT, s)
    assert {x[1] for x in s.sent} == {"med_due"} and {p["progress"] for p in s.params} == {""}
    add_piece(world, med, "0.25")  # a first piece does not stop the reminders
    s.sent.clear()
    s.params.clear()
    tick(world.db, SLOT + timedelta(minutes=15), s)
    assert {x[1] for x in s.sent} == {"med_due_again"} and {p["progress"] for p in s.params} == {" 0.75 ml left."}
    s.sent.clear()
    tick(world.db, SLOT + timedelta(minutes=30), s)
    assert [x[1] for x in s.sent] == ["med_overdue_admin"]


def test_completing_the_dose_stops_the_chain(world):
    med = one_ml(world)
    s = FakeSender()
    tick(world.db, SLOT, s)
    add_piece(world, med, "0.25")
    add_piece(world, med, "0.75")
    s.sent.clear()
    tick(world.db, SLOT + timedelta(minutes=15), s)
    tick(world.db, SLOT + timedelta(minutes=30), s)
    assert s.sent == []
