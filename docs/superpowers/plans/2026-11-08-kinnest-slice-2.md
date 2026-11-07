# Kinnest Slice 2 Implementation Plan (medicines and sleep)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Admin sets up medicines (fixed times, every N hours, as needed); caregivers tick doses from Home and get escalating push reminders; caregivers start and stop sleep sessions from Home; three small slice 1 issues are fixed first.

**Architecture:** Same stack as slice 1. A pure schedule engine (`app/services/schedule.py`) decides which dose slots exist and which are resolved; the API and the reminder worker both call it. Dose and sleep writes use client-generated UUIDs and go through the same offline queue. Reminder state keeps its database-backed escalation chain, now keyed by a `subject_id` so each medicine slot has its own chain.

**Tech Stack:** unchanged from slice 1 (FastAPI, SQLAlchemy 2, Alembic, Postgres 16, pywebpush; React, Vite, Tailwind, TanStack Query, i18next, idb, vitest).

**Spec:** `docs/superpowers/specs/2026-10-31-kinnest-v1-design.md` sections 4.4, 4.5, 4.10, 4.14 (slice 2 only). Slice 1 plan for conventions: `docs/superpowers/plans/2026-11-04-kinnest-slice-1.md`.

## Global Constraints

- Free only; no new paid services or dependencies beyond what slice 1 uses.
- **Only the Admin** creates, edits or deletes a medicine. Admin and Caregiver can give or skip a dose and start or stop sleep. Viewer is read-only (owner decision, 2026-11-08).
- Schedule kinds: `fixed` (clock times, family timezone `APP_TIMEZONE`), `interval` (next due = last dose given + N hours; first dose time set when the medicine is added), `as_needed` (no schedule, no reminders, optional minimum gap that only warns).
- A medicine whose end date has passed stops producing slots and reminders. Deleting a medicine is a soft delete that keeps dose history.
- Reminder escalation is the feed one: due, +15 min, then +30 min to admins only with high urgency. Giving or skipping the dose stops the chain.
- Every record has `family_id` and `kid_id`. Client-generated UUIDs make every write safe to retry.
- All user-facing text, including server-written push text, goes through i18n keys (`en.json`, `app/i18n.py`).
- Timestamps more than 5 minutes in the future are rejected (422), as in slice 1.
- No Claude co-author or attribution line in commits.

## Review Focus

- **Same dose ticked on two phones at once** (different client ids, same slot): one dose row; the second call returns the existing row with 200, not a 500.
- **Tick for a slot that isn't due or doesn't exist** (stale screen showing yesterday, edited schedule): refused with 409, nothing saved.
- **As-needed dose inside the minimum gap**: saved with a warning shown by the app, never blocked (a real fever dose must not be refused).
- **Interval medicine given late or skipped**: next due is last `given_at` + N hours; a skipped dose anchors to its scheduled time. Shifting does not create two open slots.
- **Medicine ended, edited or deleted while a reminder chain is pending**: no further reminders; an unresolved slot older than 36 hours never starts a chain (no storm after a long gap, the slice 1 lesson).
- **Sleep**: starting while one is open returns 409 with the open session; ending before the start is 422; ending an already-ended session with the same time is 200.

---

### Task 1: Slice 1 follow-ups

**Files:**
- Modify: `backend/app/api/feeds.py`, `backend/app/api/diapers.py`, `frontend/src/components/Layout.tsx`
- Test: `backend/tests/test_feeds.py`, `backend/tests/test_diapers.py`, `frontend/src/App.test.tsx`

**Interfaces:**
- Consumes: `create_feed`, `create_diaper`, `disablePush(): Promise<PushState>` from `frontend/src/push/subscribe.ts`.
- Produces: no new interfaces. `POST /api/feeds` and `/api/diapers` return 422 for a `fed_by_user_id` / `changed_by_user_id` that is not a member of the caller's family, and return the existing row with 200 when a concurrent insert with the same id wins the race.

