import uuid
from datetime import date, datetime, timedelta
from decimal import Decimal

from sqlalchemy import event

from app.models import Medicine, MedicineDose


def fixed(clock, **kw):
    body = {
        "name": "Vitamin D", "dose_amount": 5, "dose_unit": "drops", "schedule_kind": "fixed", "times": ["09:00", "21:00"],
        "start_date": (clock.day - timedelta(days=7)).isoformat(),
    }
    body.update(kw)
    return body


def syrup(clock, **kw):
    """A 1 ml dose at 09:00 only, for partial-dose tests."""
    return fixed(clock, name="Syrup", dose_amount=1, dose_unit="ml", times=["09:00"], **kw)


def interval(clock, **kw):
    return fixed(clock, name="Antibiotic", dose_amount=2.5, dose_unit="ml", schedule_kind="interval", times=[],
                 interval_hours=8, first_dose_at=clock.at(8).isoformat(), **kw)


def as_needed(clock, **kw):
    return fixed(clock, name="Paracetamol", dose_amount=1.5, dose_unit="ml", schedule_kind="as_needed", times=[],
                 min_gap_hours=6, **kw)


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


def full(med, **kw):
    """A given dose of the whole prescribed amount."""
    return dose(amount=med["dose_amount"], **kw)


def piece(amount, slot, **kw):
    return dose(amount=amount, scheduled_for=slot.isoformat(), **kw)


def give(client, med, body):
    return client.post(f"/api/medicines/{med['id']}/doses", json=body)


def slot_at(client, due):
    m = listing(client)[0]
    return next(s for s in m["slots"] if when(s["due_at"]) == due)


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
        assert (m["dose_amount"], m["dose_unit"]) == (5, "drops")
        slots = [(when(s["due_at"]), s["status"], s["given_amount"], s["remaining"]) for s in m["slots"]]
        assert (clock.at(9), "pending", 0, 5) in slots and (clock.at(21), "pending", 0, 5) in slots


def test_a_missed_slot_from_yesterday_still_shows_as_pending(family, clock):
    make(family.owner, fixed(clock))
    due = [when(s["due_at"]) for s in listing(family.mom)[0]["slots"]]
    # yesterday's 09:00 (25 h old) and 21:00 (13 h old) are inside the 36 h window; older ones are dropped
    assert due == [clock.at(9, days=-1), clock.at(21, days=-1), clock.at(9), clock.at(21)]


def test_full_dose_completes_slot(family, clock):
    med = make(family.owner, fixed(clock))
    r = give(family.mom, med, full(med, scheduled_for=clock.at(9).isoformat()))
    assert r.status_code == 201 and r.json()["by_name"] == "mom" and r.json()["gap_warning"] is None
    assert r.json()["amount"] == 5
    assert r.json()["slot"] == {"status": "given", "given_amount": 5, "remaining": 0}
    s = slot_at(family.aunt, clock.at(9))
    assert (s["status"], s["given_amount"], s["remaining"], s["by_name"]) == ("given", 5, 0, "mom")
    assert s["dose_id"] == r.json()["id"] and len(s["doses"]) == 1
    last = listing(family.aunt)[0]["last_dose"]
    assert last["id"] == r.json()["id"] and last["status"] == "given" and last["amount"] == 5


def test_four_quarter_pieces_complete_a_one_ml_slot_and_progress_is_listed(family, clock):
    med = make(family.owner, syrup(clock))
    slot = clock.at(9)
    for i, who in enumerate((family.mom, family.owner, family.mom, family.owner), start=1):
        r = give(who, med, piece(0.25, slot))
        assert r.status_code == 201, r.text
        s = slot_at(family.aunt, slot)
        assert s["given_amount"] == 0.25 * i and s["remaining"] == 1 - 0.25 * i
        assert s["status"] == ("given" if i == 4 else "partial") and len(s["doses"]) == i
    assert [d["amount"] for d in slot_at(family.aunt, slot)["doses"]] == [0.25] * 4
    assert {d["by_name"] for d in slot_at(family.aunt, slot)["doses"]} == {"mom", "owner"}


def test_pieces_add_up_exactly_with_decimals(family, clock):
    med = make(family.owner, syrup(clock))
    for amount in (0.1, 0.2, 0.7):  # 0.1 + 0.2 + 0.7 must be exactly 1, no float drift
        assert give(family.mom, med, piece(amount, clock.at(9))).status_code == 201
    assert slot_at(family.mom, clock.at(9))["status"] == "given"


