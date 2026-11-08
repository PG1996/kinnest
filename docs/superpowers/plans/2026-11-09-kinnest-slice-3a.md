# Kinnest Slice 3a Implementation Plan (vitals and growth, vaccines, doctor visits)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Track what is measured and scheduled around the child by hand: vitals and growth readings with place and graphs (WHO percentiles for growth), a vaccination schedule started from a template and fully editable, and doctor visits, with reminders for vaccines and visits.

**Architecture:** Same stack and conventions as slices 1 to 2b. Vitals live in one table with a nullable column per measurement (one row = one entry, any subset of measurements). WHO growth standards are bundled data plus a small LMS calculator. Vaccine templates are bundled JSON copied from official sources. Vaccine and visit reminders extend the existing worker and `ReminderState` chains. No file storage and no AI in this slice (they come in 3b).

**Tech Stack:** unchanged, plus Recharts on the frontend for graphs.

**Spec:** `docs/superpowers/specs/2026-10-31-kinnest-v1-design.md` sections 4.6, 4.7, 4.8 (4.7 and 4.8 as amended; ignore the photo, attachment and scan parts, which are slice 3b). Conventions: `docs/superpowers/plans/2026-11-08-kinnest-slice-2.md` and `docs/HANDOFF.md`.

## Global Constraints

- Free only; no new paid services. Python 3.12 via `uv`, as in `docs/HANDOFF.md`.
- Roles: Admin and Caregiver add, edit and delete vitals, vaccines and visits; Viewer reads only. Every record has `family_id` and `kid_id`; cross-family access by id is 404.
- Client-generated UUIDs for vitals entries (safe offline retry); server-generated ids for vaccinations and visits.
- Metric units only: kg, cm, degrees Celsius, beats and breaths per minute, percent. Values are range-checked (below) and the error says what the range is (a temperature typed in Fahrenheit must be refused with a hint).
- Timestamps more than 5 minutes in the future are rejected; a reading before the child's birth date is rejected.
- Family timezone `APP_TIMEZONE` for "today", day boundaries and reminder times.
- No medical advice in the app: reference lines and percentiles are information. WHO data and vaccine schedules must come from official sources, with the source URL and retrieval date stored beside the data and shown in the app.
- All user-facing text, including push text, goes through i18n keys. No Claude co-author or attribution line in commits.

## Review Focus

- **Vitals values**: a temperature of 98.6 (Fahrenheit), a weight of 62 kg, 0 or negative numbers, an empty entry, and a reading dated before birth are refused with a clear message; valid edge values are accepted.
- **Bulk history**: all-or-nothing with per-row errors; re-submitting the same batch (double tap, retry) creates no duplicates; more than 200 rows refused.
- **Growth curves**: reading at exactly 0 and 60 months, at the 24-month switch from length-for-age to height-for-age, a missing birth date (charts say so instead of crashing), percentile for a value far outside the curves, and interpolation between months.
- **Vaccine template**: applying twice never duplicates; due dates are computed from the birth date with correct month arithmetic (month ends, leap day); a given vaccine is never changed by re-applying; editing, skipping and deleting work on template entries.
- **Reminders**: evening-before and morning-of vaccine reminders and visit reminders fire once each, survive a worker restart, never fire for given, skipped, cancelled or deleted items, are not sent in a burst after the Mac was asleep, and use the family timezone around midnight.
- **Roles**: Viewer cannot write anything; Caregiver cannot change other families' data; deleted rows disappear from lists and charts but stay in the database.

---

### Task 1: Vitals data model, migration and new preference kinds

**Files:**
- Modify: `backend/app/models.py`, `backend/app/api/push.py` (`PREF_KINDS`, `PrefsBody`)
- Create: `backend/alembic/versions/<rev>_vitals.py`, `backend/tests/test_models_vitals.py`