- [ ] **Step 1: Write failing tests** `test_unknown_fed_by_user_is_422` (random UUID and a user from no family, both feeds and diapers), `test_race_on_same_id_returns_existing_row` (monkeypatch `Session.get` to return None once so the insert hits the primary key; expect 200 and one row), and in `App.test.tsx` `signing out removes this phone's push subscription` (fake subscribed push support; click sign out; expect `DELETE /api/push/subscribe` with the endpoint before `POST /api/auth/logout`).
- [ ] **Step 2: Run** `cd backend && .venv/bin/pytest tests/test_feeds.py tests/test_diapers.py -q` and `cd frontend && npx vitest run src/App.test.tsx`. Expected: the new tests FAIL.
- [ ] **Step 3: Implement** a membership check helper in `app/services/entries.py` (`ensure_family_member(db, family_id, user_id)` raising 422); catch `IntegrityError` around the commit, roll back, re-read by id and return 200; in `Layout.signOut` call `disablePush()` first, ignoring its errors.
- [ ] **Step 4: Run** both suites. Expected: PASS.
- [ ] **Step 5: Commit** `fix: slice 1 follow-ups (duplicate race, unknown user id, logout unsubscribes push)`.

### Task 2: Data models and migration

**Files:**
- Modify: `backend/app/models.py`, `backend/app/api/push.py` (prefs kinds only), `backend/tests/conftest.py` (none unless needed)
- Create: `backend/alembic/versions/<rev>_medicines_and_sleep.py` (autogenerate), `backend/tests/test_models_slice2.py`

**Interfaces:**
- Produces SQLAlchemy models (UUID pks, `created_at` UTC):
  - `Medicine(id uuid default uuid4, family_id, kid_id, name, dose: str, schedule_kind: "fixed"|"interval"|"as_needed", times: list[str] JSON ("HH:MM", fixed only), interval_hours: int|None, first_dose_at: datetime|None, min_gap_hours: int|None, start_date: date, end_date: date|None, notes: str, created_by, updated_by, updated_at, deleted_at)`
  - `MedicineDose(id client uuid, family_id, kid_id, medicine_id, status: "given"|"skipped", scheduled_for: datetime|None, given_at: datetime, by_user_id, note, created_by, updated_by, updated_at, deleted_at)` with `UniqueConstraint(medicine_id, scheduled_for)` so one dose per slot (NULLs, as-needed, stay free).
  - `SleepSession(id client uuid, family_id, kid_id, started_at, ended_at: datetime|None, started_by_user_id, ended_by_user_id: uuid|None, note, created_by, updated_by, updated_at, deleted_at)` with a partial unique index so a kid has at most one open (`ended_at IS NULL AND deleted_at IS NULL`) session.
  - `ReminderState` gains `subject_id: uuid|None`; its unique constraint becomes `(kid_id, kind, subject_id, anchor_at)` with `postgresql_nulls_not_distinct=True`. Existing feed and diaper rows keep `subject_id = NULL`.
- `PREF_KINDS` in `app/api/push.py` becomes `("feed", "diaper", "medicine")`; `PrefsBody` adds `medicine: bool = True` (older clients that omit it keep working).

- [ ] **Step 1: Write failing tests** `test_one_dose_per_medicine_slot` (two different ids, same `scheduled_for` raises IntegrityError; two as-needed doses with NULL `scheduled_for` are fine), `test_only_one_open_sleep_per_kid`, `test_reminder_state_unique_with_null_subject` (two feed rows, same anchor, conflict), and update `test_notification_prefs_default_on_and_persist` to expect `{"feed": True, "diaper": True, "medicine": True}`.
- [ ] **Step 2: Run** `cd backend && .venv/bin/pytest tests/test_models_slice2.py tests/test_push_api.py -q`. Expected: FAIL.
- [ ] **Step 3: Implement** the models and constraints above; `alembic revision --autogenerate -m "medicines and sleep"` and check the generated SQL includes the partial index and `NULLS NOT DISTINCT`; run `alembic upgrade head` on a fresh database.
- [ ] **Step 4: Run** the whole backend suite. Expected: PASS (slice 1 tests unchanged).
- [ ] **Step 5: Commit** `feat: medicine, dose and sleep models`.

### Task 3: Schedule engine

**Files:**
- Create: `backend/app/services/schedule.py`, `backend/tests/test_schedule.py`

**Interfaces:**
- Consumes: `Medicine`, `MedicineDose` models (no database access; tests use unsaved instances).
- Produces:
  - `@dataclass SlotState: due_at: datetime; status: Literal["pending","given","skipped"]; dose: MedicineDose | None`
  - `is_active(m: Medicine, now: datetime, tz: str) -> bool` (not deleted, `start_date <= today(tz)`, and `end_date` empty or not passed)
  - `today_slots(m, doses, now, tz) -> list[SlotState]`: `fixed`: every `times` entry for today in `tz`, matched to a non-deleted dose by `scheduled_for`; `interval`: just the next open slot (see below); `as_needed`: `[]`
  - `next_interval_due(m, doses) -> datetime`: `first_dose_at` when no resolved dose exists; otherwise the latest resolved dose's `given_at` (status given) or `scheduled_for` (status skipped) plus `interval_hours`
  - `unresolved_due_slots(m, doses, now, tz) -> list[datetime]`: slots with `due_at <= now`, no dose, within the last 36 hours, only for active `fixed`/`interval` medicines; used by the reminder worker
  - `valid_slot(m, doses, scheduled_for, now, tz) -> bool`: true only if `scheduled_for` equals a slot of `today_slots` or `unresolved_due_slots` (this is the 409 check)

