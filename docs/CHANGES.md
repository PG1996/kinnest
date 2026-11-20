# Changes after the UI overhaul plan (branch `ui-overhaul`)

One place to look up what changed after the 14 tasks of `docs/superpowers/plans/2026-11-09-kinnest-ui-overhaul.md`, so a new
session can continue or extend the work without the old conversations. It covers the small and medium changes made from owner
feedback between 2026-11-09 and 2026-11-15. Bigger pieces have their own design note, linked below. Find the commit for any
item with `git log --oneline main..ui-overhaul --grep '<words from the item>'`.

Last updated 2026-11-15.

## State of the branch
- `ui-overhaul` holds slice 3a's follow-ups, the UI overhaul and everything below. It branches from `main` at the
  "slice 3a checklist" commit.
- Checks at the last commit: frontend `npx vitest run` 681 passed, `npx tsc -b` and `npm run build` clean, `npx oxlint src` 34
  warnings (the baseline: do not add more); backend `.venv/bin/pytest -q` 478 passed.
- Nothing below has been checked on a real phone by the person who built it (no browser tool in those sessions). The owner
  tests on the dev stack. `docs/MANUAL_TEST_CHECKLIST.md` lists what to look at.
- One frontend test, `medicine-tiles`, fails when run late at night in India: it expects "Next 12:05 AM". It passes with
  `TZ=UTC`. The bug is in the test, not the app. It is not fixed yet.

## Database migrations added on this branch
The chain runs in this order. The API container runs `alembic upgrade head` on start.

| Revision | What |
|---|---|
| `76943e5ba803` | medicines: daily maximum and usual first dose time |
| `c3a91e5d7b20` | members and invites: relation to the baby |
| `d81f4a2c9e63` | vitals: link a reading to the doctor visit it was taken at |
| `e5b7c2a91f04` | feed timer kept on the server |
| `a7c3e9d41b58` | feed timer pauses, and breaks saved with a feed |
| `b3e8d1f2c4a6` | medicines: `ended_at` (an admin stops a medicine early) |
| `d4f2a7c9e1b3` | relation to the baby: aunt (downgrade maps aunt to relative) |

The real-use stack (`kinnest-prod`) has not been checked against this list. Take a backup and check
`docker exec kinnest-prod-api-1 alembic current` before rebuilding it from this branch.

## API changes
- `GET /api/timeline?from&to&kinds`: every entry kind, at most 31 days. Every `at` is UTC.
- Feed timer, shared by every phone: `POST/PATCH/DELETE /api/feed-timer`. It can be started, paused (breaks), stopped,
  resumed and discarded. Saving a feed with `timer_id` ends the timer. No feed reminders go out while a timer runs. A
  "feeding since" notification carries actions.
- `POST /api/sleep/past` logs a sleep afterwards. It is refused if it overlaps another sleep or lasts over 24 hours.
  `ended_at: null` saves a sleep that is still going. That is refused if another sleep is going on (409 "already asleep")
  or if it started more than 24 hours ago.
- `PATCH /api/sleep/{id}` with `ended_at: null` reopens a sleep.
- Medicines:
  - `max_per_day` and `usual_first_dose_time` on the medicine.
  - Doses are counted per calendar day: `given_today` and `day_ends_at`, which replace `given_last_24h`.
  - `POST /api/medicines/{id}/end` and `/resume` (admin only). The medicine JSON gains `created_at` and `ended_at`.
  - An admin can record, fix and move past doses to another slot.
- Vitals:
  - A reading can link to a visit, or create one for itself.
  - `GET /api/vitals` takes `limit` (the default is 500, the largest is 2000).
- Members and invites carry `relation`: mom, dad, grandparent, aunt, relative, nanny or other. A breast feed is always fed
  by mom.
- Reminders open the right medicine, and delivered reminders are cleared once the entry is logged.

## By area

### Home
- Quick log tiles: Feed, Diaper, Sleep (a moon to start, a sunrise to wake), Medicine and Vital. Starting or ending a sleep
  asks for confirmation first.
- **Last fed card**:
  - Pause, stop and start icons.
  - The start icon asks which side (left, right or both) before starting the timer.
  - A live "Feeding now" badge.
  - The card is not overdue while a feed is being timed.
- **Sleep card**: today's mini donut, plus a sun once the baby is awake. The Last diaper card shows who changed it and
  today's counts.
- **Medicines on Home**:
  - Tiles, one opened below the grid.
  - Last and next dose shown on the card.
  - "N/max given today", and "done today" once the maximum is reached.
  - A Give a dose now button that turns yellow when due; other actions sit under More. Undo is in the toast.
  - An SOS medicine stays on Home only while its last dose is under 48 hours old.
- **Latest vitals card**: compact tiles in the stat-card layout, with the change since the reading before and a fever flag.

