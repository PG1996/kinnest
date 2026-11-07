# Kinnest Slice 2b Implementation Plan (structured doses, partial dosing, temporary reminders)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A medicine's dose becomes an amount plus a unit; a scheduled dose can be given full or in pieces by several people, can never exceed its prescribed amount, keeps reminding until complete, and the caregiver can set a one-off "remind me about the rest" reminder.

**Architecture:** Builds on slice 2 (branch `slice-2b` is cut from `slice-2`). The schedule engine learns about progress within a slot (sum of live given pieces vs the dose). The API serialises dose writes per medicine with a row lock, so concurrent taps cannot over-dose. Temporary reminders are a small table fired by the existing worker loop. Free-text doses are migrated best-effort.

**Tech Stack:** unchanged (FastAPI, SQLAlchemy 2, Alembic, Postgres 16; React, TanStack Query, i18next, idb, vitest).

**Spec:** `docs/superpowers/specs/2026-10-31-kinnest-v1-design.md` section 4.5, subsection "Structured doses and partial dosing". Slice 2 plan for conventions: `docs/superpowers/plans/2026-11-08-kinnest-slice-2.md`.

## Global Constraints

- Units are exactly: `ml`, `drops`, `mg`, `mcg`, `g`, `IU`, `tablet`, `puff` (one constant in `backend/app/units.py` and one in `frontend/src/lib/units.ts`; a frontend test checks every unit has an `units.<unit>` i18n key).
- Amounts are decimals with at most 2 places, greater than 0 and at most 10000; stored as `Numeric(8,2)`, compared exactly (no floats on the server).
- Safety rule: for a scheduled slot, the server refuses a given piece that would take the slot's total above `dose_amount`, and refuses any piece once the slot is skipped or complete (409 with `remaining`).
- Skipping a scheduled slot closes it; the unfinished remainder is not given.
- Reminders keep escalating until the slot is complete or skipped. A temporary reminder goes once to all caregivers and admins with medicine reminders on, and is dropped if the slot is complete or skipped first, or if it is more than 30 minutes overdue when the worker finds it.
- Medicines without an amount (saved before this change) behave as before: any given dose completes the slot; the admin is asked to set a proper dose when editing.
- Only the Admin creates, edits or deletes medicines; Admin and Caregiver give doses; Viewer is read-only.
- All user-facing text, including push text, goes through i18n keys. No Claude co-author or attribution line in commits.

## Review Focus

- **Two phones give the full dose of the same slot at once** (different ids): the row lock makes the second see the first; it gets 409 with `remaining: 0`; the slot's total never exceeds the prescribed amount.
- **Pieces that add up with decimals** (0.1 + 0.2 + 0.7, 4 x 0.25): complete the slot exactly, no float drift; a piece larger than the remainder, zero, negative or 3 decimals is refused.
- **Undo a piece**: undoing the completing piece makes the slot partial again (and reopens its reminders); for an interval medicine the next due time is recomputed.
- **Offline partial dose** that the server later refuses (slot already complete, or a stale amount): lands in the rejected list, never silently dropped or over-dosed.
- **Temporary reminder**: fires once at the chosen time; is silently cancelled when the slot is completed first; is not fired late after a long outage; is not creatable for a slot with no partial progress.
- **Legacy medicine** with free-text dose: migrated (`5 drops`, `2.5 ml`, `1/2 tablet`, `0,5 ml`), unparseable text is kept in notes, and ticking still works before the admin fixes the dose.

---

### Task 1: Units, schema and data migration

**Files:**
- Create: `backend/app/units.py`, `backend/tests/test_units.py`, `backend/tests/test_models_slice2b.py`, `backend/alembic/versions/<rev>_structured_doses.py`
- Modify: `backend/app/models.py`