def test_piece_larger_than_remaining_is_409_with_remaining(family, clock, db_session):
    med = make(family.owner, syrup(clock))
    assert give(family.mom, med, piece(0.75, clock.at(9))).status_code == 201
    r = give(family.owner, med, piece(0.5, clock.at(9)))
    assert r.status_code == 409 and r.json()["remaining"] == 0.25 and "left" in r.json()["detail"]
    assert db_session.query(MedicineDose).count() == 1  # nothing was saved
    assert give(family.owner, med, piece(0.25, clock.at(9))).status_code == 201  # exactly the rest is fine


def test_second_full_dose_for_the_same_slot_is_409_with_remaining_zero(family, clock, db_session):
    med = make(family.owner, fixed(clock))
    slot = clock.at(9).isoformat()
    first = give(family.mom, med, full(med, scheduled_for=slot))
    second = give(family.owner, med, full(med, scheduled_for=slot))
    assert first.status_code == 201 and second.status_code == 409 and second.json()["remaining"] == 0
    assert db_session.query(MedicineDose).count() == 1  # never a double dose


def test_same_dose_id_resent_returns_200(family, clock, db_session):
    med = make(family.owner, fixed(clock))
    body = full(med, scheduled_for=clock.at(9).isoformat())
    assert give(family.mom, med, body).status_code == 201
    again = give(family.mom, med, body)
    assert again.status_code == 200 and again.json()["id"] == body["id"]
    assert db_session.query(MedicineDose).count() == 1


def test_dose_for_unknown_slot_is_409(family, clock, db_session):
    med = make(family.owner, fixed(clock))
    for bad in (clock.at(9, 30), clock.at(9, days=-3), clock.at(9, days=1)):
        assert give(family.mom, med, full(med, scheduled_for=bad.isoformat())).status_code == 409, bad
    assert db_session.query(MedicineDose).count() == 0


def test_scheduled_dose_needs_scheduled_for(family, clock):
    med = make(family.owner, fixed(clock))
    assert give(family.mom, med, full(med)).status_code == 422


def test_viewer_cannot_give_dose(family, clock):
    med = make(family.owner, fixed(clock))
    assert give(family.aunt, med, full(med, scheduled_for=clock.at(9).isoformat())).status_code == 403


def test_skip_marks_slot_skipped(family, clock):
    med = make(family.owner, fixed(clock))
    assert give(family.mom, med, dose(status="skipped", scheduled_for=clock.at(9).isoformat())).status_code == 201
    s = slot_at(family.mom, clock.at(9))
    assert s["status"] == "skipped" and s["given_amount"] == 0


def test_piece_after_skip_is_409(family, clock):
    med = make(family.owner, fixed(clock))
    give(family.mom, med, dose(status="skipped", scheduled_for=clock.at(9).isoformat()))
    r = give(family.owner, med, full(med, scheduled_for=clock.at(9).isoformat()))
    assert r.status_code == 409 and "skipped" in r.json()["detail"]


def test_skip_after_partial_closes_slot_and_keeps_pieces(family, clock):
    med = make(family.owner, syrup(clock))
    give(family.mom, med, piece(0.5, clock.at(9)))
    assert give(family.mom, med, dose(status="skipped", scheduled_for=clock.at(9).isoformat())).status_code == 201
    s = slot_at(family.mom, clock.at(9))
    assert (s["status"], s["given_amount"], s["remaining"]) == ("skipped", 0.5, 0.5)
    assert give(family.owner, med, piece(0.25, clock.at(9))).status_code == 409


def test_skipping_a_complete_slot_is_409(family, clock):
    med = make(family.owner, fixed(clock))
    give(family.mom, med, full(med, scheduled_for=clock.at(9).isoformat()))
    assert give(family.mom, med, dose(status="skipped", scheduled_for=clock.at(9).isoformat())).status_code == 409


def test_undo_completing_piece_makes_slot_partial_and_undo_frees_amount(family, clock):
    med = make(family.owner, syrup(clock))
    slot = clock.at(9)
    a = give(family.mom, med, piece(0.5, slot)).json()
    b = give(family.mom, med, piece(0.5, slot)).json()
    assert slot_at(family.mom, slot)["status"] == "given"
    assert family.mom.delete(f"/api/medicines/{med['id']}/doses/{b['id']}").status_code == 200
    s = slot_at(family.mom, slot)
    assert (s["status"], s["given_amount"], s["remaining"]) == ("partial", 0.5, 0.5)
    assert give(family.owner, med, piece(0.5, slot)).status_code == 201  # the freed half can be given again
    assert family.aunt.delete(f"/api/medicines/{med['id']}/doses/{a['id']}").status_code == 403