### Feeds
- Wording: the "breast" types read **Mom's feed · L / R / Both**, and bottles are Expressed milk and Formula. Stored values
  are unchanged.
- The next feed is due one interval after the last feed **ends**.
- **Feeds day screen**, opened from the Last fed card: a feed clock, gap bars, and a day pager (see Shared UI).
- **Feed timer**:
  - It runs on the server, so every phone sees it.
  - Pause records breaks. After Stop, the breaks are asked once: None, 5, 10, 15, 20 or Other.
  - The feed sheet takes the timer's type **and start time** when it opens. After Discard timer, a typed duration is logged
    from when the feed began, not from the moment of saving.

### Diapers
- **Diaper day screen**:
  - Past diapers, with edit and delete.
  - Day tiles: wet and dirty against the usual, last wet, longest gap.
  - Day-by-day strips drawn in SVG, with 24, 12 and 6 hour zoom and tap for details.
- **Changed by**: choose who changed the diaper, in quick log, past entries and edit. It defaults to the person logging.
- **Woke up switch**: while a sleep runs, it can end the sleep at the diaper's time. Undo takes the wake back too.
- **Diaper sheet layout**: a gap under the Changed by chips, and Close lined up with the content (see Shared UI).

### Sleep
- **Sleep day screen**: a 24-hour donut, past sleeps, edit and delete. Past sleeps can be logged; overlaps are refused.
- **Still asleep checkbox** in the sleep form, for both adding and editing:
  - Ticked: Woke up is hidden and the sleep stays open.
  - Unticked: Woke up is required ("Add the wake-up time, or tick Still asleep.").
  - It is a themed tile, not the browser's checkbox, which stays white in dark mode. File: `components/SleepForm.tsx`.
- Editing keeps untouched times exact; an untouched time is not rounded to the minute.

### Medicines
- **Schedule and doses**:
  - Daily maximum and usual first dose time. Pieces of one dose count once toward the maximum.
  - A new day restarts at the usual first dose time.
  - A dose can be given at another time, counted for a chosen slot, or moved to another slot.
  - Off-slot doses move the schedule.
  - Missed doses show as one combined row with Skip all.
- **Partial doses**:
  - The rest of a dose turns due (yellow) once its reminder fires.
  - The reminder can be set for 1, 2, 4, 6 or 8 hours, or a custom time, counted from the last dose given.
- **Dose history** (tap a medicine tile):
  - Doses grouped by the slot they were for; pieces newest first.
  - Medicine details, edit, delete, and End now with a confirm. A medicine ended early can be resumed.
- **Medicines page**:
  - Active, SOS and Past sections, each headed by an uppercase label with a count.
  - SOS tiles open the same popup as the others.
- The medicine form opens in a popup. Tiles sit two per row.

### Vitals, vaccines and visits (Health)
- **Main vitals**: weight, height, temperature, heart rate and SpO2 are the main vitals everywhere. Head circumference and
  breathing rate sit behind **More vitals**.