- [ ] **Step 1: Write failing tests** `test_fixed_slots_for_today_in_family_timezone`, `test_resolved_slot_is_not_pending`, `test_interval_first_dose_then_anchored_to_given_at`, `test_interval_skipped_anchors_to_scheduled_time`, `test_end_date_stops_slots`, `test_future_start_date_has_no_slots`, `test_as_needed_has_no_slots`, `test_stale_slot_older_than_36h_not_returned`, `test_valid_slot_rejects_unknown_time`.
- [ ] **Step 2: Run** `.venv/bin/pytest tests/test_schedule.py -q`. Expected: FAIL (module missing).
- [ ] **Step 3: Implement** the five functions as pure code with `zoneinfo`.
- [ ] **Step 4: Run** the tests. Expected: PASS.
- [ ] **Step 5: Commit** `feat: medicine schedule engine`.

### Task 4: Medicines API

**Files:**
- Create: `backend/app/api/medicines.py`, `backend/tests/test_medicines.py`
- Modify: `backend/app/main.py` (include router)

**Interfaces:**
- Consumes: `require_admin`, `require_caregiver`, `current_member`, schedule engine (Task 3), `reject_future`, `ensure_family_member`.
- Produces (all under `/api`):
  - `GET /medicines?include_ended=false` -> `[MedicineJson]`, `MedicineJson = {id, name, dose, schedule_kind, times, interval_hours, first_dose_at, min_gap_hours, start_date, end_date, notes, ended: bool, slots: [{due_at, status, dose_id, given_at, by_name}], last_dose: {id, status, given_at, by_name} | null}`
  - `POST /medicines`, `PATCH /medicines/{id}`, `DELETE /medicines/{id}` (soft): admin only; validation: `fixed` needs one or more unique `HH:MM` times, `interval` needs `interval_hours` 1..72 and `first_dose_at`, `as_needed` may have `min_gap_hours` 1..48, `end_date >= start_date`
  - `POST /medicines/{id}/doses` body `{id, status: "given"|"skipped", given_at?, scheduled_for?, note?}` (caregiver or admin) -> `{...DoseJson, gap_warning: {last_given_at} | null}`; 201 new, 200 when the id exists or the slot already has a dose (returns that dose); 409 when `valid_slot` is false for a scheduled medicine; `scheduled_for` must be absent for `as_needed`, and skipped is not allowed for `as_needed`; `gap_warning` is set when an as-needed dose is saved within `min_gap_hours` of the previous given dose
  - `DELETE /medicines/{id}/doses/{dose_id}` (caregiver or admin, soft; undo for a wrong tick)
  - `GET /medicines/{id}/doses?from=&to=` history (any member)

- [ ] **Step 1: Write failing tests**: `test_only_admin_can_create_edit_delete_medicine`; `test_fixed_medicine_slots_listed_for_today`; `test_give_dose_for_due_slot_is_201_and_marks_slot_given`; `test_same_slot_from_two_phones_keeps_one_row_returns_200`; `test_dose_for_unknown_slot_is_409`; `test_viewer_cannot_give_dose`; `test_as_needed_inside_min_gap_saves_with_warning`; `test_as_needed_rejects_scheduled_for_and_skipped`; `test_interval_next_slot_moves_after_late_dose`; `test_ended_medicine_hidden_unless_included`; `test_delete_medicine_keeps_history`; `test_undo_dose_reopens_slot`; `test_validation_errors_422` (bad time string, missing interval, end before start, future `given_at`).
- [ ] **Step 2: Run** `.venv/bin/pytest tests/test_medicines.py -q`. Expected: FAIL.
- [ ] **Step 3: Implement** the router; commit after each write; catch `IntegrityError` on the dose insert and return the existing row with 200.
- [ ] **Step 4: Run** the whole backend suite. Expected: PASS.
- [ ] **Step 5: Commit** `feat: medicines and doses API`.