def test_as_needed_inside_min_gap_saves_with_warning(family, clock, db_session):
    med = make(family.owner, as_needed(clock))
    first_at = clock.now - timedelta(hours=5)
    first = give(family.mom, med, full(med, given_at=first_at.isoformat()))
    assert first.status_code == 201 and first.json()["gap_warning"] is None
    second = give(family.owner, med, full(med, given_at=(clock.now - timedelta(hours=1)).isoformat()))
    assert second.status_code == 201  # never blocked
    assert when(second.json()["gap_warning"]["last_given_at"]) == first_at
    assert db_session.query(MedicineDose).count() == 2
    assert when(listing(family.mom)[0]["last_dose"]["given_at"]) == clock.now - timedelta(hours=1)


def test_as_needed_outside_min_gap_has_no_warning(family, clock):
    med = make(family.owner, as_needed(clock))
    give(family.mom, med, full(med, given_at=(clock.now - timedelta(hours=9)).isoformat()))
    r = give(family.mom, med, full(med, given_at=(clock.now - timedelta(hours=1)).isoformat()))
    assert r.json()["gap_warning"] is None


def test_as_needed_amount_defaults_to_the_full_dose_and_may_be_partial(family, clock):
    med = make(family.owner, as_needed(clock))
    assert give(family.mom, med, dose()).json()["amount"] == 1.5
    assert give(family.mom, med, dose(amount=0.5)).json()["amount"] == 0.5
    assert give(family.mom, med, dose(amount=2)).status_code == 422  # more than one dose


def test_as_needed_rejects_scheduled_for_and_skipped(family, clock):
    med = make(family.owner, as_needed(clock))
    assert give(family.mom, med, full(med, scheduled_for=clock.at(9).isoformat())).status_code == 422
    assert give(family.mom, med, dose(status="skipped")).status_code == 422


def test_interval_next_slot_moves_after_a_late_complete_dose(family, clock):
    med = make(family.owner, interval(clock))
    assert [when(s["due_at"]) for s in listing(family.mom)[0]["slots"]] == [clock.at(8)]
    r = give(family.mom, med, full(med, scheduled_for=clock.at(8).isoformat(), given_at=clock.at(9, 15).isoformat()))
    assert r.status_code == 201
    slots = listing(family.mom)[0]["slots"]
    assert [(when(s["due_at"]), s["status"]) for s in slots] == [(clock.at(17, 15), "pending")]


def test_interval_partial_dose_keeps_the_same_open_slot(family, clock):
    med = make(family.owner, interval(clock))
    give(family.mom, med, piece(1.0, clock.at(8), given_at=clock.at(9).isoformat()))
    slots = listing(family.mom)[0]["slots"]
    assert [(when(s["due_at"]), s["status"], s["remaining"]) for s in slots] == [(clock.at(8), "partial", 1.5)]
    give(family.mom, med, piece(1.5, clock.at(8), given_at=clock.at(9, 40).isoformat()))
    assert [when(s["due_at"]) for s in listing(family.mom)[0]["slots"]] == [clock.at(17, 40)]


def test_ended_medicine_hidden_unless_included(family, clock):
    make(family.owner, fixed(clock, end_date=(clock.day - timedelta(days=1)).isoformat()))
    assert listing(family.mom) == []
    past = listing(family.mom, include_ended="true")
    assert len(past) == 1 and past[0]["ended"] is True and past[0]["slots"] == []


def test_delete_medicine_keeps_history(family, clock, db_session):
    med = make(family.owner, fixed(clock))
    give(family.mom, med, full(med, scheduled_for=clock.at(9).isoformat()))
    assert family.owner.delete(f"/api/medicines/{med['id']}").status_code == 200
    assert listing(family.owner) == []
    assert db_session.query(MedicineDose).count() == 1
    assert db_session.query(Medicine).one().deleted_at is not None
    assert give(family.mom, med, full(med, scheduled_for=clock.at(21).isoformat())).status_code == 404