**Interfaces:**
- Produces model `VitalEntry(id client uuid, family_id, kid_id, measured_at tz-aware, place_kind: "home"|"hospital"|"clinic"|"other", place_name: str, measured_by: str, note: str, weight_kg: Numeric(5,2)|None, height_cm: Numeric(4,1)|None, head_cm: Numeric(4,1)|None, temperature_c: Numeric(3,1)|None, heart_rate: int|None, resp_rate: int|None, spo2: int|None, created_by, updated_by, created_at, updated_at, deleted_at)` with CHECK constraints for the ranges: weight 0.3 to 60, height 20 to 150, head 20 to 60, temperature 30 to 45, heart rate 30 to 300, breathing rate 5 to 120, SpO2 50 to 100, and "at least one measurement is not null".
- `PREF_KINDS` becomes `("feed", "diaper", "medicine", "vaccine", "visit")`; `PrefsBody` gains `vaccine: bool = True` and `visit: bool = True` (older clients omit them); `GET /api/notification-prefs` returns all five.

- [ ] **Step 1: Write failing tests**: `test_entry_roundtrips_exact_decimals`; `test_each_range_is_enforced` (parametrized: weight 0.2 and 61, temperature 29.9 and 45.1, SpO2 49 and 101, and so on, IntegrityError); `test_entry_with_no_measurement_is_refused`; `test_prefs_default_on_for_new_kinds_and_old_clients_keep_working`.
- [ ] **Step 2: Run** `cd backend && .venv/bin/pytest tests/test_models_vitals.py tests/test_push_api.py -q`. Expected: FAIL.
- [ ] **Step 3: Implement** the model, constraints and prefs; autogenerate the migration and add the three CHECKs by hand (Alembic does not detect them); verify `alembic upgrade`, `downgrade -1`, `upgrade`, `alembic check`.
- [ ] **Step 4: Run** the backend suite. Expected: PASS.
- [ ] **Step 5: Commit** `feat: vitals model and new reminder preference kinds`.

### Task 2: Vitals API (entry, bulk history, listing)

**Files:**
- Create: `backend/app/api/vitals.py`, `backend/tests/test_vitals.py`
- Modify: `backend/app/main.py`, `backend/app/services/summary.py`, `backend/app/api/summary.py`

**Interfaces:**
- Consumes: `require_caregiver`, `current_member`, `reject_future`, models from Task 1.
- Produces (under `/api`): `VitalJson = {id, measured_at, place_kind, place_name, measured_by, note, weight_kg, height_cm, head_cm, temperature_c, heart_rate, resp_rate, spo2, entered_by_name}` (numbers as JSON numbers). `POST /vitals` (201; same id 200 with the stored row), `PATCH /vitals/{id}`, `DELETE /vitals/{id}` (soft), `GET /vitals?from=&to=&place_kind=&limit=` newest first. `POST /vitals/bulk {entries: [VitalIn...]}`: at most 200, all-or-nothing, 422 body `{errors: [{index, detail}]}`, rows whose id already exists are returned unchanged, response `{created: n, existing: n, entries: [...]}`. Validation messages name the range (for example `temperature must be 30 to 45 degrees Celsius`). `GET /api/summary` gains `vitals: {latest: {weight_kg|None: VitalJson | None, ...}}`, meaning for each of weight, height, head, temperature the latest entry that has that value (the date and place travel with it).

- [ ] **Step 1: Write failing tests** (`family` and `clock` fixtures as in earlier slices): `test_create_entry_201_and_same_id_200`; `test_fahrenheit_temperature_refused_with_a_hint` (98.6); `test_values_outside_ranges_refused` (parametrized); `test_empty_entry_refused`; `test_reading_before_birth_refused_and_future_refused`; `test_bulk_all_or_nothing_reports_row_errors` (row 3 bad, nothing saved); `test_bulk_resubmit_creates_no_duplicates`; `test_bulk_over_200_refused`; `test_filters_by_range_and_place`; `test_viewer_read_only_and_cross_family_404`; `test_patch_revalidates_the_whole_entry`; `test_delete_hides_but_keeps_the_row`; `test_summary_latest_per_measurement`.
- [ ] **Step 2: Run** `.venv/bin/pytest tests/test_vitals.py -q`. Expected: FAIL.
- [ ] **Step 3: Implement** the router, validation (one `VitalIn` model shared by single and bulk), and the summary extension.
- [ ] **Step 4: Run** the backend suite. Expected: PASS.
- [ ] **Step 5: Commit** `feat: vitals API with bulk history`.

