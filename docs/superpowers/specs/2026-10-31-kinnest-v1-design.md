# Kinnest — v1 Design

Status: design approved by the owner, 2026-11-04. Written from the brainstorm with the parent (the "owner"),
reviewed by a builder check (its questions are answered below). "(my call)" marks decisions the designer made
that the owner did not state; everything else the owner decided.

Scope of the current build: **slice 1 only** (section 8). The implementation plan for it is the
"Slice 1 Implementation Plan" at the end of this file. Slices 2–4 get their own plans after slice 1 is tested.

On exit from plan mode (first actions):
1. Create `/Users/pg26/code/cursor/kinnest/` and `git init` it.
2. Save the design below as `kinnest/docs/superpowers/specs/2026-10-31-kinnest-v1-design.md` and the plan as
   `kinnest/docs/superpowers/plans/2026-11-04-kinnest-slice-1.md`, then commit both.
3. Execute the plan task by task.

## 1. Intent

Kinnest is a lifelong logbook for one child, starting at birth (daughter born ~2026-10-23) and meant
to run for 5–10+ years: newborn care first, later school, activities, health and memories.
Any family member can log in and look back at any moment of her life.

Why now: four caregivers (owner, wife, grandmother, nanny) feed the baby every ~3 hours and the only
record is someone's memory. People forget, or don't know what the last person did. Medicines, growth,
vaccines and doctor visits have the same problem.

Long-term: built from the owner's own experience, intended to become a product for other parents.
v1 is for this one family only, but must not paint the product into a corner.

## 2. Goals, non-goals, anti-goals

Goals (v1):
- Any caregiver can see at a glance: when she was last fed, by whom, how much, and when the next feed is due.
- Logging a feed/diaper takes a few seconds, one-handed, half-asleep, on a phone.
- Reminders for feeds and medicines reach caregivers' phones reliably, and escalate when nobody acts.
- One place for growth, vaccines, doctor visits, photos, supplies.
- Zero hosting cost.

Non-goals (v1): multi-family signup, multiple kids in the UI, AI features (cry analysis, photo AI),
native mobile apps, smart-speaker announcements, cross-app shopping lists, paid hosting.

Anti-goals (failures even if it "works"):
- Logging slower or fiddlier than shouting "did anyone feed her?" — people will stop using it.
- A reminder that silently doesn't fire.
- Losing her records (no backups).
- Her health records or photos reachable by anyone outside the family.

## 3. Users and access

- One family, one kid in v1. The owner is **Admin**.
- Admin invites people by email and gives each a role:
  - **Caregiver**: log, edit, view everything; can receive reminders.
  - **Viewer**: view only (extended family).
- Admin can change roles and remove people.
- Every caregiver has their own smartphone (Android, or iPhone on iOS 16.4+) and their own Google account or email.
  No shared-device mode is needed.
- Login: **Google sign-in** or **email magic link**. No passwords. An invite is accepted when someone
  signs in with the invited email address (my call).
- Data model: every record belongs to a `family` and a `kid` from day one, so multi-family and
  multi-kid later are features, not rewrites.
- Any caregiver can edit or delete any entry; each entry stores who created and last edited it, and when (my call).

## 4. v1 features

Defaults (my call, owner may override): timezone Asia/Kolkata, metric units (ml, kg, cm, °C),
12h/24h clock per user preference.

### 4.1 Home screen
- Big cards: "Last fed 2h 10m ago · by Mom · 60 ml bottle · next due ~4:30" and "Last diaper 1h 05m ago".
- One-tap quick-log buttons: Feed, Diaper, Sleep, Medicine given, Photo, Record cry.
- Today's list: medicines due, appointments, vaccines due.
- Red banner "reminders offline" if the app can't reach the server for 2+ minutes (my call).

### 4.2 Feeds
- Fields: type (breast left / breast right / breast both / expressed milk / formula), start time
  (defaults to now, editable), duration (minutes), quantity (ml, for bottle types), fed by, note.
- A start/stop timer for breastfeeding is allowed but optional (my call: builder may decide UI).
- Next feed due = last feed start + feed interval. Interval is a per-kid setting, default 3h, editable as she grows.

