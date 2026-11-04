# Kinnest Slice 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A working, deployed Kinnest where all caregivers log feeds and diapers from an installed PWA, see last/next feed at a glance, and get push reminders that escalate, with backups.

**Architecture:** FastAPI + Postgres backend with a separate reminder worker process (same image, same DB, state kept in DB so restarts are safe). React PWA built to static files and served by Caddy on one origin with `/api` proxied to FastAPI. Every record carries `family_id` and `kid_id`. Offline entries queue in IndexedDB and sync with client-generated UUIDs.

**Tech Stack:** Python 3.12, FastAPI, SQLAlchemy 2 + Alembic, Postgres 16, Authlib (Google), pywebpush, pytest + httpx; React + Vite + TypeScript, Tailwind, shadcn/ui, TanStack Query, vite-plugin-pwa, i18next, idb, vitest; Docker Compose, Caddy.

**Spec:** the design above in this file (`docs/superpowers/specs/2026-10-31-kinnest-v1-design.md` once saved), sections 3, 4.1–4.3, 4.10, 4.14, 5, 7, 8 (slice 1).

## Global Constraints

- Free only: Oracle Cloud Always Free (ARM64), DuckDNS subdomain, Let's Encrypt, free-tier email. No paid services.
- Backend Python/FastAPI; frontend React; website installable as a PWA; one origin for UI and API.
- Login: Google sign-in or email magic link only. No passwords.
- Roles: Admin, Caregiver (log + view), Viewer (view only). Admin invites by email; invite accepted by signing in with that email.
- Every record has `family_id` and `kid_id`; one family and one kid in v1.
- English only, but every user-facing string (UI and server-written push text) goes through i18n keys.
- Defaults: timezone Asia/Kolkata, metric units, feed interval 3h, diaper alert window 4h.
- Escalation: due → notify all caregivers; +15 min unlogged → notify all again; +30 min → high-priority to Admin. Logging stops the chain.
- Secrets and URLs only in `.env`. File storage behind an interface (not needed yet in slice 1 beyond the interface stub).
- Docker images must build for linux/arm64.
- Dark mode dim and theme tokens via CSS variables; mobile-first.

## Review Focus

- **Offline entry synced twice** (retry after flaky network): server must keep one row; same client UUID returns the existing row.
- **Two caregivers log the same feed seconds apart**: both are accepted, but the second sees a warning naming who logged and when.
- **Phone clock wrong / future timestamp**: entries more than 5 minutes in the future are rejected; far-past entries are allowed (backfill).
- **Dead push subscription** (410/404 from push service) and **worker restart mid-escalation**: dead subscriptions are deleted, the worker never crashes, and no reminder is lost or double-sent after restart.
- **Invite/login edge cases**: email match is case-insensitive; a removed member's session stops working at once; a Viewer's write request gets 403; an uninvited Google account gets 403 and no family data.

---

### Task 1: Project scaffold, config, health check, dev stack

**Files:**
- Create: `kinnest/backend/pyproject.toml`, `kinnest/backend/app/{__init__,main,config,db}.py`, `kinnest/backend/tests/test_health.py`, `kinnest/backend/Dockerfile`
- Create: `kinnest/frontend/` (Vite React TS template), `kinnest/frontend/Dockerfile`
- Create: `kinnest/deploy/docker-compose.yml`, `kinnest/.env.example`, `kinnest/.gitignore`, `kinnest/README.md`

**Interfaces:**
- Produces: `app.config.Settings` (pydantic-settings; fields `database_url`, `session_secret`, `owner_email`, `google_client_id`, `google_client_secret`, `vapid_public_key`, `vapid_private_key`, `vapid_subject`, `smtp_url`, `public_base_url`, `app_timezone="Asia/Kolkata"`); `app.db.get_session() -> Iterator[Session]`; `app.main.app: FastAPI` with `GET /api/health -> {"status": "ok"}`.