**Interfaces:**
- Produces in `app/units.py`: `DOSE_UNITS: tuple[str, ...]`; `parse_legacy_dose(text: str) -> tuple[Decimal, str] | None` (accepts `5 drops`, `2.5ml`, `0,5 ml`, `1/2 tablet`, `10 µg` -> mcg, `1 tab`, `1000 IU`, `2 puffs`, `1.5 gm` -> g; returns None otherwise); `format_dose(amount: Decimal, unit: str) -> str` (`"0.25 ml"`, `"5 drops"`, trailing zeros stripped).
- Models: `Medicine` loses `dose` and gains `dose_amount: Decimal | None` (Numeric(8,2)) and `dose_unit: str | None` (CHECK in `DOSE_UNITS`); `MedicineDose` gains `amount: Decimal | None` (Numeric(8,2), CHECK `amount > 0` when set) and loses the `uq_dose_per_slot` index (a slot now holds several pieces); new `MedicineNudge(id client uuid, family_id, kid_id, medicine_id, scheduled_for datetime|None, remind_at datetime, created_by, created_at, fired_at datetime|None, cancelled_at datetime|None)`.
- Migration data step: for each medicine, `parse_legacy_dose(dose)`; on success set amount and unit; on failure leave both NULL and append `Previous dose text: <text>` to `notes`; then drop `dose`. Downgrade re-adds `dose` as `format_dose(...)` or `""`. Existing `medicine_doses` rows keep `amount` NULL.

- [ ] **Step 1: Write failing tests** `test_parse_legacy_dose` (table of inputs and expected results above, plus `""`, `"a little"` and `"5"` returning None), `test_format_dose_strips_zeros`, `test_two_pieces_can_share_a_slot` (two live `MedicineDose` rows with the same `scheduled_for` flush fine), `test_dose_amount_must_be_positive_and_unit_known` (IntegrityError for 0 and for unit "spoon"), `test_nudge_roundtrip`.
- [ ] **Step 2: Run** `cd backend && .venv/bin/pytest tests/test_units.py tests/test_models_slice2b.py -q`. Expected: FAIL.
- [ ] **Step 3: Implement** the module, model changes and the migration (autogenerate, then add the data step by hand with `op.get_bind()`).
- [ ] **Step 4: Verify the migration on a scratch database** (not the dev or real one): create `kinnest_scratch`, run `alembic upgrade 9aac82e26537`, insert medicines with doses `5 drops`, `0,5 ml`, `1/2 tablet`, `a little`, then `alembic upgrade head`; expected amounts and units `(5,drops) (0.50,ml) (0.50,tablet) (NULL,NULL)` with the last one's text now in notes; then `alembic downgrade -1` and `upgrade head` again; finally drop the scratch database.
- [ ] **Step 5: Run** the backend suite (slice 2 tests that build `Medicine(dose=...)` are migrated to `dose_amount`/`dose_unit` in this step). Expected: PASS. **Commit** `feat: structured dose columns, nudge table, legacy dose migration`.

### Task 2: Schedule engine progress

**Files:**
- Modify: `backend/app/services/schedule.py`, `backend/tests/test_schedule.py`

**Interfaces:**
- Consumes: models from Task 1.
- Produces: `SlotState(due_at, status: "pending"|"partial"|"given"|"skipped", doses: list[MedicineDose], given_amount: Decimal, remaining: Decimal | None)` (replaces the single `dose`); `slot_progress(m, slot_doses) -> SlotState` fields: any live skipped row -> `skipped`; legacy medicine (no `dose_amount`) with any given row -> `given`; otherwise `given_amount` = sum of live given pieces, `given` when it reaches `dose_amount`, `partial` when above 0, else `pending`; `remaining = dose_amount - given_amount` (None for legacy). `today_slots` and `unresolved_due_slots` use it: `partial` slots are still unresolved. `next_interval_due` counts only slots that are `given` (base = `given_at` of the piece that completed it) or `skipped` (base = `scheduled_for`).