def test_dose_history_is_readable_by_everyone(family, clock):
    med = make(family.owner, as_needed(clock))
    url = f"/api/medicines/{med['id']}/doses"
    give(family.mom, med, full(med, given_at=(clock.now - timedelta(hours=8)).isoformat()))
    give(family.mom, med, full(med, given_at=(clock.now - timedelta(hours=1)).isoformat()))
    rows = family.aunt.get(url).json()
    assert len(rows) == 2 and when(rows[0]["given_at"]) > when(rows[1]["given_at"])  # newest first
    assert rows[0]["amount"] == 1.5
    since = (clock.now - timedelta(hours=3)).isoformat()
    assert len(family.aunt.get(url, params={"from": since}).json()) == 1


def test_future_given_at_is_422(family, clock):
    med = make(family.owner, as_needed(clock))
    future = (datetime.now(clock.now.tzinfo) + timedelta(hours=1)).isoformat()
    assert give(family.mom, med, full(med, given_at=future)).status_code == 422


def test_dose_amount_validation_422(family, clock):
    med = make(family.owner, syrup(clock))
    slot = clock.at(9)
    for bad in (0, -1, 0.001, 1.005):
        assert give(family.mom, med, piece(bad, slot)).status_code == 422, bad


def test_a_piece_larger_than_the_whole_dose_is_409_with_what_is_left(family, clock, db_session):
    med = make(family.owner, syrup(clock))
    r = give(family.mom, med, piece(1.01, clock.at(9)))
    assert r.status_code == 409 and r.json()["remaining"] == 1
    assert db_session.query(MedicineDose).count() == 0


def test_a_missing_amount_means_the_rest_of_the_dose(family, clock):
    """Entries queued by an older app version carry no amount: they give whatever is left, never more."""
    med = make(family.owner, syrup(clock))
    slot = clock.at(9)
    assert give(family.mom, med, piece(0.25, slot)).status_code == 201
    r = give(family.owner, med, dose(scheduled_for=slot.isoformat()))
    assert r.status_code == 201 and r.json()["amount"] == 0.75
    assert slot_at(family.mom, slot)["status"] == "given"
    assert give(family.owner, med, dose(scheduled_for=slot.isoformat())).status_code == 409  # nothing left to give


def test_pieces_remember_the_dose_they_were_given_under(family, clock, db_session):
    med = make(family.owner, syrup(clock))
    give(family.mom, med, piece(0.25, clock.at(9)))
    row = db_session.query(MedicineDose).one()
    assert (row.prescribed_amount, row.prescribed_unit) == (Decimal("1.00"), "ml")


def test_raising_the_dose_does_not_reopen_a_slot_that_was_already_given(family, clock):
    med = make(family.owner, fixed(clock, name="Syrup", dose_amount=1, dose_unit="ml"))  # 09:00 and 21:00
    slot = clock.at(9)
    assert give(family.mom, med, piece(1, slot)).status_code == 201
    assert family.owner.patch(f"/api/medicines/{med['id']}", json={"dose_amount": 5}).status_code == 200
    s = slot_at(family.mom, slot)
    assert (s["status"], s["given_amount"], s["remaining"]) == ("given", 1, 0)
    assert give(family.mom, med, piece(1, slot)).status_code == 409  # no extra 4 ml for a slot that is done
    tonight = slot_at(family.mom, clock.at(21))
    assert tonight["remaining"] == 5  # slots with nothing given yet use the new dose


def test_lowering_the_dose_keeps_the_rest_of_a_started_slot_at_the_old_amount(family, clock):
    med = make(family.owner, fixed(clock, name="Syrup", dose_amount=5, dose_unit="ml", times=["09:00"]))
    slot = clock.at(9)
    give(family.mom, med, piece(1, slot))
    family.owner.patch(f"/api/medicines/{med['id']}", json={"dose_amount": 2.5})
    s = slot_at(family.mom, slot)
    assert (s["status"], s["remaining"]) == ("partial", 4)
    assert give(family.mom, med, piece(4, slot)).status_code == 201  # more than the new 2.5, but exactly what was left
    assert slot_at(family.mom, slot)["status"] == "given"


def test_changing_the_unit_closes_the_slots_given_in_the_old_unit(family, clock):
    med = make(family.owner, syrup(clock))
    slot = clock.at(9)
    give(family.mom, med, piece(0.5, slot))
    family.owner.patch(f"/api/medicines/{med['id']}", json={"dose_amount": 5, "dose_unit": "drops"})
    assert slot_at(family.mom, slot)["status"] == "given"
    assert give(family.mom, med, piece(1, slot)).status_code == 409