### 4.3 Diapers
- Fields: wet / dirty / both, time, changed by, note. Daily counts shown.
- Alert if no diaper logged in a configurable window, default 4h (my call — low wet-diaper count is an early warning doctors ask about).

### 4.4 Sleep
- Start/end, by whom. Start and stop from the home screen.

### 4.5 Medicines
- A medicine has: name, **dose as an amount plus a unit** (see "Structured doses" below), start date, end date (or ongoing), notes, and one of three schedule kinds:
  - **Fixed clock times**: e.g. 09:00 and 21:00 daily.
  - **Every N hours**: next due = last dose given + N hours (anchored like feeds). The first dose time is set when the medicine is added.
  - **As needed**: no schedule and no reminders. Log "given" and show "last given X ago". Optional minimum gap
    (e.g. 6h for paracetamol): the app warns before a dose is logged inside that gap (my call).
- Scheduled doses (fixed and interval) appear in Today's list; caregivers tick "given" (records who/when) or "skipped".
- Fixed and interval doses get reminders with escalation (4.10).

**Structured doses and partial dosing (owner decision, 2026-11-08; slice 2b).**
- The dose is a number (up to 2 decimals, e.g. 0.25) plus a unit from a fixed list: ml, drops, mg, mcg, g, IU, tablet, puff.
  It replaces the free-text dose box. Medicines saved before this keep working; the admin is asked to set a proper dose when
  editing them.
- When ticking a dose the caregiver chooses **full dose** (everything still remaining) or **partial dose** (an amount they type).
  One scheduled dose can therefore be given in pieces, for example 1 ml as 4 x 0.25 ml or 2 x 0.5 ml, by one or several people.
- A scheduled slot is complete when the pieces add up to the dose. Home shows progress ("0.50 of 1 ml given, 0.50 left").
  Skipping closes the slot and leaves the rest ungiven.
- **Safety:** the server refuses any piece that would take a slot above its prescribed amount (409, saying how much is left),
  so two phones tapping at once can never record a double dose.
- **Reminders continue until the slot is complete** (same escalation as before), and say how much is left.
- After a partial dose the caregiver can set a **temporary reminder** ("remind me in 5, 10, 15, 30 or 60 minutes") for the
  remaining amount. It goes to all caregivers with medicine reminders on, once, and is cancelled automatically if the slot is
  completed or skipped first (my call: to all caregivers, so the person who started can hand over).
- As-needed medicines: "Give now" also asks full or partial amount; there is no remaining-amount tracking for them.
- Interval medicines: the next due time counts from when the slot was completed.
- Photo of the medicine, label reading and a medicine registry move to slice 3 with the vaccine-schedule scan.

### 4.6 Vitals and growth (owner decision, 2026-11-09)
- **Measurements:** weight (kg), height/length (cm), head circumference (cm), temperature (°C), heart rate (beats per minute),
  breathing rate (breaths per minute), oxygen saturation SpO2 (%). Any subset can be recorded together in one entry.
- **Each reading has:** when it was measured (defaults to now, can be backdated), **where** (home, hospital, clinic or other,
  plus an optional place name such as the hospital), who entered it, who measured it if different (free text, e.g. "Nurse"),
  and a note. Place and time make hospital readings and home readings easy to tell apart (my call on the field names).
- **Entering:** one quick form with the chosen measurements; a bulk-history entry screen for adding many past readings in a
  table. Caregivers and the Admin add, edit and delete; Viewers read. Entries work offline like the others.
- **Graphs:**
  - weight, height and head circumference against the **WHO Child Growth Standards** percentile curves for girls, 0-5 years
    (age in months; WHO tables bundled in the repo);
  - temperature history with a fever line at 38.0 °C, shown as information and not as medical advice (my call);
  - heart rate, breathing rate and SpO2 as plain trend lines with no reference bands, since normal ranges depend on age and
    on whether the child is asleep or crying (my call);
  - a date range filter, and a way to show or hide readings by place.
- **Photo import (later, not in the first release):** photograph a page of the hospital record book, or a sheet written by a
  nurse; a vision model drafts the rows (date, measurement, value, place); the parent reviews and edits them and nothing is
  saved until confirmed; the photo stays attached to the entries as their source. It shares the storage and vision step with
  the vaccine-schedule scan and the medicine-label scan, and needs an Anthropic API key (the photo is sent to the API).