- [ ] **Step 1: Write failing tests**: `test_pieces_add_up_exactly` (4 x 0.25 = given, remaining 0.00; 0.1 + 0.2 + 0.7 = given), `test_partial_slot_is_not_resolved` (listed by `unresolved_due_slots`), `test_skip_after_a_piece_closes_the_slot`, `test_legacy_medicine_any_given_dose_completes`, `test_undone_piece_is_ignored`, `test_interval_next_due_waits_for_completion` (a partial first dose leaves the slot open; completing at 09:40 makes next due 09:40 + N h), `test_skipped_interval_anchors_to_scheduled_time`; the slice 2 engine tests are updated for `SlotState.doses`.
- [ ] **Step 2: Run** `.venv/bin/pytest tests/test_schedule.py -q`. Expected: FAIL.
- [ ] **Step 3: Implement** `slot_progress` with `Decimal` and update the three public functions.
- [ ] **Step 4: Run** the backend suite (API callers are fixed in Task 3, so run only `tests/test_schedule.py` here). Expected: PASS.
- [ ] **Step 5: Commit** `feat: schedule engine tracks partial progress`.

### Task 3: Medicines API with amounts and the over-dose guard

**Files:**
- Modify: `backend/app/api/medicines.py`, `backend/app/services/entries.py` (if helpers move), `backend/tests/test_medicines.py`

**Interfaces:**
- Consumes: Task 1 models, Task 2 engine.
- Produces: `MedicineIn` replaces `dose: str` with `dose_amount: Decimal` and `dose_unit: str` (both required on create; validated 0 < amount <= 10000, 2 dp, unit in `DOSE_UNITS`). PATCH validates the merged medicine, so editing a legacy medicine without supplying both is 422 (`dose_amount required`). `MedicineJson` replaces `dose` with `dose_amount: number | null`, `dose_unit: string | null`; each `slots[]` item becomes `{due_at, status, given_amount: number, remaining: number | null, doses: [{id, amount, status, given_at, by_name}], dose_id, given_at, by_name, nudge: {id, remind_at} | null}` (`dose_id/given_at/by_name` = the latest piece, kept for compatibility). `DoseIn` gains `amount: Decimal | None`.
- Rules of `POST /medicines/{id}/doses`: first `SELECT ... FOR UPDATE` on the medicine row, so doses for one medicine are serialised. Given + medicine with an amount: `amount` required, 0 < amount <= `dose_amount`, 2 dp (422). Scheduled slot: 409 `{detail, remaining}` if the slot is skipped, complete, or `given_amount + amount > dose_amount`. Skipped + scheduled: allowed unless the slot is already complete (409). As-needed: `amount` defaults to `dose_amount`, may be smaller; no remaining tracking; the gap warning is unchanged. Response adds `slot: {status, given_amount, remaining}` for scheduled doses. Same dose id again still returns 200 with the stored row.

- [ ] **Step 1: Write failing tests** (existing slice 2 tests move to `dose_amount`/`dose_unit`; `test_same_slot_from_two_phones_keeps_one_row_returns_200` becomes `test_second_full_dose_for_the_same_slot_is_409_with_remaining_zero`): `test_full_dose_completes_slot`; `test_four_quarter_pieces_complete_a_one_ml_slot_and_progress_is_listed`; `test_piece_larger_than_remaining_is_409_with_remaining`; `test_piece_after_skip_is_409`; `test_skip_after_partial_closes_slot_and_keeps_pieces`; `test_amount_validation_422` (0, -1, 0.001, missing for given, larger than dose, unknown unit, dose_amount 0); `test_undo_completing_piece_makes_slot_partial`; `test_undo_one_piece_frees_that_amount`; `test_as_needed_partial_amount_saved_and_defaults_to_full`; `test_legacy_medicine_tick_without_amount_completes_slot`; `test_legacy_medicine_patch_requires_a_dose`; `test_concurrent_full_doses_never_exceed` (two threads or two sessions posting with different ids; final sum equals `dose_amount`, exactly one 201).
- [ ] **Step 2: Run** `.venv/bin/pytest tests/test_medicines.py -q`. Expected: FAIL.
- [ ] **Step 3: Implement** the new validation, the row lock, the guard and the JSON shape.
- [ ] **Step 4: Run** the whole backend suite. Expected: PASS.
- [ ] **Step 5: Commit** `feat: structured doses, partial pieces and over-dose guard`.