- [ ] **Step 1: Write failing test** `test_health_returns_ok`: `client.get("/api/health").json() == {"status": "ok"}`.
- [ ] **Step 2: Run** `cd backend && pytest tests/test_health.py -v`. Expected: FAIL (module missing).
- [ ] **Step 3: Implement** scaffold above; compose services `db` (postgres:16), `api`, `worker` (stub command), `web` (Vite dev server proxying `/api`). `.env.example` lists every Settings field.
- [ ] **Step 4: Run** test (PASS) and `docker compose -f deploy/docker-compose.yml up -d --build`; `curl localhost:8000/api/health` returns ok.
- [ ] **Step 5: Commit** `feat: project scaffold and dev stack`.

### Task 2: Database models and migrations

**Files:**
- Create: `backend/app/models.py`, `backend/alembic/` (env + first migration), `backend/tests/conftest.py`, `backend/tests/test_models.py`

**Interfaces:**
- Consumes: `get_session` from Task 1.
- Produces SQLAlchemy models (UUID primary keys, `created_at` UTC): `Family(id, name)`, `Kid(id, family_id, name, birth_date, feed_interval_minutes=180, diaper_alert_minutes=240)`, `User(id, email unique lowercase, name)`, `Membership(id, family_id, user_id, role: "admin"|"caregiver"|"viewer", UNIQUE(family_id,user_id))`, `Invite(id, family_id, email lowercase, role, accepted_at nullable)`, `Feed(id client-supplied UUID, family_id, kid_id, type, started_at, duration_min nullable, quantity_ml nullable, fed_by_user_id, note, created_by, updated_by, updated_at, deleted_at nullable)`, `Diaper(id, family_id, kid_id, kind: "wet"|"dirty"|"both", at, changed_by_user_id, note, created_by, updated_by, updated_at, deleted_at)`, `PushSubscription(id, user_id, endpoint unique, p256dh, auth)`, `ReminderState(id, kid_id, kind, anchor_at, level: 0|1|2, last_sent_at)`, `NotificationPref(user_id, kind, enabled)`. Feed `type` values: `breast_left|breast_right|breast_both|expressed|formula`.
- Test fixture `db_session` uses a throwaway Postgres schema per test run.

- [ ] **Step 1: Write failing tests** `test_feed_id_is_client_supplied_and_unique` (inserting the same UUID twice raises IntegrityError) and `test_email_unique_case_insensitive` (`A@x.com` then `a@x.com` conflicts; store lowercased).
- [ ] **Step 2: Run** `pytest tests/test_models.py -v`. Expected: FAIL.
- [ ] **Step 3: Implement** models and `alembic revision --autogenerate`; check the migration with `alembic upgrade head` on a fresh DB.
- [ ] **Step 4: Run** tests. Expected: PASS.
- [ ] **Step 5: Commit** `feat: data models and initial migration`.

### Task 3: Authentication, bootstrap, invites, roles

**Files:**
- Create: `backend/app/auth/{__init__,sessions,google,magic_link,deps}.py`, `backend/app/api/auth.py`, `backend/tests/test_auth.py`

**Interfaces:**
- Consumes: models from Task 2, `Settings`.
- Produces: routes `GET /api/auth/google/start`, `GET /api/auth/google/callback`, `POST /api/auth/magic/request {email}`, `GET /api/auth/magic/verify?token=`, `POST /api/auth/logout`, `GET /api/me -> {user, family_id, kid_id, role}`; dependencies `current_member() -> Member(user, family_id, kid_id, role)`, `require_caregiver()` (admin or caregiver; else 403), `require_admin()`. Session is a signed HTTP-only cookie holding the user id plus a per-user `session_version` so removal invalidates it. Magic tokens are single-use, 15 min expiry, stored hashed. The first successful login whose email equals `Settings.owner_email` creates `Family`, `Kid` (name placeholder "Baby"), and an admin `Membership`. Any other email must match an unaccepted `Invite` (case-insensitive), which creates the `Membership` and marks the invite accepted; otherwise 403 with no data.
- Email sending behind `send_email(to, subject, body)`; dev logs to console.