### Task 5: Sleep API and summary

**Files:**
- Create: `backend/app/api/sleep.py`, `backend/tests/test_sleep.py`
- Modify: `backend/app/services/summary.py`, `backend/app/api/summary.py`, `backend/app/main.py`, `backend/tests/test_summary.py`

**Interfaces:**
- Produces (under `/api`): `POST /sleep {id, started_at, note?}` (caregiver/admin; 201, 200 for the same id, 409 `{detail, open: SleepJson}` when another session is open); `POST /sleep/{id}/end {ended_at}` (422 if before `started_at`, 200 if already ended at that same time, 409 if ended at a different time); `PATCH /sleep/{id}`; `DELETE /sleep/{id}` (soft); `GET /sleep?from=&to=`. `SleepJson = {id, started_at, ended_at, started_by_name, ended_by_name, duration_min}`.
- `GET /api/summary` gains `sleep: {open: SleepJson | null, last: SleepJson | null}` (`last` = most recent ended session); existing keys unchanged. `Summary` dataclass gains `open_sleep`, `last_sleep`.

- [ ] **Step 1: Write failing tests**: `test_start_sleep_201_then_same_id_200`; `test_start_while_open_is_409_with_open_session`; `test_end_before_start_is_422`; `test_end_is_idempotent_for_same_time`; `test_future_start_rejected`; `test_viewer_cannot_start_sleep`; `test_summary_has_open_and_last_sleep`; `test_deleted_sleep_ignored_in_summary`.
- [ ] **Step 2: Run** `.venv/bin/pytest tests/test_sleep.py tests/test_summary.py -q`. Expected: FAIL.
- [ ] **Step 3: Implement** the router and extend `build_summary`/the summary route.
- [ ] **Step 4: Run** the whole backend suite. Expected: PASS.
- [ ] **Step 5: Commit** `feat: sleep sessions API and summary`.

### Task 6: Medicine reminders in the worker

**Files:**
- Modify: `backend/app/worker/reminders.py`, `backend/app/i18n.py`
- Test: `backend/tests/test_medicine_reminders.py`

**Interfaces:**
- Consumes: `unresolved_due_slots`, `is_active` (Task 3); `ReminderState.subject_id` (Task 2); `_deliver`, `_state` helpers from slice 1.
- Produces: `_medicine_chains(db, kid, now, sender, tz, sent)` called from `tick` after the feed and diaper chains, committing after each chain as in slice 1. For every active `fixed`/`interval` medicine and every unresolved due slot, the same three-level chain runs with `ReminderState(kind="medicine", subject_id=medicine.id, anchor_at=slot)`; recipients respect the `medicine` preference; level 2 goes to admins only with urgency `high`; url is `/?log=medicine`. New i18n keys in `app/i18n.py`: `med_due` (title `{kid}: {medicine} due`, body `{dose} at {time}`), `med_due_again`, `med_overdue_admin`. Purge keeps the newest anchor per `(kid_id, kind, subject_id)`.

- [ ] **Step 1: Write failing tests** (fake clock and fake sender, as in `test_reminders.py`): `test_fixed_dose_level0_to_caregivers_not_viewers`; `test_level1_and_level2_admin_only_high`; `test_given_dose_stops_chain`; `test_skipped_dose_stops_chain`; `test_interval_chain_anchored_to_last_given`; `test_ended_or_deleted_medicine_sends_nothing`; `test_as_needed_never_reminds`; `test_stale_slot_over_36h_sends_nothing`; `test_restart_does_not_resend_medicine_level`; `test_medicine_pref_off_skips_user`; `test_two_medicines_have_independent_chains`.
- [ ] **Step 2: Run** `.venv/bin/pytest tests/test_medicine_reminders.py -q`. Expected: FAIL.
- [ ] **Step 3: Implement** the chains, i18n keys and the purge change.
- [ ] **Step 4: Run** the whole backend suite. Expected: PASS (slice 1 reminder tests unchanged).
- [ ] **Step 5: Commit** `feat: escalating medicine reminders`.

### Task 7: Frontend data layer and offline kinds

**Files:**
- Modify: `frontend/src/api/hooks.ts`, `frontend/src/hooks/log.ts`, `frontend/src/offline/queue.ts`, `frontend/src/offline/sync.ts`, `frontend/src/offline/pending.ts`
- Test: `frontend/src/offline/offline.test.tsx`, `frontend/src/hooks/slice2.test.tsx`