### Task 4: Temporary reminders and reminder text

**Files:**
- Modify: `backend/app/api/medicines.py` (nudge routes), `backend/app/worker/reminders.py`, `backend/app/i18n.py`
- Test: `backend/tests/test_nudges.py`, `backend/tests/test_medicine_reminders.py`

**Interfaces:**
- Produces: `POST /api/medicines/{id}/nudges {id: uuid, scheduled_for: datetime, remind_at: datetime}` (caregiver/admin; 201, 200 for the same id): 409 unless that slot has partial progress (`given_amount > 0` and `remaining > 0`); 422 if `remind_at` is not in the future or is more than 24 hours away; `DELETE /api/medicines/{id}/nudges/{nudge_id}` (cancel; any caregiver). Slots list their pending nudge (`nudge`).
- Worker: `_fire_nudges(db, kid, now, sender, tz, sent)`, called from `tick` after the medicine chains: for each unfired, uncancelled nudge with `remind_at <= now`: if its slot is complete or skipped (or the medicine ended or was deleted), set `cancelled_at` and send nothing; if `now - remind_at > 30 min`, set `fired_at` and send nothing (stale); otherwise send `med_nudge` to all caregivers and admins with the `medicine` preference, set `fired_at`, and commit. Reminder bodies get a `progress` parameter (`""` or `" 0.50 ml left."`) so `med_due`, `med_due_again` and `med_overdue_admin` say how much remains; the `dose` parameter becomes `format_dose(...)` (legacy medicines: `""`). New key `med_nudge` (title `{kid}: {medicine} still to give`, body `{left} left of {dose}.`).

- [ ] **Step 1: Write failing tests**: `test_nudge_only_for_a_slot_with_partial_progress` (409 for untouched and for complete slots); `test_nudge_time_validation`; `test_nudge_fires_once_at_its_time_to_all_caregivers_not_viewers`; `test_nudge_cancelled_silently_when_slot_completes_first`; `test_nudge_cancelled_when_slot_skipped`; `test_stale_nudge_after_outage_is_dropped_without_sending`; `test_nudge_respects_medicine_pref`; `test_partial_slot_keeps_escalating_and_says_what_is_left` (levels 0/1/2 continue after a first piece; body parameter `progress` set); `test_complete_slot_stops_chain`; `test_cancel_nudge_endpoint`.
- [ ] **Step 2: Run** `.venv/bin/pytest tests/test_nudges.py tests/test_medicine_reminders.py -q`. Expected: FAIL.
- [ ] **Step 3: Implement** the routes, `_fire_nudges`, the new parameters and i18n keys.
- [ ] **Step 4: Run** the whole backend suite. Expected: PASS.
- [ ] **Step 5: Commit** `feat: temporary reminders for the rest of a dose`.

### Task 5: Frontend data layer and units

**Files:**
- Create: `frontend/src/lib/units.ts`
- Modify: `frontend/src/api/hooks.ts`, `frontend/src/hooks/log.ts`, `frontend/src/offline/queue.ts`, `frontend/src/offline/sync.ts`, `frontend/src/offline/pending.ts`, `frontend/src/i18n/en.json`
- Test: `frontend/src/lib/units.test.ts`, `frontend/src/hooks/slice2b.test.tsx`, `frontend/src/offline/offline.test.tsx`