- [ ] **Step 1: Write failing tests**: `test_owner_first_login_creates_family_as_admin`; `test_uninvited_email_gets_403`; `test_invite_matches_case_insensitively`; `test_magic_token_single_use`; `test_removed_member_session_rejected` (delete membership, bump `session_version`, `/api/me` returns 401); `test_viewer_cannot_use_caregiver_route` (403).
- [ ] **Step 2: Run** `pytest tests/test_auth.py -v`. Expected: FAIL.
- [ ] **Step 3: Implement** with Authlib for Google; tests stub the Google token exchange and use the magic-link path for flows.
- [ ] **Step 4: Run** tests. Expected: PASS.
- [ ] **Step 5: Commit** `feat: google + magic link auth, roles, bootstrap`.

### Task 4: Family and member management API

**Files:**
- Create: `backend/app/api/family.py`, `backend/tests/test_family.py`

**Interfaces:**
- Consumes: `require_admin`, `current_member`.
- Produces: `GET /api/family/members -> [{user_id,email,name,role,pending}]` (members plus open invites); `POST /api/family/invites {email, role}` (admin); `PATCH /api/family/members/{user_id} {role}` (admin, cannot demote the last admin); `DELETE /api/family/members/{user_id}` (admin, cannot remove self if last admin; bumps `session_version`); `GET/PATCH /api/kid` (name, birth_date, feed_interval_minutes, diaper_alert_minutes; PATCH admin only).

- [ ] **Step 1: Write failing tests**: `test_only_admin_can_invite`; `test_cannot_demote_last_admin`; `test_remove_member_revokes_access`; `test_patch_kid_interval_rejects_nonpositive`.
- [ ] **Step 2: Run** `pytest tests/test_family.py -v`. Expected: FAIL.
- [ ] **Step 3: Implement** routes.
- [ ] **Step 4: Run** tests. Expected: PASS.
- [ ] **Step 5: Commit** `feat: member, invite and kid settings API`.

### Task 5: Feed and diaper API with summary

**Files:**
- Create: `backend/app/services/summary.py`, `backend/app/api/{feeds,diapers,summary}.py`, `backend/tests/{test_feeds,test_diapers,test_summary}.py`

**Interfaces:**
- Consumes: `require_caregiver`, `current_member`, models.
- Produces: `POST /api/feeds` (body includes client `id`; if the id exists for this family, returns 200 with the existing row; otherwise 201), `PATCH /api/feeds/{id}`, `DELETE /api/feeds/{id}` (soft), `GET /api/feeds?from=&to=`; same four for `/api/diapers`. All writes require caregiver/admin; reads require any member. Reject `started_at`/`at` more than 5 minutes in the future (422). `POST` response includes `recent_other: {user_name, at} | null` when a different user logged the same kind within the last 2 minutes (the warning). `GET /api/summary -> {last_feed, next_feed_due_at, last_diaper, feeds_today, diapers_today: {wet,dirty,both}}` computed in `services.summary.build_summary(session, kid, now) -> Summary`; next due = last non-deleted feed `started_at` + `feed_interval_minutes`; "today" uses `app_timezone`.

- [ ] **Step 1: Write failing tests**: `test_post_feed_twice_same_id_keeps_one_row`; `test_future_timestamp_rejected`; `test_second_caregiver_gets_recent_other_warning`; `test_viewer_post_is_403`; `test_summary_next_due_is_last_feed_plus_interval`; `test_summary_today_boundary_uses_kolkata_midnight`; `test_deleted_feed_ignored_in_summary`.
- [ ] **Step 2: Run** `pytest tests/test_feeds.py tests/test_diapers.py tests/test_summary.py -v`. Expected: FAIL.
- [ ] **Step 3: Implement** routes and `build_summary`.
- [ ] **Step 4: Run** tests. Expected: PASS.
- [ ] **Step 5: Commit** `feat: feeds, diapers and summary API`.

### Task 6: Frontend shell, theme, i18n, auth screens, members screen