### Task 3: WHO growth standards and curves

**Files:**
- Create: `backend/app/data/who/` (official LMS tables for girls, 0 to 60 months: weight-for-age, length-for-age 0 to 24 months, height-for-age 24 to 60 months, head-circumference-for-age, as JSON with `source_url` and `retrieved_on`), `backend/app/services/who.py`, `backend/tests/test_who.py`, `backend/scripts/load_who.py` (the script that converts the official files into the JSON)
- Modify: `backend/app/api/vitals.py`

**Interfaces:**
- `lms(kind: "weight"|"height"|"head", age_months: float) -> tuple[float, float, float]` (L, M, S, linearly interpolated between whole months; length-for-age below 24 months, height-for-age from 24, with the documented 0.7 cm convention noted in the source file; raises `ValueError` outside 0 to 60). `value_at_percentile(kind, age_months, p: float) -> float` and `percentile_of(kind, age_months, value) -> float` (0 to 100, one decimal) using the LMS formulas `value = M * (1 + L*S*z)^(1/L)` (`M * exp(S*z)` when L is 0) and `z = ((value/M)^L - 1) / (L*S)`.
- `GET /api/vitals/growth/{kind}` (any member): `{birth_date, source: {name, url, retrieved_on}, curves: {"3": [[month, value], ...], "15": [...], "50": [...], "85": [...], "97": [...]}, points: [{id, measured_at, age_months, value, percentile, place_kind}]}` with monthly curve points from 0 to 60; 409 `{detail: "birth date not set"}` when the kid has no birth date.

- [ ] **Step 1: Obtain and verify the data.** Download the official WHO girls tables from the WHO Child Growth Standards pages (`who.int/tools/child-growth-standards/standards`), convert with `scripts/load_who.py`, and record the source URL and date in each JSON. Copy three published values per table (month 0, a middle month, month 60: L, M, S) from the official file into the tests; do not type them from memory.
- [ ] **Step 2: Write failing tests**: `test_lms_matches_the_official_table_values` (the copied values, exact); `test_interpolates_between_months`; `test_median_is_the_50th_percentile` (percentile_of(M) is 50.0); `test_percentile_roundtrip` (value_at_percentile then percentile_of within 0.1); `test_outside_range_raises`; `test_switch_at_24_months_uses_height_table`; `test_growth_endpoint_curves_and_points` (a weight reading of the median value gives percentile 50); `test_growth_endpoint_without_birth_date_is_409`; `test_points_exclude_deleted_and_other_measurements`.
- [ ] **Step 3: Run** `.venv/bin/pytest tests/test_who.py -q`. Expected: FAIL.
- [ ] **Step 4: Implement** the loader, calculator and endpoint.
- [ ] **Step 5: Run** the backend suite and **commit** `feat: WHO growth standards and growth curves`.

### Task 4: Vaccinations, templates and API

**Files:**
- Create: `backend/app/data/vaccines/iap.json`, `backend/app/data/vaccines/uip.json`, `backend/app/services/vaccines.py`, `backend/app/api/vaccines.py`, `backend/tests/test_vaccines.py`, `backend/alembic/versions/<rev>_vaccinations.py`
- Modify: `backend/app/models.py`, `backend/app/main.py`