def test_medicine_validation_errors_422(family, clock):
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
    assert post(dose_amount=0) == 422 and post(dose_amount=-2) == 422 and post(dose_amount=0.001) == 422
    assert post(dose_amount=10000.01) == 422
    assert post(dose_unit="spoon") == 422
    body = fixed(clock)
    del body["dose_amount"]
    assert family.owner.post("/api/medicines", json=body).status_code == 422  # a dose amount is required now
    assert post(dose_amount=10000) == 201


def test_every_unit_in_the_list_is_accepted(family, clock):
    from app.units import DOSE_UNITS

    for unit in DOSE_UNITS:
        assert family.owner.post("/api/medicines", json=fixed(clock, dose_unit=unit)).status_code == 201, unit


def test_patch_is_validated_against_the_merged_medicine(family, clock):
    med = make(family.owner, fixed(clock))
    assert family.owner.patch(f"/api/medicines/{med['id']}", json={"schedule_kind": "interval"}).status_code == 422
    ok = family.owner.patch(
        f"/api/medicines/{med['id']}",
        json={"schedule_kind": "interval", "interval_hours": 6, "first_dose_at": clock.at(8).isoformat()},
    )
    assert ok.status_code == 200 and ok.json()["schedule_kind"] == "interval"
    assert family.owner.patch(f"/api/medicines/{med['id']}", json={"dose_amount": 0}).status_code == 422
    changed = family.owner.patch(f"/api/medicines/{med['id']}", json={"dose_amount": 7.5, "dose_unit": "mg"}).json()
    assert (changed["dose_amount"], changed["dose_unit"]) == (7.5, "mg")
    assert family.owner.patch(f"/api/medicines/{uuid.uuid4()}", json={"name": "x"}).status_code == 404


def _legacy(db, clock, family_ctx):
    """A medicine saved before structured doses: no amount or unit."""
    from app.models import Kid, User

    kid = db.query(Kid).one()
    admin = db.query(User).filter_by(email="owner@x.com").one()
    m = Medicine(
        family_id=kid.family_id, kid_id=kid.id, name="Old", schedule_kind="fixed", times=["09:00"],
        start_date=date.fromisoformat((clock.day - timedelta(days=7)).isoformat()), created_by=admin.id, updated_by=admin.id,
    )
    db.add(m)
    db.commit()
    return {"id": str(m.id), "dose_amount": None}


def test_legacy_medicine_tick_without_amount_completes_slot(family, clock, db_session):
    legacy = _legacy(db_session, clock, family)
    listed = listing(family.mom)[0]
    assert listed["dose_amount"] is None and listed["dose_unit"] is None
    nine = next(s for s in listed["slots"] if when(s["due_at"]) == clock.at(9))
    assert nine["remaining"] is None
    assert give(family.mom, legacy, dose(scheduled_for=clock.at(9).isoformat())).status_code == 201
    assert slot_at(family.mom, clock.at(9))["status"] == "given"
    assert give(family.owner, legacy, dose(scheduled_for=clock.at(9).isoformat())).status_code == 409  # already done


def test_legacy_medicine_patch_requires_a_dose(family, clock, db_session):
    legacy = _legacy(db_session, clock, family)
    assert family.owner.patch(f"/api/medicines/{legacy['id']}", json={"name": "Renamed"}).status_code == 422
    ok = family.owner.patch(f"/api/medicines/{legacy['id']}", json={"dose_amount": 5, "dose_unit": "drops"})
    assert ok.status_code == 200 and ok.json()["dose_amount"] == 5


def test_doses_for_one_medicine_are_serialised_with_a_row_lock(family, clock, db_session):
    med = make(family.owner, fixed(clock))
    statements = []
    engine = db_session.get_bind()
    listener = lambda conn, cursor, statement, *a: statements.append(statement)  # noqa: E731
    event.listen(engine, "before_cursor_execute", listener)
    try:
        give(family.mom, med, full(med, scheduled_for=clock.at(9).isoformat()))
    finally:
        event.remove(engine, "before_cursor_execute", listener)
    lock = next(i for i, s in enumerate(statements) if "FOR UPDATE" in s and "medicines" in s)
    insert = next(i for i, s in enumerate(statements) if s.startswith("INSERT INTO medicine_doses"))
    assert lock < insert  # two phones cannot both pass the over-dose check
    assert Decimal("5") == db_session.query(MedicineDose).one().amount