**Files:**
- Create: `frontend/src/{main.tsx,App.tsx,i18n/en.json,i18n/index.ts,theme/tokens.css,api/client.ts}`, `frontend/src/pages/{Login,Members,Settings}.tsx`, `frontend/src/components/ui/` (shadcn), `frontend/src/**/*.test.tsx`

**Interfaces:**
- Consumes: Task 3–4 routes.
- Produces: `api(path, init) -> Promise<T>` fetch wrapper (cookie credentials, 401 redirects to Login); `useMe()` hook; i18n via `t("key")` with all strings in `en.json`; theme tokens (soft pastel palette, dim dark mode following system preference with manual toggle) as CSS variables; routes `/login`, `/`, `/members`, `/settings`; Members page lists members and pending invites and lets Admin invite, change role, remove; Settings page edits kid name, birth date, feed interval, diaper alert window and notification toggles.

- [ ] **Step 1: Write failing test** (vitest): `Login renders Google button and email field using i18n keys`; `Members page hides invite form for non-admin`.
- [ ] **Step 2: Run** `cd frontend && npx vitest run`. Expected: FAIL.
- [ ] **Step 3: Implement** shell and pages; a lint rule or test fails the build if JSX contains hard-coded English text outside `t()` (keep simple: test greps `src/pages`).
- [ ] **Step 4: Run** vitest (PASS) and manually log in via magic link in the dev stack.
- [ ] **Step 5: Commit** `feat: frontend shell, auth screens, members and settings`.

### Task 7: Home screen and quick logging

**Files:**
- Create: `frontend/src/pages/Home.tsx`, `frontend/src/components/{LastFeedCard,LastDiaperCard,FeedSheet,DiaperSheet,Today}.tsx`, `frontend/src/hooks/{useSummary,useLogFeed,useLogDiaper}.ts`, tests alongside

**Interfaces:**
- Consumes: `GET /api/summary`, `POST /api/feeds`, `POST /api/diapers`, `api()`.
- Produces: Home with "Last fed 2h 10m ago · by Mom · 60 ml bottle · next due 4:30" (relative time ticks each minute), "Last diaper" card, daily counts, and Feed and Diaper quick buttons. Feed sheet: type chips, time (defaults now, editable), duration, ml (shown for expressed/formula), note; one tap saves with last-used values prefilled. Diaper sheet: wet/dirty/both buttons that save immediately with a 5-second Undo. Client generates the entry `id` with `crypto.randomUUID()` before sending. Shows the `recent_other` warning as a non-blocking toast. Viewers see cards only, no buttons. Mobile tap targets ≥ 48px.
- Home must show a feed in ≤ 2 taps from open.

- [ ] **Step 1: Write failing tests**: `shows last fed relative time and next due`; `diaper wet button posts immediately and offers undo`; `viewer sees no log buttons`; `feed sheet hides ml for breast types`.
- [ ] **Step 2: Run** `npx vitest run`. Expected: FAIL.
- [ ] **Step 3: Implement** Home and sheets with TanStack Query mutations (optimistic update).
- [ ] **Step 4: Run** vitest. Expected: PASS.
- [ ] **Step 5: Commit** `feat: home screen with quick feed and diaper logging`.

### Task 8: PWA install and offline queue with health banner

**Files:**
- Create: `frontend/src/offline/{queue.ts,sync.ts}`, `frontend/src/components/OfflineBanner.tsx`, `frontend/vite.config.ts` (PWA plugin config), `frontend/public/{icons,manifest}`, tests alongside

**Interfaces:**
- Consumes: mutation hooks from Task 7.
- Produces: `enqueue(entry: {kind:"feed"|"diaper", id: string, payload: object}) -> Promise<void>`; `flush() -> Promise<{sent:number, failed:number}>` (IndexedDB via `idb`, FIFO, retries with backoff, treats 200 and 201 as success, drops on 4xx other than 401/429 and surfaces an error); entries show as "pending" until synced and keep their original timestamp; `flush` runs on `online` event, on app focus, and every 30 s. `OfflineBanner` shows when `/api/health` fails twice, 2+ minutes apart in total, with the i18n text "Can't reach the server, reminders may be delayed" (my call). The service worker precaches the app shell, and installable manifest has name "Kinnest", standalone display, and icons.