**Interfaces:**
- Produces: `DOSE_UNITS` and `formatDose(amount: number, unit: string, t): string` in `lib/units.ts` (`"0.25 ml"`, translated unit names via `units.<unit>`); `Medicine` loses `dose` and gains `dose_amount: number | null`, `dose_unit: string | null`; `Slot` becomes `{due_at, status: 'pending'|'partial'|'given'|'skipped', given_amount, remaining: number | null, doses: SlotDose[], dose_id, given_at, by_name, nudge: {id, remind_at} | null}`; `DoseInput` gains `amount?: number`; `DoseResult` gains `slot?: {status, given_amount, remaining}`; hooks `useCreateNudge()` (`{id, medicine_id, scheduled_for, remind_at}`) and `useCancelNudge()`; queue kind `'nudge'` -> `POST /api/medicines/${medicine_id}/nudges`; `queuedDoseSlots` keeps marking a slot while any dose for it is waiting, and `mergePending`-style helper `queuedAmount(pending, medicineId, scheduledFor): number` sums queued piece amounts for display.

- [ ] **Step 1: Write failing tests**: `every unit has an i18n key and the list matches the spec`; `formatDose trims zeros and translates the unit`; `useGiveDose sends amount and stamps given_at`; `a nudge queued offline syncs to its own endpoint`; `queuedAmount sums queued pieces for one slot`; `a 409 on a queued piece goes to the rejected list with its reason`.
- [ ] **Step 2: Run** `cd frontend && npx vitest run src/lib src/hooks src/offline`. Expected: FAIL.
- [ ] **Step 3: Implement** the types, constants, hooks and queue kind. Existing fixtures that use `dose: '5 drops'` move to `dose_amount`/`dose_unit`.
- [ ] **Step 4: Run** `npx vitest run && npx tsc -b`. Expected: PASS (UI tests that still use the old dose text are fixed in Tasks 6 and 7).
- [ ] **Step 5: Commit** `feat: frontend data layer for structured doses`.

### Task 6: Medicine form with amount and unit

**Files:**
- Modify: `frontend/src/components/MedicineForm.tsx`, `frontend/src/pages/Medicines.tsx`, `frontend/src/i18n/en.json`
- Test: `frontend/src/pages/MedicineManage.test.tsx`

**Interfaces:**
- Consumes: `DOSE_UNITS`, `formatDose`, `Medicine`.
- Produces: the free-text "Dose" field is replaced by a number field `Dose amount` (step 0.01) and a unit `<select>` `Dose unit` (all eight units, translated); the POST/PATCH body sends `dose_amount` (number) and `dose_unit`. Validation: amount > 0, at most 2 decimals, unit chosen. Medicine cards show `formatDose`. A medicine with no amount shows a notice "Set a proper dose for this medicine" with an Edit shortcut, and opening it for edit leaves the amount empty until the admin fills it.

- [ ] **Step 1: Write failing tests**: `admin adds a medicine with amount 0.25 and unit ml and the body matches`; `amount 0, 3 decimals or no unit are refused before sending`; `unit list offers all eight units`; `editing a legacy medicine shows the set-a-dose notice and requires an amount`; `cards show 0.25 ml`.
- [ ] **Step 2: Run** `npx vitest run src/pages/MedicineManage.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement** the form and page changes.
- [ ] **Step 4: Run** `npx vitest run && npx tsc -b`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: medicine form with dose amount and unit`.

### Task 7: Home giving flow with full or partial dose

**Files:**
- Create: `frontend/src/components/GiveDoseSheet.tsx`, `frontend/src/components/NudgeSheet.tsx`
- Modify: `frontend/src/components/MedicinesToday.tsx`, `frontend/src/components/GiveAsNeededSheet.tsx`, `frontend/src/i18n/en.json`
- Test: `frontend/src/pages/Medicines.test.tsx`