**Interfaces:**
- Model `Vaccination(id server uuid, family_id, kid_id, name, dose_label, due_date: date, given_on: date|None, status: "pending"|"given"|"skipped", place: str, notes: str, source: "iap"|"uip"|"manual", created_by, updated_by, created_at, updated_at, deleted_at)`.
- Template files: `{id, name, description, source_url, source_date, entries: [{name, dose_label, due_after: {"weeks": n} | {"months": n} | {"days": n}, notes}]}`. **The entries must be taken from the official published schedules** (IAP's current immunisation timetable and the Government of India UIP schedule); record the source URL and date in each file; the owner checks them against the hospital sheet before relying on them.
- `add_months(d: date, n: int) -> date` and `due_date_for(birth: date, due_after: dict) -> date` in `services/vaccines.py` (month ends clamp to the last day).
- API (under `/api`): `GET /vaccines/templates` -> `[{id, name, description, source_url, source_date, count}]`; `POST /vaccines/apply-template {template_id, mode: "fill" | "add_missing"}` (caregiver; 409 `{detail, existing}` if `mode` is `fill` and any live entries exist; `add_missing` skips entries with the same name and dose label; 409 `birth date not set` without a birth date); `GET /vaccines`; `POST /vaccines`, `PATCH /vaccines/{id}`, `DELETE /vaccines/{id}`; marking given is a PATCH of `status: "given"`, `given_on`, `place`, `notes` (`given_on` not in the future). `VaccinationJson` adds `overdue: bool` (pending and due before today) and `days_until: int`.

- [ ] **Step 1: Write failing tests**: `test_add_months_clamps_month_ends_and_handles_leap_day`; `test_due_dates_from_birth_date` (weeks, months, days); `test_templates_listed_with_source`; `test_apply_template_fills_the_schedule`; `test_apply_twice_is_409_and_creates_nothing`; `test_add_missing_skips_existing_and_keeps_given`; `test_apply_without_birth_date_409`; `test_mark_given_requires_a_valid_date`; `test_skip_and_delete_template_entries`; `test_manual_entry_crud`; `test_overdue_and_days_until`; `test_viewer_read_only_and_cross_family_404`.
- [ ] **Step 2: Run** `.venv/bin/pytest tests/test_vaccines.py -q`. Expected: FAIL.
- [ ] **Step 3: Implement** after sourcing and committing the two template files with their sources.
- [ ] **Step 4: Run** the backend suite and **commit** `feat: vaccination schedule with templates`.

### Task 5: Doctor visits API

**Files:**
- Create: `backend/app/api/visits.py`, `backend/tests/test_visits.py`, `backend/alembic/versions/<rev>_doctor_visits.py`
- Modify: `backend/app/models.py`, `backend/app/main.py`

**Interfaces:**
- Model `DoctorVisit(id server uuid, family_id, kid_id, scheduled_at tz-aware, doctor, place, reason, status: "upcoming"|"done"|"cancelled", notes, prescription_notes, created_by, updated_by, created_at, updated_at, deleted_at)`.
- API: `GET /visits?status=&from=&to=` (upcoming soonest first, past newest first), `POST /visits`, `PATCH /visits/{id}` (including marking done with notes and prescription notes, or cancelled), `DELETE /visits/{id}` (soft). No file attachments yet (slice 3b).

- [ ] **Step 1: Write failing tests**: `test_visit_crud_and_status_changes`; `test_listing_order_for_upcoming_and_past`; `test_visit_in_the_past_can_be_logged_as_done`; `test_viewer_read_only_and_cross_family_404`; `test_validation` (empty doctor and reason allowed, bad status 422).
- [ ] **Step 2: Run** `.venv/bin/pytest tests/test_visits.py -q`. Expected: FAIL.
- [ ] **Step 3: Implement** the model, migration and router.
- [ ] **Step 4: Run** the backend suite and **commit** `feat: doctor visits API`.

### Task 6: Vaccine and visit reminders

**Files:**
- Modify: `backend/app/worker/reminders.py`, `backend/app/i18n.py`
- Test: `backend/tests/test_vaccine_visit_reminders.py`

**Interfaces:**
- Produces `_vaccine_reminders(db, kid, now, sender, tz, sent)` and `_visit_reminders(...)`, called from `tick` after the medicine chains, each committing after every chain as in earlier slices. For a pending vaccination with due date D: moment 1 is D minus one day at 18:00 family time, moment 2 is D at 08:00. For an upcoming visit at time T: moment 1 is the day before at 18:00, moment 2 is T minus 1 hour (skipped when it would be earlier than moment 1 plus 2 hours). `ReminderState(kind="vaccine"|"visit", subject_id=<id>, anchor_at=<moment>, level=0)` marks each sent moment; a moment is sent only if `now` is at or after it and no more than 3 hours past it (so a Mac that slept does not send old reminders), the item was created before the moment, and its status is still pending or upcoming. Recipients: caregivers and admins with the `vaccine` or `visit` preference on. New i18n keys: `vaccine_eve`, `vaccine_today`, `visit_eve`, `visit_soon`. Urls `/?log=vaccine` and `/?log=visit`.

- [ ] **Step 1: Write failing tests** (fake clock and sender as in `test_medicine_reminders.py`): `test_vaccine_evening_before_then_morning_of`; `test_each_moment_fires_once_and_survives_restart`; `test_given_skipped_deleted_vaccine_never_reminds`; `test_visit_evening_before_and_one_hour_before`; `test_cancelled_or_done_visit_never_reminds`; `test_a_late_tick_after_a_sleep_skips_old_moments`; `test_created_after_the_moment_is_not_reminded`; `test_prefs_off_skips_user_and_viewers_never_get_them`; `test_family_timezone_is_used_around_midnight`.
- [ ] **Step 2: Run** `.venv/bin/pytest tests/test_vaccine_visit_reminders.py -q`. Expected: FAIL.
- [ ] **Step 3: Implement** the two functions and keys; extend the purge so the newest state per subject is kept.
- [ ] **Step 4: Run** the backend suite and **commit** `feat: vaccine and visit reminders`.

### Task 7: Frontend data layer and the Health area

**Files:**
- Modify: `frontend/src/api/hooks.ts`, `frontend/src/hooks/log.ts`, `frontend/src/offline/queue.ts`, `frontend/src/offline/sync.ts`, `frontend/src/components/Layout.tsx`, `frontend/src/App.tsx`, `frontend/src/i18n/en.json`, `frontend/src/pages/Settings.tsx`
- Create: `frontend/src/pages/Health.tsx` (shell with sub-tabs Vitals, Vaccines, Visits), `frontend/src/lib/vitals.ts`
- Test: `frontend/src/hooks/slice3a.test.tsx`, `frontend/src/App.test.tsx`, `frontend/src/pages/pages.test.tsx`

**Interfaces:**
- Types: `PlaceKind`, `Vital`, `VitalInput`, `GrowthCurves`, `Vaccination`, `VaccineTemplate`, `Visit`. Hooks: `useVitals(filters)`, `useCreateVital()` (queued offline under kind `'vital'` -> `POST /api/vitals`), `useUpdateVital()`, `useDeleteVital()`, `useBulkVitals()` (online only, returns the per-row errors), `useGrowth(kind)`, `useVaccines()`, `useVaccineTemplates()`, `useApplyTemplate()`, vaccine and visit mutations, `useVisits()`.
- `lib/vitals.ts`: `MEASUREMENTS` (key, i18n label key, unit, min, max, decimals) shared by the form and the validators; `validateVital(input): Record<string, string>` mirroring the server ranges, including the Fahrenheit hint.
- Navigation becomes Home, Medicines, **Health**, Family, Settings (Health holds Vitals, Vaccines, Visits as sub-tabs); Settings gets toggles for vaccine and visit reminders; the Settings kid form makes the birth date prominent and explains that charts and the vaccine schedule need it.
- The nav, sign-out and settings tests are updated for the new tab and toggles.

- [ ] **Step 1: Write failing tests**: `validateVital refuses 98.6 for temperature with a hint and accepts 36.8`; `a vital created offline is queued and syncs to /api/vitals`; `bulk shows per-row server errors`; `nav has Health and the old tabs still work`; `Settings saves vaccine and visit toggles with the other preferences`.
- [ ] **Step 2: Run** `cd frontend && npx vitest run`. Expected: FAIL.
- [ ] **Step 3: Implement** types, hooks, queue kind, shared measurement table and navigation.
- [ ] **Step 4: Run** `npx vitest run && npx tsc -b`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: frontend data layer and Health area`.

### Task 8: Vitals entry, list and Home card

**Files:**
- Create: `frontend/src/pages/VitalsTab.tsx`, `frontend/src/components/VitalForm.tsx`, `frontend/src/components/VitalList.tsx`, `frontend/src/components/LatestVitalsCard.tsx`
- Modify: `frontend/src/pages/Home.tsx`, `frontend/src/i18n/en.json`
- Test: `frontend/src/pages/Vitals.test.tsx`

**Interfaces:**
- `VitalForm`: checkboxes or chips to choose which measurements to record, number inputs with units and the allowed range, when (defaults to now, editable), place chips (Home, Hospital, Clinic, Other) with an optional place name, measured by, note; the same form edits an entry. `VitalList`: newest first, each row shows time, place and the values, with Edit and Delete (two-step confirm), and filters for place and date range. `LatestVitalsCard` on Home: "4.2 kg · 54 cm · 36.8 °C" with date and place per value and an Add vitals button. Viewers see lists and cards without buttons. Entries made offline show as waiting to sync.

- [ ] **Step 1: Write failing tests**: `adds a weight and temperature entry with place and posts the right body`; `at least one measurement required`; `shows the range in the error and refuses 98.6`; `edit prefills and PATCHes`; `delete needs a second confirm`; `filters list by place`; `Home card shows the latest value of each measurement with its place`; `viewer sees no buttons`; `queued entry shows waiting to sync`.
- [ ] **Step 2: Run** `npx vitest run src/pages/Vitals.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement** the components and wire them into the Health tab and Home.
- [ ] **Step 4: Run** `npx vitest run && npx tsc -b`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: vitals entry, list and Home card`.

### Task 9: Graphs and bulk history entry

**Files:**
- Create: `frontend/src/components/GrowthChart.tsx`, `frontend/src/components/TrendChart.tsx`, `frontend/src/pages/VitalsCharts.tsx`, `frontend/src/components/BulkVitals.tsx`
- Modify: `frontend/package.json` (add `recharts`), `frontend/src/pages/VitalsTab.tsx`, `frontend/src/i18n/en.json`
- Test: `frontend/src/pages/VitalsCharts.test.tsx`

**Interfaces:**
- `GrowthChart({kind})` uses `useGrowth`: five WHO percentile lines (3, 15, 50, 85, 97) in soft colours, the child's points as a line with dots coloured by place, tooltip with date, value, percentile and place, x axis in months; shows the source note (name, URL, retrieval date) and, when the birth date is missing, a message with a link to Settings. `TrendChart({measurement})` for temperature (with a dashed fever line at 38.0 °C labelled as information), heart rate, breathing rate and SpO2 (plain lines, no reference bands) with the same filters. `VitalsCharts` shows weight, height, head, temperature and the other three, with a date-range filter and a place filter. `BulkVitals`: an editable table (rows of date, time, place, and one column per measurement), Add row, paste support for tab-separated text, per-row validation using `validateVital`, server row errors shown on their rows, one Save that posts `/api/vitals/bulk`; nothing is saved on any error.

- [ ] **Step 1: Write failing tests** (stub Recharts' `ResponsiveContainer` size in the test setup): `weight chart draws five percentile lines and the child's points`; `points are coloured by place and the tooltip shows percentile`; `missing birth date shows the settings hint`; `temperature chart has the fever line labelled as information`; `place filter hides hospital readings`; `bulk table validates rows and blocks saving on errors`; `bulk saves all rows with one request and shows server row errors`; `pasting tab-separated rows fills the table`.
- [ ] **Step 2: Run** `npx vitest run src/pages/VitalsCharts.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement** the charts and the bulk table.
- [ ] **Step 4: Run** `npx vitest run && npx tsc -b && npx vite build`. Expected: PASS (check the bundle size stays reasonable).
- [ ] **Step 5: Commit** `feat: growth and trend graphs, bulk vitals history`.

### Task 10: Vaccines screen

**Files:**
- Create: `frontend/src/pages/VaccinesTab.tsx`, `frontend/src/components/VaccineForm.tsx`, `frontend/src/components/TemplatePicker.tsx`
- Modify: `frontend/src/i18n/en.json`
- Test: `frontend/src/pages/Vaccines.test.tsx`

**Interfaces:**
- With no schedule: `TemplatePicker` lists the templates (name, description, number of vaccines, source link and date) and "Start with an empty list"; choosing one calls `apply-template` (`fill`). With a schedule: grouped list (overdue, due soon in 30 days, later, done) with status chips; per entry **Mark given** (date defaulting to today, place, notes), **Skip**, **Edit**, **Delete** (two-step), and **Add vaccine** for special ones; an **Add missing from a template** action (`add_missing`). Birth date missing: message with a link to Settings and the picker disabled. A visible note says the schedule is a starting point and the hospital or doctor's advice comes first. Viewers see the list only.

- [ ] **Step 1: Write failing tests**: `picker lists templates with sources and applies the chosen one`; `birth date missing disables the picker`; `list groups overdue, due soon and done`; `mark given posts date place and notes`; `a given date in the future is refused`; `skip and delete (two-step)`; `add a custom vaccine`; `add missing from template keeps existing entries`; `409 on fill explains the schedule already exists`; `viewer sees no buttons`.
- [ ] **Step 2: Run** `npx vitest run src/pages/Vaccines.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement** the screen.
- [ ] **Step 4: Run** `npx vitest run && npx tsc -b`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: vaccination schedule screen`.

### Task 11: Doctor visits screen and Home upcoming list

**Files:**
- Create: `frontend/src/pages/VisitsTab.tsx`, `frontend/src/components/VisitForm.tsx`, `frontend/src/components/UpcomingCard.tsx`
- Modify: `frontend/src/pages/Home.tsx`, `frontend/src/i18n/en.json`
- Test: `frontend/src/pages/Visits.test.tsx`

**Interfaces:**
- Visits: upcoming list (soonest first) and past list; add or edit a visit (date and time, doctor, place, reason); **Mark done** with notes and prescription notes; **Cancel**; Delete (two-step); on a done visit an **Add medicine** shortcut opens the Medicines screen with the add form open. `UpcomingCard` on Home lists vaccines and visits in the next 7 days (and overdue vaccines) with their dates; tapping a vaccine or visit notification (`?log=vaccine` or `?log=visit`) opens the relevant Health tab. Viewers read only.

- [ ] **Step 1: Write failing tests**: `adds an upcoming visit and posts the right body`; `lists order upcoming and past`; `mark done saves notes and prescription notes`; `cancel and delete (two-step)`; `Add medicine opens the medicines form`; `Home card shows what is coming in 7 days and overdue vaccines`; `notification links open the right tab`; `viewer sees no buttons`.
- [ ] **Step 2: Run** `npx vitest run src/pages/Visits.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement** the screen, the Home card and the deep links.
- [ ] **Step 4: Run** `npx vitest run && npx tsc -b`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: doctor visits screen and upcoming card`.

### Task 12: Checklist, end-to-end check, real-use stack

**Files:**
- Modify: `docs/MANUAL_TEST_CHECKLIST.md`

- [ ] **Step 1: Add checklist sections** (vitals entry at home and hospital, bulk history, Fahrenheit refusal, charts with WHO bands and place colours, vaccine template and edits, visits, the reminders at their moments, roles, offline vital).
- [ ] **Step 2: Run** the full suites: `cd backend && .venv/bin/pytest -q`, `cd frontend && npx vitest run && npx tsc -b`. Expected: all PASS.
- [ ] **Step 3: Back up the real-use database, rebuild and verify** as in `docs/HANDOFF.md` (backup first, `up -d --build`, `alembic current` at the new head, health, existing data present).
- [ ] **Step 4: Smoke test on the dev stack** with a minted session (see HANDOFF): add vitals, run a bulk import with one bad row, fetch growth curves, apply a vaccine template twice (second is 409), create a visit, run `run_once()`.
- [ ] **Step 5: Commit** `docs: slice 3a checklist`, then hand off to the owner for real phones.

## Self-Review

- **Spec coverage:** vitals with place, who entered and measured, backdating, offline (T1, T2, T7, T8); bulk history entry (T2, T9); WHO graphs, temperature line, trend lines, filters (T3, T9); vaccine templates (IAP and UIP), editing, marking given, reminders (T4, T6, T10); doctor visits, reminders, medicine shortcut (T5, T6, T11). Not here by decision: attachments, photo import, vaccine scan, medicine photos (slice 3b).
- **Type consistency:** `VitalJson` fields (T2) match `Vital` (T7) and `MEASUREMENTS` keys; `growth` response (T3) matches `GrowthCurves` (T7, T9); `PREF_KINDS` additions (T1) match the Settings toggles (T7) and the worker (T6); template entry shape (T4) matches the picker counts (T10).
- **Proportion:** each task gives signatures, rules and test names; bodies are left to the implementer.