**Interfaces:**
- Produces types in `api/hooks.ts`: `ScheduleKind`, `Slot`, `Medicine`, `Sleep`, `SummarySleep`; `Summary` gains `sleep: {open: Sleep | null, last: Sleep | null}`. New hooks: `useMedicines()` (`GET /api/medicines`, refetch 30 s), `useGiveDose()` (`{medicineId, id, status, scheduled_for?, given_at?, note?}`), `useUndoDose()`, `useStartSleep()`, `useEndSleep()`.
- Offline queue `QueueEntry.kind` becomes `'feed' | 'diaper' | 'dose' | 'sleep_start' | 'sleep_end'`. `sync.ts` maps kinds to requests: `dose` -> `POST /api/medicines/${payload.medicine_id}/doses`, `sleep_start` -> `POST /api/sleep`, `sleep_end` -> `POST /api/sleep/${payload.id}/end`; FIFO order keeps an end after its start. 409 on a dose or sleep entry is treated like other 4xx: moved to the rejected list with the reason.
- `mergePending(summary, pending, myName)` also shows a queued `sleep_start` as `sleep.open` and removes it when a queued `sleep_end` follows. Queued doses are applied by the Home components (Task 9) through `pending`.

- [ ] **Step 1: Write failing tests**: `flush sends dose and sleep entries to their own endpoints in order`; `a 409 on a queued dose lands in the rejected list`; `mergePending shows a queued sleep start as asleep`; `mergePending drops it again when an end is queued`; `useGiveDose queues on network error and on 503`.
- [ ] **Step 2: Run** `cd frontend && npx vitest run src/offline src/hooks`. Expected: FAIL.
- [ ] **Step 3: Implement** the types, hooks, queue kinds and sync mapping, reusing `post()` from `hooks/log.ts` with a generic path argument.
- [ ] **Step 4: Run** `npx vitest run && npx tsc -b`. Expected: PASS, no type errors.
- [ ] **Step 5: Commit** `feat: frontend data layer for doses and sleep`.

### Task 8: Home sleep controls

**Files:**
- Create: `frontend/src/components/SleepCard.tsx`
- Modify: `frontend/src/pages/Home.tsx`, `frontend/src/i18n/en.json`
- Test: `frontend/src/pages/Sleep.test.tsx`

**Interfaces:**
- Consumes: `summary.sleep`, `useStartSleep`, `useEndSleep`, `formatAgo`, `useNow`.
- Produces: `<SleepCard summary={...} now={...} canLog={...} />`: when asleep shows "Asleep since 9:40 PM (45m)" and a **Wake up** button; otherwise shows "Slept 2h 10m, woke 8m ago" (or "No sleep logged yet") and a **Sleep** button. One tap each, client-generated id, `at` is now. Viewers see the card without buttons. i18n keys under `sleep.*`.

- [ ] **Step 1: Write failing tests**: `shows asleep since and wake button when a session is open`; `shows last sleep length when awake`; `tapping Sleep posts a start with a client id`; `tapping Wake up posts an end for the open session`; `viewer sees no buttons`; `a 409 on start shows the already-asleep session instead of an error`.
- [ ] **Step 2: Run** `npx vitest run src/pages/Sleep.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement** the component and place it on Home between the diaper card and Today.
- [ ] **Step 4: Run** `npx vitest run && npx tsc -b`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: sleep card on Home`.

### Task 9: Home medicines list and notification toggle

**Files:**
- Create: `frontend/src/components/MedicinesToday.tsx`, `frontend/src/components/GiveAsNeededSheet.tsx`
- Modify: `frontend/src/pages/Home.tsx`, `frontend/src/pages/Settings.tsx`, `frontend/src/i18n/en.json`
- Test: `frontend/src/pages/Medicines.test.tsx`, `frontend/src/pages/pages.test.tsx` (Settings test)

**Interfaces:**
- Consumes: `useMedicines`, `useGiveDose`, `useUndoDose`, `useQueue().pending`, `Medicine`/`Slot` types.
- Produces: `<MedicinesToday medicines pending canLog />` listing, per medicine, today's slots: pending slots show the time (red "overdue by 20m" when late) with **Given** and **Skip** buttons (client id, `scheduled_for = slot.due_at`); resolved slots show a check, who and when, with a short **Undo**; queued doses show as "waiting to sync". As-needed medicines show **Give now** and "last given 3h ago"; inside `min_gap_hours` a confirm dialog asks before posting (the server never blocks). Receiving `gap_warning` or a 200-with-existing-row from another phone shows "<name> already gave this". The notification URL `/?log=medicine` scrolls to this card. Settings gets a **Medicine reminders** toggle that saves `{feed, diaper, medicine}`.