**Interfaces:**
- Consumes: Task 5 hooks and types.
- Produces: for a pending or partial slot of a medicine with an amount, the row shows progress ("0.50 of 1 ml given, 0.50 left"), a **Give full dose** button (amount = remaining), a **Partial dose** button opening `GiveDoseSheet` (number field defaulting to half the remaining, max = remaining, 2 decimals, **Give** button) and **Skip**. After a successful piece that leaves something remaining, `NudgeSheet` offers "Remind me about the rest in" 5, 10, 15, 30 or 60 minutes (or No thanks); choosing one posts a nudge. A slot with a nudge shows "Reminder at 3:40 PM" with Cancel. A 409 about the amount shows "Only X left, refreshing" and reloads the list. Queued pieces show as "waiting to sync" with their amount, and the sheet uses `remaining - queued amount`. As-needed "Give now" asks Full dose (the dose amount) or Partial (typed amount); the gap confirm is unchanged. Legacy medicines (no amount) keep the old **Given** and **Skip** buttons.

- [ ] **Step 1: Write failing tests**: `slot shows progress and Give full dose posts the remaining amount`; `partial dose sheet posts the typed amount and cannot exceed remaining`; `after a partial dose the nudge sheet offers five times and posts the chosen reminder`; `declining the nudge posts nothing`; `a slot with a reminder shows its time and cancel`; `a 409 on amount refreshes with an explanation`; `a queued piece reduces what the sheet offers`; `as-needed asks full or partial`; `legacy medicine still shows Given and Skip`; `viewer sees progress but no buttons`.
- [ ] **Step 2: Run** `npx vitest run src/pages/Medicines.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement** the components and wire them into `MedicinesToday`.
- [ ] **Step 4: Run** `npx vitest run && npx tsc -b && npx vite build`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: give full or partial doses with a reminder for the rest`.

### Task 8: Checklist, end-to-end check, real-use stack

**Files:**
- Modify: `docs/MANUAL_TEST_CHECKLIST.md`

- [ ] **Step 1: Update the checklist** (medicines section): create a medicine with amount and unit; full dose; 4 x 0.25 ml pieces by two phones; a second phone tapping full dose right after the first (refused, nothing double-recorded); partial then temporary reminder fires once at the chosen time; partial then complete before the reminder (no ping); reminders keep coming while a dose is incomplete; skip after a partial; undo a piece; as-needed partial; a medicine saved before this change asks for a dose when edited.
- [ ] **Step 2: Run** the full suites: `cd backend && .venv/bin/pytest -q`, `cd frontend && npx vitest run && npx tsc -b`. Expected: all PASS.
- [ ] **Step 3: Back up the real-use database** (`COMPOSE="docker-compose -f deploy/docker-compose.prod.yml --env-file .env" BACKUP_TARGET=local:$HOME/kinnest-backups deploy/backup.sh`), rebuild with `docker-compose -f deploy/docker-compose.prod.yml --env-file .env up -d --build`, and confirm `alembic current` is the new head, `curl localhost:8080/api/health`, and existing data is present.
- [ ] **Step 4: Smoke test on the dev stack** with a minted session (not the real database): create a medicine of 1 ml, give 0.25 then 0.75, try 0.01 more (409), set and cancel a nudge.
- [ ] **Step 5: Commit** `docs: slice 2b checklist`, then hand off to the owner for real phones.

## Self-Review

- **Spec coverage:** structured doses with the eight units (T1, T3, T6); full or partial ticking and pieces adding up (T2, T3, T7); over-dose guard (T3); reminders until complete with what is left (T4); temporary reminder (T4, T7); as-needed partial (T3, T7); legacy medicines (T1, T3, T6, T7). Medicine photos and label reading are slice 3 by decision.
- **Type consistency:** `SlotState.doses/given_amount/remaining` (T2) match the slot JSON (T3) and the frontend `Slot` (T5); `DoseInput.amount` (T5) matches `DoseIn.amount` (T3); the nudge route and `MedicineNudge` fields (T1, T4) match `useCreateNudge` and the queue path (T5); `dose_amount`/`dose_unit` are used the same way in every task.
- **Proportion:** tasks give signatures, rules and test names; bodies are left to the implementer.