- Temperatures show in °F by default.
- Metric stat cards show the change and trend; only the chosen metric's chart is drawn.
- A hospital or clinic reading can be linked to its visit, or create one.
- **History calendars** on Vitals, Vaccines and Visits (month and year view):
  - Tap a day to list only that day's entries. Swipe or the arrows change month. Jump buttons skip empty months.
  - An empty day offers to add an entry with that day filled in.
  - On Vitals, **Calendar** replaces List next to Charts. Dots show the place; days with a temperature of 38 °C or more are
    amber. Measurement and place chips filter the days. The list follows the month shown.
  - Vaccines sit on the day given, or on their due day until then. Status chips (given, due, overdue, skipped; done,
    upcoming, cancelled) hide entries.
  - Files: `components/HistoryCalendar.tsx`, `components/VitalsCalendar.tsx`, `lib/calendar.ts`, and the Vaccines and
    Visits tabs. Mocks: [Vitals](https://claude.ai/artifact/T7cbbH54o5tmK4tmWVPYfB),
    [Vaccines](https://claude.ai/artifact/Vy66GoRB7jxGnXRULwN3UU), [Visits](https://claude.ai/artifact/8kKNSmtJMuFdBcbXMhkEhE).

### Timeline
- Tapping a row edits or deletes the entry (feed, diaper, sleep, dose or vitals). **Add past entry** is on the page.
- **One day at a time**, with the day strip and swipe, plus a **day chart in lanes** above the list:
  - Bars for things with a length, shapes for moments.
  - Ranges by tap, quick ranges, hold-then-drag and handles. Zoom and Whole day.
  - Totals per kind replace the filter chips.
  - Split view on a phone held sideways.
  - Design note: `docs/superpowers/specs/2026-11-12-timeline-day-chart-design.md`. Mock:
    https://claude.ai/artifact/MDQSRnen3D3SD15nLYQTdn.
- The endless multi-day list and "Show earlier day" are gone. Each fetch includes the night before, so a sleep that ran past
  midnight shows from midnight.

### Family
- Each member has a relation to the baby, including Aunt, with a step to set who is mom and dad. A breast feed is always fed
  by mom.
- Member rows stack the name, email and controls.

### Shared UI
- **One date and time picker everywhere**: Today / Yesterday / Other day, Now, and hour, minute and AM/PM wheels. Variants
  are date only, time only, and planned (future allowed). Files: `components/ui/datetime.tsx`; test helpers `pickDate`,
  `pickTime`, `pickDateTime` and `clearPicker`.
- **Day pager** (`components/DayPager.tsx` and `DayStrip.tsx`) on Feeds, Diapers, Sleep and the Timeline:
  - A three-week strip with dots on days that have entries.
  - Swipe between days, with the neighbouring days prefetched.
  - Elements marked `data-no-swipe` opt out of the swipe.
- **Lists**: every list of past entries is newest first. What is still to come stays soonest first.
- **Badge** has solid and outline variants, a status dot and a pulse.
- Sheets stay plain: a per-card tint was tried and reverted.
- **`ChipGroup`** has no margin class of its own. Tailwind 4's `space-y` is a zero-specificity `:where` rule, so any `m-*`
  there removes the gap under the chips.
- **Bottom sheet**: Close is pulled into the padding (`-mr-4`) so the word lines up with the content's right edge.
- `index.css` adds the `land` variant (phone held sideways, short screen) and the `cal-in-l` and `cal-in-r` slide keyframes.

### Deployment (branch `deploy-aws`)
- `deploy/docker-compose.prod.yml` is image-only. The Mac builds with a second file:
  `docker-compose -f deploy/docker-compose.prod.yml -f deploy/docker-compose.build.yml --env-file .env up -d --build`.
- The worker is the compose profile `worker`; set `COMPOSE_PROFILES=worker` in the Mac `.env` (the VM uses `worker,ngrok`).
  Caddy now publishes only `127.0.0.1:${CADDY_HTTP_PORT:-8080}`.
- New: `deploy/deploy.sh`, `deploy/ec2-setup.sh`, `deploy/systemd/kinnest-backup.{service,timer}`, `.github/workflows/{ci,deploy}.yml`,
  `deploy/AWS_SETUP.md`. `backup.sh` reads `BACKUP_*` from `.env` and `BACKUP_ENDPOINT` is optional (plain AWS S3).

### Dev setup
- vite preview accepts Tailscale Funnel and ngrok hosts.
- **Dev DB snapshots** with `deploy/backup-dev.sh` and the launchd template `deploy/com.kinnest.dev-backup.plist`. See
  HANDOFF.

## Gotchas found on the way
- **Tailwind 4**: `space-y-*` and `space-x-*` lose to any margin utility on the child. Use `gap` on a flex or grid
  container, or leave margins off children.
- **Dark mode**: the theme never sets `color-scheme: dark`, so native checkboxes, radios and selects stay light. Draw
  controls from tokens (see the Still asleep tile and `ui/switch.tsx`).
- **Tests**:
  - jsdom has no layout. The day chart falls back to 340px wide, and swipes are tested with `fireEvent.pointerDown` and
    `pointerUp`.
  - For date-dependent screens use `vi.useFakeTimers({ toFake: ['Date'] })` with `vi.setSystemTime(...)`; timers keep
    running.
  - `scale.test.tsx` forbids `font-extrabold` and `text-2xl` or larger in any `.tsx` file.
  - Test text comes from `en.json` keys, never literals.
- **Prettier**: the options in use are `--no-semi --single-quote --print-width 160`. Some older files are not formatted that
  way; do not reformat files you are not changing.
- **Docker**: reading or exec-ing into the `kinnest-prod` containers is blocked for the agent; the owner runs those
  commands.

## Open items
- Run the phone checks in `docs/MANUAL_TEST_CHECKLIST.md`, in its "After the UI overhaul" section.
- Before rebuilding the real-use stack from this branch:
  - take a backup;
  - expect the migrations above to run;
  - the Still asleep option needs the new backend: an older API answers 422 to a past sleep with no end.
- The dev worker container was not restarted after the medicine and reminder changes; restart it if reminders look stale.
- Fix the time-zone-dependent `medicine-tiles` test.
- Ideas raised but not built:
  - attachments and photo scanning wait for the slice 3b plan;
  - slide to confirm on Give full;
  - a template badge on Vaccines (needs a backend field);
  - editing Time while a feed timer runs is ignored on save, because the timer's start wins.