- [ ] **Step 1: Write failing tests**: `flush sends queued entries in order and removes them`; `flush retried after network error does not duplicate (same id sent)`; `4xx drops entry and reports error`; `banner appears after repeated health failures`.
- [ ] **Step 2: Run** `npx vitest run`. Expected: FAIL.
- [ ] **Step 3: Implement** queue, sync, banner, and PWA config; Home mutations call `enqueue` when `fetch` throws a network error.
- [ ] **Step 4: Run** vitest (PASS). Manually: set browser offline, log a feed, go online, confirm one row on the server.
- [ ] **Step 5: Commit** `feat: pwa install, offline queue and server banner`.

### Task 9: Web push subscription and reminder worker

**Files:**
- Create: `backend/app/api/push.py`, `backend/app/services/push.py`, `backend/app/worker/{__init__,main,reminders}.py`, `backend/tests/{test_push_api,test_reminders}.py`, `frontend/src/push/subscribe.ts`, `frontend/src/public/sw-push.js` (push and notificationclick handlers; imported by the PWA service worker), i18n keys for notification text

**Interfaces:**
- Consumes: `ReminderState`, `PushSubscription`, `Kid`, models; `Settings` VAPID keys.
- Produces: `GET /api/push/public-key`; `POST /api/push/subscribe {endpoint, keys}`; `DELETE /api/push/subscribe`; `services.push.send(sub, title_key, body_params, urgency) -> "ok"|"gone"|"error"` (deletes subscription on `gone`); `worker.reminders.tick(session, now, sender) -> list[Sent]` pure function over DB state, called every 60 s by `worker.main`. `tick` rules: for each kid, compute `due = last feed started_at + interval`. Level 0 at `due`, level 1 at `due+15m`, level 2 at `due+30m`; level 0 and 1 go to all caregivers and admins with feed reminders enabled, level 2 to admins only with urgency high. A `ReminderState(kind="feed", anchor_at=due)` row records the highest level sent so restarts never resend, and a new feed (new `due`) starts a fresh chain. No feed has ever been logged, then no reminders. Diaper alert: one notification when `now - last diaper > diaper_alert_minutes`, once per anchor. Notification body includes who logged last and when. Tapping opens `/?log=feed`. Settings toggles map to `NotificationPref` and `tick` respects them. Subscribe prompt appears on Home after first login and explains iPhone needs "Add to Home Screen" first.

- [ ] **Step 1: Write failing tests** (fake clock and fake sender): `test_no_reminder_before_due`; `test_level0_at_due_goes_to_all_caregivers_not_viewers`; `test_level1_after_15_min_if_unlogged`; `test_level2_after_30_min_goes_only_to_admin_high_urgency`; `test_logging_feed_stops_chain`; `test_restart_does_not_resend_same_level` (call `tick` twice, new process simulated); `test_gone_subscription_deleted_and_others_still_sent`; `test_pref_off_skips_user`; `test_no_feed_logged_ever_sends_nothing`; `test_diaper_alert_once_per_anchor`.
- [ ] **Step 2: Run** `pytest tests/test_reminders.py tests/test_push_api.py -v`. Expected: FAIL.
- [ ] **Step 3: Implement** `tick` as a function of DB rows; do not rely on in-memory scheduler state. `worker.main` loops with `sleep` to the next minute boundary and catches all exceptions per tick (log and continue).
- [ ] **Step 4: Run** tests (PASS). Manually: generate VAPID keys, subscribe from Chrome on `localhost`, shorten the interval to 2 minutes in Settings, confirm level 0 then level 1 notifications arrive.
- [ ] **Step 5: Commit** `feat: web push and escalating feed reminders`.

### Task 10: Production deploy, backups, restore, phone test guide