- No reminders for taking measurements in the first release (my call).

### 4.7 Vaccinations
- **Schedule templates (owner decision, 2026-11-07).** A small registry of templates, starting with **India IAP** and the
  **India government UIP**. The first time a parent opens Vaccines they pick one; the list is filled with due dates
  computed from the birth date. Templates are written from the official published schedules and checked against the
  owner's hospital sheet. A template is only a starting point.
- **The list is always editable** from the Vaccines screen / settings: add a vaccine (special or optional ones), change a
  date, skip or delete one, and mark it done with given date, place and notes. Fields: vaccine name, dose number, due date.
- **Scan the hospital schedule (owner decision, 2026-11-07).** Photo or PDF goes to a Claude vision model, which returns a
  draft list in a fixed structure (vaccine, dose, due age). The parent reviews and edits the draft; nothing is saved
  until they confirm. Needs an Anthropic API key. The photo is sent to the Anthropic API (the screen says so and suggests
  cropping out the child's name). Model choice is left to the builder (Sonnet-class by default).
- Reminders follow the schedule the family entered; the app states that the doctor's advice comes first.
- Attach a photo of the vaccine card per entry (my call).
- Reminders: the evening before and the morning of the due date (my call).

### 4.8 Doctor visits
- Upcoming appointments: date/time, doctor, place, reason. Reminders same as vaccines.
- After the visit: notes, prescriptions, attached files (images/PDFs).
- A prescription can create medicine schedules (4.5) — manual entry, no AI (my call: builder decides UI link).

### 4.9 Supplies stock
- Items (e.g. diapers, formula, wipes) with unit and current quantity.
- **Auto-decrement** from logs: each diaper log −1 diaper; each formula feed −its ml; wipes −N per diaper change (N configurable, default 3, my call).
- **Manual overrides**: add stock when bought, correct counts anytime.
- Low-stock threshold per item; reminder when crossed.

### 4.10 Reminders and escalation
- Delivery: **web push** from the installed PWA, to every caregiver who enabled notifications.
  Works on Android, and on iPhone (iOS 16.4+) once the site is added to the home screen.
  Native Reminders/Calendar import rejected (no Apple web API; subscribed calendars refresh too slowly).
- Escalation for feeds and medicine doses (timings my call, configurable):
  - At due time: notify all caregivers.
  - +15 min, still not logged: notify all again.
  - +30 min, still not logged: high-priority notification to Admin.
  - Logging the feed/dose stops the chain.
- Other reminders (diaper window, vaccines, appointments, low stock): single notification, no escalation (my call).
- Each user can turn reminder types on/off for themselves (my call).
- Tapping a notification opens the relevant log screen.

### 4.11 Photos
- Upload photos (camera or gallery) to her timeline. Date taken from EXIF, else upload time; editable.
- Caption optional. Thumbnails generated for timeline/grid views (my call).

### 4.12 Cry clips (data collection only)
- "Record cry" button records a short audio clip (max 60 s, my call).
- Afterwards, prompt: what soothed her? fed / changed / burped / held / temperature / other + note.
- Stored with time and current context. No analysis in v1 — this is the labeled dataset for phase 2.

### 4.13 Timeline
- One reverse-chronological feed of every entry type, filterable by type and date. This is the "logbook" view
  that grows with her life.

### 4.14 Offline
- Entries created without connection are saved on the phone, shown as "pending", and sync automatically when online,
  keeping their original timestamps. Client-generated IDs make sync safe to retry (my call).
- Edit conflicts: last write wins (my call).

## 5. Look and feel
- Blend of **calm, soft and baby-themed**: soft pastels, gentle rounded cards, friendly illustrations/icons,
  large tap targets.
- **Dim dark mode** that is easy on the eyes at 3am.
- All colors via theme tokens so per-baby themes (v3) are a swap, not a redesign.
- Mobile-first; desktop works too.
- **English only in v1, but i18n-ready**: every user-facing string, in screens and in server-written push
  notifications, goes through a translation layer from day one, so Hindi or another language can be added
  later without touching every screen. Language becomes a per-user setting then.

## 6. Technology (owner's choices)
- Backend: **Python, FastAPI**. Owner is a developer with 2 years building AI apps/agents.
- Frontend: **React**, modern UI, as a website. Installable **PWA**.
- Designer's proposed stack (owner reviewed, no objections):
  FastAPI, SQLAlchemy 2 + Alembic, PostgreSQL, APScheduler (reminder worker), pywebpush (VAPID);
  React + Vite + Tailwind + shadcn/ui + TanStack Query + vite-plugin-pwa + Recharts.
- Email for magic links: a free-tier provider (e.g. Resend) (my call).
- File storage behind an interface: local disk in v1, S3 later, same calling code.
- All secrets/URLs in `.env`; nothing hard-coded.

## 7. Hosting and environments
Constraint: **free**. Reminders need an always-on process.

**Stage order (owner, 2026-11-04): Mac first, hosted second.** The same Docker stack serves both. While it runs on the Mac,
reminders only fire while the Mac is awake and online, which the owner accepts until the hosted stage.

- **Production v1: Oracle Cloud Always Free VM** (ARM). Google Cloud e2-micro Always Free only if Oracle
  signup/capacity blocks the owner.
  - Docker Compose: Caddy (HTTPS + serves the built React app), API, reminder worker, Postgres.
  - Whole v1 stays inside Oracle's free tier ("full Oracle ecosystem"); no Supabase, Netlify or Cloudflare Pages.
  - Free subdomain (e.g. `kinnest.duckdns.org`) pointed at the VM; Caddy gets Let's Encrypt certificates.
    Frontend and API share this one origin. No domain purchase. In v2 the same subdomain can be repointed to EC2,
    so nobody reinstalls unless a bought domain replaces it.
  - Media on the VM's disk via the storage interface.
  - Nightly backup of database and media to Oracle Object Storage (free tier, S3-compatible) (my call).
  - Docker images must run on ARM64 (the owner's Mac is likely Apple Silicon, also ARM64).
  - Avoid idle reclaim: owner may upgrade the Oracle account to Pay-As-You-Go (Always Free stays free).
- **Development: owner's Mac**, same Docker Compose.
  - Chrome on `localhost` for push/PWA testing.
  - Android Emulator with `adb reverse tcp:8000 tcp:8000`.
  - Real phones via a temporary `cloudflared tunnel --url http://localhost:8000` HTTPS URL.
- **Later (v2+, at public release):** AWS EC2 + Caddy + S3 (paid), own domain. Moving domains means caregivers
  reinstall the PWA and re-enable notifications once — accepted.

## 8. Build order (slices within v1)
Each slice is built and tested before the next. Order of hosting, as the owner decided: run on the Mac first,
move to a hosted VM with a domain afterwards. Backups exist from the first day of real use (my call).
1. Foundation + daily care: project setup, Docker, auth (Google + magic link), family/roles/invites, i18n layer,
   feeds, diapers, home screen, PWA install, web push, feed reminders + escalation, offline queue,
   health banner, a real-use stack that runs on the owner's Mac behind an HTTPS tunnel, and database backups to a local folder.
   Hosting on an Oracle VM (DuckDNS + Caddy, backups to Object Storage) is the stage after slice 1 has been tested on the Mac.
2. Medicines (all three schedule kinds) with reminders and escalation; sleep.
3. Vitals and growth (manual entry with place, bulk history entry, graphs including WHO percentiles); vaccines (template registry + editable list); doctor visits with files. Then the shared scanning feature: photo import for vitals records, vaccine schedule scan-to-draft, medicine photos and label reading.
4. Photos, cry clips, timeline view, supplies stock.

## 9. Later (out of v1)
- Phase 2: cry-analysis AI (audio + log context, trained on tagged clips; per-kid fine-tuning);
  cross-app shopping tracker. (Vaccine-schedule scanning moved into slice 3.)
- Separate project: AI photo search, albums, photobooks, posters.
- v2: paid AWS hosting, own domain; Alexa / Google speaker reminder announcements.
- v3: multi-family signup, multiple kids, profile setup, per-baby themes; school-age entry types
  (class timings, subject scores, enrolled sessions).

## 10. Left to the builder
- Database schema details, API shape, folder layout, test strategy.
- Exact screens, navigation and component choices within the look-and-feel above.
- How the worker schedules and deduplicates reminder jobs.
- Thumbnail sizes, upload size limits, audio format.
- Email provider choice among free tiers.