- [ ] **Step 1: Write failing tests**: `shows a pending slot with Given and Skip and posts scheduled_for`; `overdue slot is flagged`; `resolved slot shows who gave it`; `viewer sees no buttons`; `as-needed inside the min gap asks to confirm and still posts when confirmed`; `a dose from another phone shows already gave this`; `undo reopens the slot`; `queued dose shows waiting to sync`; Settings: `medicine toggle saves all three preferences`.
- [ ] **Step 2: Run** `npx vitest run src/pages`. Expected: FAIL.
- [ ] **Step 3: Implement** the components and wire them into Home and Settings.
- [ ] **Step 4: Run** `npx vitest run && npx tsc -b`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: medicines on Home and medicine reminder toggle`.

### Task 10: Medicines management screen (admin)

**Files:**
- Create: `frontend/src/pages/Medicines.tsx`, `frontend/src/components/MedicineForm.tsx`
- Modify: `frontend/src/App.tsx` (route `/medicines`), `frontend/src/components/Layout.tsx` (fourth nav item), `frontend/src/i18n/en.json`
- Test: `frontend/src/pages/MedicineManage.test.tsx`

**Interfaces:**
- Consumes: `useMedicines({includeEnded})`, `POST/PATCH/DELETE /api/medicines`.
- Produces: `/medicines` lists current medicines with a "Past medicines" section; the admin sees an **Add medicine** form (name, dose, schedule kind radios; fixed: add or remove `HH:MM` times; interval: hours and first dose time; as needed: optional minimum gap; start date, optional end date, notes), **Edit** and **Delete** (two-step confirm). Caregivers and viewers see the list read-only.

- [ ] **Step 1: Write failing tests**: `admin adds a fixed medicine with two times and the POST body matches`; `interval form requires hours and first dose`; `as needed form posts optional min gap`; `caregiver sees the list without add, edit or delete`; `delete needs a second confirm`; `past medicines are listed separately`.
- [ ] **Step 2: Run** `npx vitest run src/pages/MedicineManage.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement** the page, form and route; the i18n test from slice 1 (no literal English in `src/pages`) must keep passing.
- [ ] **Step 4: Run** `npx vitest run && npx tsc -b && npx vite build`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: medicines management screen`.

### Task 11: Docs, end-to-end check, real-use stack

**Files:**
- Modify: `docs/MANUAL_TEST_CHECKLIST.md`, `README.md`
- Create: none

**Interfaces:**
- Consumes: everything above.

- [ ] **Step 1: Add checklist sections** for medicines and sleep: admin-only management; fixed, interval and as-needed flows; escalation on two phones; ticking on one phone updates the other; as-needed gap confirm; offline tick then sync; sleep start, stop and 409 case; medicine reminders toggle; ended medicine stops reminders.
- [ ] **Step 2: Run** the full suites: `cd backend && .venv/bin/pytest -q`, `cd frontend && npx vitest run && npx tsc -b`. Expected: all PASS.
- [ ] **Step 3: Rebuild the real-use stack** from the repo root: `docker-compose -f deploy/docker-compose.prod.yml --env-file .env up -d --build`; confirm `curl localhost:8080/api/health` and that `alembic upgrade head` ran (API log), then add a medicine, tick a dose and run a sleep session in the browser.
- [ ] **Step 4: Commit** `docs: slice 2 checklist`.
- [ ] **Step 5: Hand off** to the owner for the real-phone checklist.

## Self-Review

- **Spec coverage:** medicines with three schedule kinds (T2-T4, T10), Today list and given/skipped (T4, T9), min-gap warning (T4, T9), reminders and escalation (T6), per-person toggle (T2, T9), sleep start/stop (T5, T8), offline for new entries (T7), admin-only management (T4, T10), slice 1 follow-ups (T1).
- **Type consistency:** `Slot`/`SlotState` fields `due_at`, `status`, `dose` match `MedicineJson.slots`; the dose client id is the `MedicineDose` primary key; `scheduled_for` is the slot's `due_at` in every task; `PREF_KINDS` and `PrefsBody` both gain `medicine` (T2) and the Settings toggle saves all three (T9); queue kinds in T7 match the paths in `sync.ts`.
- **Proportion:** each task gives signatures, rules and test names; function bodies are left to the implementer.