**Files:**
- Create: `deploy/docker-compose.prod.yml`, `deploy/Caddyfile`, `deploy/backup.sh`, `deploy/restore.sh`, `deploy/ORACLE_SETUP.md`, `docs/TESTING_ON_PHONE.md`, `docs/MANUAL_TEST_CHECKLIST.md`

**Interfaces:**
- Consumes: Docker images from Task 1, worker from Task 9.
- Produces: prod compose with services `caddy` (serves `frontend/dist`, proxies `/api` to `api:8000`, automatic HTTPS for `${PUBLIC_HOST}`), `api`, `worker`, `db` (volume), all `restart: unless-stopped`, images built for linux/arm64; `backup.sh` runs `pg_dump` nightly via cron on the VM and uploads to Oracle Object Storage (S3-compatible, via `aws s3 cp --endpoint-url`), keeps 14 days, and exits non-zero on failure; `restore.sh <dump>` restores into a fresh DB; `ORACLE_SETUP.md` is a step-by-step for the owner: create the Always Free VM (and Google e2-micro fallback), open ports 80 and 443 in the VCN and OS firewall, DuckDNS subdomain with a cron updater, install Docker, set `.env`, `docker compose up -d`, add the backup cron, and optionally upgrade to Pay-As-You-Go to avoid idle reclaim. `TESTING_ON_PHONE.md` covers `cloudflared tunnel --url http://localhost:8000` for real-phone HTTPS tests, Android Emulator with `adb reverse tcp:8000 tcp:8000`, and the iPhone "Add to Home Screen" steps. `MANUAL_TEST_CHECKLIST.md` lists the Review Focus cases plus install, login, log, offline, push, escalation, role checks.

- [ ] **Step 1: Verify** `docker compose -f deploy/docker-compose.prod.yml config` is valid and `docker buildx build --platform linux/arm64 backend` succeeds.
- [ ] **Step 2: Run backup then restore locally**: `deploy/backup.sh` against the dev DB to a local dir (script supports `BACKUP_TARGET=local:<dir>`), drop the DB, `deploy/restore.sh <file>`, confirm feed rows are back. Expected: row counts match.
- [ ] **Step 3: Walk the manual checklist** on the dev stack with a phone via the tunnel; record failures and fix them in the earlier tasks.
- [ ] **Step 4: Commit** `feat: production deploy, backups and test guides`.
- [ ] **Step 5: Hand-off to owner**: owner follows `ORACLE_SETUP.md` (needs their Oracle account, which only they can create), then we run the checklist against production before family use.

## Self-Review

- **Spec coverage:** auth/roles/invites (T3–4), feeds and diapers incl. next-due and daily counts (T5, T7), home screen and quick log (T7), diaper alert (T9), escalation and push (T9), offline queue and server banner (T8), i18n-ready English (T6), PWA install (T8), dark mode and theme tokens (T6), production on Oracle with backups (T10). Sleep, medicines, and later slices are out of scope by design.
- **Type consistency:** `current_member`/`require_caregiver`/`require_admin` (T3) used in T4–5; feed `type` values (T2) match the Feed sheet (T7); client entry `id` is the Feed/Diaper primary key (T2, T5, T7, T8); `ReminderState` levels match `tick` (T9).
- **Proportion:** each task lists signatures, rules, and tests, and leaves bodies to the implementer.

## Verification (end to end, slice 1)

1. `cd backend && pytest` and `cd frontend && npx vitest run` pass.
2. Dev stack: log in as owner, invite a second Google/email account as Caregiver and a third as Viewer, confirm the Viewer cannot log.
3. Log a feed and a diaper from a real phone via the tunnel; Home shows last/next within 1 s.
4. Offline test: airplane mode, log a feed, reconnect, one row appears.
5. Push test: shorten the interval to 2 minutes, confirm level 0, level 1, and Admin-only level 2 notifications arrive; logging a feed stops them.
6. Backup then restore round trip restores all rows.
7. After Oracle deploy: repeat 2–5 on the real subdomain with the family's phones.
