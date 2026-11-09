# Kinnest UI Overhaul Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the whole frontend to the approved canvas design ("Kinnest" design artifact, 2026-11-08/09): a calm pastel design
system, a floating glass navigation with five areas (Home, Timeline, Health, Patterns, Family), richer Home cards, a full-screen
feed logger, a slide-to-confirm dose screen, chart-led Vitals, a status-gated "Snap a record" flow, a Timeline and a Patterns
screen, with one small read-only backend endpoint (`GET /api/timeline`) to feed the last two.

**Architecture:** Design tokens in `frontend/src/theme/tokens.css` drive Tailwind v4 theme colours; a small set of hand-written
primitives in `frontend/src/components/ui/` (no new UI library) replaces ad-hoc classes. Pages keep their data hooks, offline
queue and i18n; only presentation, navigation and three new screens change. Animation is CSS plus one `useCountUp` hook and is
off under `prefers-reduced-motion`. Snap-a-record is built against the slice 3b API contract and stays hidden until
`GET /api/scans/status` answers `enabled: true`.

**Tech Stack:** unchanged (React 19, Vite 8, Tailwind 4, TanStack Query 5, react-router 7, Recharts 3, lucide-react, i18next,
vitest + Testing Library; FastAPI, SQLAlchemy 2, pytest) plus `@fontsource-variable/nunito` (self-hosted font).

**Spec:** `docs/superpowers/specs/2026-10-31-kinnest-v1-design.md` (sections 4.1–4.10, 4.13, 5) and the design canvas
https://claude.ai/artifact/2nWUKePRfZGnGKCKehwPns (screens: Home, Home 3am dim, Log a feed, Give a dose, Vaccines, Timeline,
Vitals charts, Snap a record, Add a vital, Patterns). Scan API contract: `docs/superpowers/plans/2026-11-09-kinnest-slice-3b.md`
tasks 3–4. Conventions: `docs/HANDOFF.md`.

## Owner decisions (2026-11-09)

- Navigation: **Home · Timeline · Health · Patterns · Family**. Medicines becomes the 4th Health tab
  (`Vitals | Vaccines | Visits | Medicines`); Members and Settings become the two tabs of Family. Old URLs redirect.
- Timeline and Patterns read a **new backend endpoint** `GET /api/timeline`.
- Snap a record: **built now, hidden** unless the scan status endpoint says it is enabled.
- Home quick log shows **only built actions**: Feed, Diaper, Sleep, Medicine, Vital. Photo and Record cry wait for slice 4.

## Global Constraints

- Branch `ui-overhaul`, cut from `main` at `4b220bb`. Commits: the owner is the only author, **no Claude co-author or
  "Generated with" line** (HANDOFF owner preference).
- Every user-facing string goes through `t()` with keys in `frontend/src/i18n/en.json`; the existing hard-coded-English test
  must keep passing.
- Roles unchanged: Viewer sees no write control anywhere (quick log, sheets, slide to confirm, add reading, snap, invite).
- Offline queue, pending badges, `networkMode: 'always'` and client-generated ids keep working exactly as before.
- Touch targets at least 44×44 px; text contrast at least 4.5:1 (3:1 for 24 px+), checked in both themes.
- Under `prefers-reduced-motion: reduce` nothing animates (count-ups show the final value, the gauge and heatmap appear at once).
- Real controls only: `<button>`, `<a>`, `<input>` with `<label>`; icon-only buttons have `aria-label`; sheets are dialogs with
  focus moved in, Escape to close and focus returned.
- No fonts or scripts from a CDN (the app is an offline PWA and health data is private): Nunito ships from
  `@fontsource-variable/nunito`. No new runtime dependency besides that font.
- EasyUI (easyui.site) is **visual inspiration only**: its licence is unverified, so no code is copied from it.
- Mobile-first at 360–430 px; desktop keeps the centred `max-w-xl` column and works with a mouse and keyboard.
- Health text stays as the spec says: "doctor's advice comes first" on vaccines, the fever line note on temperature.

### Design tokens (exact values; light / dark)

| Token | Light | Dark | Use |
|---|---|---|---|
| `--app` | `#F6F4FB` | `#14131B` | page ground |
| `--surface` | `#FFFFFF` | `#1F1D29` | cards, sheets |
| `--surface-2` | `#ECE9F6` | `#2A2836` | segmented tracks, steppers |
| `--ink` | `#2A2838` | `#E4E1EE` | text |
| `--muted` | `#5E5B70` | `#A9A5BC` | secondary text |
| `--line` | `#E7E3F1` | `#2A2836` | borders |
| `--primary` | `#5546B8` | `#B7ACF5` | buttons, active state |
| `--primary-ink` | `#FFFFFF` | `#14131B` | text on primary |
| `--primary-soft` | `#ECE6FB` | `#2C2742` | active nav pill, med tint |
| `--feed-bg` / `--feed-ink` / `--feed` | `#FFE7DA` / `#8A3F1C` / `#D9774A` | `#2B211F` / `#F0B596` / `#E0A88C` | feed card, gauge |
| `--diaper-bg` / `--diaper-ink` / `--diaper` | `#DDF3EA` / `#1F6B4D` / `#2F8A64` | `#1C2722` / `#8FD1B4` / `#6FBF9C` | diaper card |
| `--sleep-bg` / `--sleep-ink` / `--sleep` | `#DDEBFB` / `#24477E` / `#4A78C2` | `#1C2230` / `#A3C1EE` / `#7FA3DB` | sleep card |
| `--med-bg` / `--med-ink` / `--med` | `#ECE6FB` / `#4E3A94` / `#7B5CC9` | `#262036` / `#C9BDF5` / `#A592E6` | medicine |
| `--warn-bg` / `--warn-ink` | `#FFF1D6` / `#7A4A00` | `#33280F` / `#F2C878` | "check" flags |
| `--danger` | `#B3261E` | `#F2A39D` | offline banner, fever line, overdue |
| `--radius` | `1.5rem` cards, `1.125rem` tiles, `999px` pills | same | |

Heatmap ramp (sequential, one hue): light `#F1EFF8 #D9D2F5 #A99BE8 #7A68D6 #45369E`, dark `#24222F #3A3360 #5C4FA0 #8B7DDB #C2B8F7`.
Caregiver avatar tints rotate in member order: feed, sleep, diaper, med (`-bg` fill, `-ink` text).

## Review Focus

- **Viewer accounts** opening every new screen must see read-only content with no enabled write control; covered by a
  `viewer sees no write controls` test in Tasks 5, 6, 8, 9, 10 and 13.
- **Notification and bookmark links** `/?log=feed|diaper|medicine|vaccine|visit`, `/medicines`, `/members`, `/settings`,
  `/health?tab=…` must still open the right screen after the navigation change; Task 3 test `old links still land`.
- **No data yet** (new family: no feeds, no vitals, no birth date, an empty day, fewer than 7 days of history) must show calm
  empty states, never a crash or `NaN`; tests `empty family home`, `empty day`, `patterns with two days of data` in Tasks 5, 11, 12.
- **Offline while logging** from the new feed screen and the slide-to-confirm dose must queue and show "pending", as today;
  tests `feed screen queues offline` (Task 6) and `slide to confirm queues offline` (Task 7).
- **Day boundaries and range** for Timeline/Patterns: a day is local midnight to midnight in the device timezone; a range over
  31 days or `to` before `from` is refused with 422; tests in Task 4 and `timeline day edges` in Task 11.

---

### Task 1: Design tokens, font and theme modes

**Files:**
- Modify: `frontend/src/theme/tokens.css`, `frontend/src/index.css`, `frontend/src/main.tsx`, `frontend/src/components/ThemeToggle.tsx`, `frontend/package.json`
- Create: `frontend/src/lib/theme.ts`, `frontend/src/lib/motion.ts`, `frontend/src/lib/theme.test.ts`

**Interfaces:**
- Produces: Tailwind colours `app surface surface-2 ink muted line primary primary-ink primary-soft feed-bg feed-ink feed diaper-bg diaper-ink diaper sleep-bg sleep-ink sleep med-bg med-ink med warn-bg warn-ink danger` and radii `rounded-card rounded-tile`.
- `type ThemeMode = 'light' | 'dark' | 'auto' | 'night'` (`night` = dark from 22:00 to 06:00 local, light otherwise); `resolveTheme(mode: ThemeMode, now: Date, prefersDark: boolean): 'light' | 'dark'`; `useThemeMode(): [ThemeMode, (m: ThemeMode) => void]` (stored in `localStorage` key `kinnest.theme`, wrapped in try/catch, sets `data-theme` on `<html>`, re-evaluates each minute for `night`).
- `prefersReducedMotion(): boolean`, `useCountUp(target: number, ms = 900): number` (ease-out cubic; returns `target` at once under reduced motion or when `window.matchMedia` is missing, so jsdom tests see final values).

- [ ] **Step 1: Write failing tests** in `theme.test.ts`: `night is dark at 23:30 and 05:59 and light at 06:00 and 21:59`; `auto follows prefersDark`; `useCountUp returns the target immediately under reduced motion`.
- [ ] **Step 2: Run** `cd frontend && npx vitest run src/lib/theme.test.ts`. Expected: FAIL (module missing).
- [ ] **Step 3: Implement** tokens exactly as the Global Constraints table (light under `:root`, dark under `:root[data-theme='dark']` and the `prefers-color-scheme` fallback), register them in `@theme inline`, import `@fontsource-variable/nunito` in `main.tsx` and set `font-family: 'Nunito Variable', ui-rounded, system-ui, sans-serif`; `ThemeToggle` becomes a 4-option segmented control (Light, Dark, Auto, Night dim) using `useThemeMode`.
- [ ] **Step 4: Run** `npx vitest run && npx tsc -b`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: design tokens, Nunito and night dim theme`.

### Task 2: UI primitives

**Files:**
- Modify: `frontend/src/components/ui/button.tsx`, `frontend/src/components/ui/card.tsx`, `frontend/src/components/Sheet.tsx`, `frontend/src/components/Toast.tsx`
- Create: `frontend/src/components/ui/chip.tsx`, `segmented.tsx`, `stepper.tsx`, `badge.tsx`, `avatar.tsx`, `sparkline.tsx`, `gauge.tsx`, `slide-confirm.tsx`, `empty.tsx`, `frontend/src/components/ui/ui.test.tsx`

**Interfaces:**
- `Button` variants `primary | soft | outline | ghost | danger`, sizes `md (48px) | lg (56px)`; `IconButton({label, children, ...})` 44 px round with `aria-label={label}`.
- `Card({tone?: 'plain'|'feed'|'diaper'|'sleep'|'med'|'warn', interactive?: boolean})`; tone sets `-bg` background and `-ink` eyebrow colour.
- `Chip({pressed, onClick, children})` renders `<button aria-pressed>`; `ChipGroup({label, children})` renders `<fieldset><legend>`.
- `Segmented<T extends string>({label, value, options: {value: T, label: string}[], onChange})` renders `role="radiogroup"` with `role="radio"` buttons and a sliding white pill (CSS `transition: left 280ms cubic-bezier(.2,.9,.3,1.15)`).
- `Stepper({value, step, min, max, unit, label, onChange, format?})`: −/+ 56 px buttons with `aria-label`s, disabled at the bounds.
- `PlaceBadge({place: PlaceKind})`, `Badge({tone, children})`; `AvatarStack({names: string[], max = 4})` with an `aria-label` listing names.
- `Sparkline({values: number[], label: string, tone})` (SVG, `role="img"`, area plus 2 px line, last point dot); `HalfGauge({fraction: 0..1, label: string, tone, children})` (SVG semicircle r 52, stroke 12, round caps).
- `SlideToConfirm({label, onConfirm, disabled})`: pointer drag of a 48 px thumb, confirms past 85% of the track, springs back otherwise; the thumb is a button that also confirms on Enter or Space; announces "Done" in a `role="status"` region.
- `Sheet` gains `variant: 'sheet' | 'full'` (full-screen page with back button for the feed and dose flows), a drag handle, focus moved to the title on open, Escape closes, focus returns to the opener.
- `Toast` restyled dark pill above the nav, keeps its `{message, action?}` API; `EmptyState({icon, title, body, action?})`.

- [ ] **Step 1: Write failing tests** in `ui.test.tsx`: `segmented is a radiogroup and arrow keys move selection`; `stepper stops at max and min`; `slide to confirm confirms on Enter and not on a short drag` (fire `pointerdown/move/up` with `clientX` 0→40 on a 300 px track, mock `getBoundingClientRect`); `sheet closes on Escape and returns focus`; `gauge label is exposed as img name`.
- [ ] **Step 2: Run** `npx vitest run src/components/ui/ui.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement** the primitives with Tailwind classes on the Task 1 tokens; restyle `Button`, `Card`, `Sheet`, `Toast` without changing their existing props (existing tests must pass unchanged).
- [ ] **Step 4: Run** `npx vitest run && npx tsc -b`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: UI primitives for the new design`.

### Task 3: App shell, glass navigation and routes

**Files:**
- Modify: `frontend/src/App.tsx`, `frontend/src/components/Layout.tsx`, `frontend/src/components/OfflineBanner.tsx`, `frontend/src/pages/Health.tsx`, `frontend/src/i18n/en.json`, `frontend/src/pages/pages.test.tsx`
- Create: `frontend/src/components/GlassNav.tsx`, `frontend/src/components/PageHeader.tsx`, `frontend/src/pages/Family.tsx`, `frontend/src/pages/Timeline.tsx` and `frontend/src/pages/Patterns.tsx` (placeholders filled in Tasks 11–12), `frontend/src/components/shell.test.tsx`

**Interfaces:**
- Routes: `/` Home, `/timeline`, `/health?tab=vitals|vaccines|visits|medicines`, `/patterns`, `/family?tab=members|settings`. Redirects that keep the query string: `/medicines` → `/health?tab=medicines`, `/members` → `/family?tab=members`, `/settings` → `/family?tab=settings`.
- `GlassNav`: fixed, `inset-x-4 bottom-4`, 64 px, `bg-surface/72 backdrop-blur-[18px]`, five links; the active one is a `primary-soft` pill with icon plus label and `aria-current="page"`, the others icon-only with `aria-label`. Respects `env(safe-area-inset-bottom)`. Main content gets bottom padding so nothing hides behind it.
- `PageHeader({title, subtitle?, actions?})` with an `<h1>`; the app-wide header with Sign out is removed (Sign out moves to Family › Settings).
- `Health` tabs come from `TABS = ['vitals','vaccines','visits','medicines']`, rendered with `Segmented`; the Medicines tab mounts the existing `MedicinesPage` content.

- [ ] **Step 1: Write failing tests** in `shell.test.tsx`: `nav has five links and marks the current one`; `old links still land` (`/medicines` shows the Medicines tab, `/members` shows Members, `/settings` shows Settings, `/?log=vaccine` opens Vaccines, `/?log=medicine` stays on Home); `sign out is in Family settings`.
- [ ] **Step 2: Run** `npx vitest run src/components/shell.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement** the shell; update existing tests that click the old nav labels to the new structure (behaviour assertions unchanged).
- [ ] **Step 4: Run** `npx vitest run && npx tsc -b`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: glass navigation with Timeline, Patterns and Family`.

### Task 4: Backend `GET /api/timeline`

**Files:**
- Create: `backend/app/api/timeline.py`, `backend/tests/test_timeline.py`
- Modify: `backend/app/main.py`

**Interfaces:**
- Consumes: `feed_json`, `diaper_json`, `sleep_json`, `dose_json`, `vital_json`, `vaccination_json`, `visit_json` and `user_names` (existing).
- `GET /api/timeline?from=<aware>&to=<aware>&kinds=feed,diaper,sleep,dose,vital,vaccine,visit` (any member, Viewer included). 422 when `to < from`, the range exceeds 31 days, or a kind is unknown. Returns `{"items": [{"kind", "id", "at", "data"}]}` sorted by `at` descending, where `at` is: feed `started_at`, diaper `at`, sleep `started_at`, dose `given_at` (given and skipped; `data` adds `medicine_name`, `dose_unit`), vital `measured_at`, vaccine `given_on` at 09:00 in the family timezone (given only), visit `scheduled_at` (status `done` or `upcoming`, not cancelled). Soft-deleted rows and other kids/families never appear.

- [ ] **Step 1: Write failing tests**: `timeline merges kinds newest first`; `kinds filter limits the result`; `range over 31 days is 422`; `to before from is 422`; `deleted and other family rows are excluded`; `viewer can read`; `signed out is 401`; `skipped doses appear with status skipped`.
- [ ] **Step 2: Run** `cd backend && .venv/bin/pytest tests/test_timeline.py -q` (dev db up). Expected: FAIL (404 route).
- [ ] **Step 3: Implement** the router with one query per kind bounded by the range, then merge in Python.
- [ ] **Step 4: Run** `.venv/bin/pytest -q`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: timeline endpoint for every entry kind`.

### Task 5: Home

**Files:**
- Modify: `frontend/src/pages/Home.tsx`, `frontend/src/components/LastFeedCard.tsx`, `LastDiaperCard.tsx`, `SleepCard.tsx`, `Today.tsx`, `UpcomingCard.tsx`, `LatestVitalsCard.tsx`, `MedicinesToday.tsx`, `PushPrompt.tsx`, `frontend/src/api/hooks.ts`, `frontend/src/pages/Home.test.tsx`
- Create: `frontend/src/components/HomeHeader.tsx`, `frontend/src/components/QuickLog.tsx`

**Interfaces:**
- Consumes: `useCountUp`, `HalfGauge`, `Sparkline`, `AvatarStack`, `Card`, `Toast` (Tasks 1–2); `useTimeline({from, to, kinds})` (Task 11 defines it; add it here first in `hooks.ts` if Task 11 is not done, same signature).
- `HomeHeader`: kid name, "N days old · <weekday d mon>" from `birth_date` (omit the age when unknown), `AvatarStack` of family members, notifications button opening Family › Settings.
- Feed hero (`LastFeedCard`): eyebrow "Last fed", count-up "2h 10m" + "ago · by <name>", detail line, `HalfGauge` with fraction `(now − last start) / interval`, centre "<time> to next feed"; pill "Next due ~<clock>". Overdue state (due ≤ now): tone stays feed but the eyebrow reads "Feed overdue", headline "Due <n> min ago", and a full-width "Log feed now" button; in the dark theme this is the canvas "3am" card.
- Diaper card: last diaper ago, by, kind, today's counts, `Sparkline` of wet-or-both per day over the last 7 days (from `useTimeline` kinds `diaper`), "7-day avg" badge; tapping opens `/patterns`.
- `QuickLog`: 3-column grid of tiles Feed, Diaper, Sleep, Medicine, Vital (Vital opens `/health?tab=vitals&add=1`); hidden for Viewers.
- Today list: medicine slots (with partial progress text), vaccines due, visits, each a row with tinted icon tile.
- Toast: "Feed logged · Undo" and "Diaper logged · Undo" keep today's undo behaviour.

- [ ] **Step 1: Write failing tests**: `feed hero shows ago, gauge label and next due`; `overdue feed shows log feed now`; `diaper sparkline has a seven-day label`; `quick log shows five tiles`; `viewer sees no write controls`; `empty family home` (no feeds, no diapers, no birth date: friendly empty cards, no "NaN").
- [ ] **Step 2: Run** `npx vitest run src/pages/Home.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement**; keep the `?log=` handling and offline/pending/rejected cards (restyled with `Card tone`).
- [ ] **Step 4: Run** `npx vitest run && npx tsc -b`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: Home with gauge, sparkline and quick log`.

### Task 6: Log a feed screen

**Files:**
- Modify: `frontend/src/components/FeedSheet.tsx`, its tests in `frontend/src/pages/Home.test.tsx` or a new `frontend/src/components/FeedSheet.test.tsx`
- Modify: `frontend/src/components/DiaperSheet.tsx` (restyle to three large tiles: Wet, Dirty, Both)

**Interfaces:**
- `FeedSheet` keeps its props (`last, saving, failed, onSave, onClose`) and renders `Sheet variant="full"`: type chips (5 feed types), Started (now, editable time), bottle types show a `Stepper` (10 ml steps, 0–300, default last bottle amount or 60) and breast types show duration minutes plus an optional start/stop timer, "Fed by" chips from family members (default: me), note input, footer "Next feed due ~<clock> (every <n>h)" and "Save feed".

- [ ] **Step 1: Write failing tests**: `bottle type shows amount stepper and breast type shows duration`; `fed by defaults to me and can change`; `save sends the same FeedInput shape as before`; `feed screen queues offline` (offline mock: toast says queued and Home shows pending).
- [ ] **Step 2: Run** the test file. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npx vitest run && npx tsc -b`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: full-screen feed logger`.

### Task 7: Give a dose with slide to confirm

**Files:**
- Modify: `frontend/src/components/GiveDoseSheet.tsx`, `GiveAsNeededSheet.tsx`, `NudgeSheet.tsx`, related tests in `frontend/src/hooks/slice2b.test.tsx` / `frontend/src/pages/Medicines.test.tsx`

**Interfaces:**
- Consumes: `Segmented`, `Stepper`, `Chip`, `SlideToConfirm` (Task 2).
- Layout: medicine card (`tone="med"`) with name, slot pill, schedule line, progress "<given> of <dose> <unit> given · <left> left" with bar and the list of pieces (amount · who · time); `Segmented` Full · <left> / Partial; Partial shows the `Stepper` (step 0.25 for ml, 1 for drops/tablet/puff; max = remaining) and the nudge chips 5/10/15/30/60 min; footer: "Skip" outline button and `SlideToConfirm` "Slide to give <amount> <unit>". The 409 "only X left" message shows inline above the slider.

- [ ] **Step 1: Write failing tests**: `slide to confirm posts the partial amount`; `stepper cannot exceed what is left`; `409 shows how much is left and keeps the sheet open`; `slide to confirm queues offline`; `viewer sees no write controls`.
- [ ] **Step 2: Run** the affected test files. Expected: FAIL.
- [ ] **Step 3: Implement**; the existing button-based tests are updated to use Enter on the slider thumb.
- [ ] **Step 4: Run** `npx vitest run && npx tsc -b`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: dose screen with slide to confirm`.

### Task 8: Health hub, Medicines, Vaccines and Visits

**Files:**
- Modify: `frontend/src/pages/Medicines.tsx`, `VaccinesTab.tsx`, `VisitsTab.tsx`, `frontend/src/components/MedicineForm.tsx`, `VaccineForm.tsx`, `VisitForm.tsx`, `TemplatePicker.tsx`, their tests

**Interfaces:**
- Health header: `PageHeader` "Health" plus the four-tab `Segmented`.
- Vaccines: template badge ("Template · India IAP", from birth date), "Next up · <age> · <date>" group with "Mark done" per row, overdue group (`warn` tone), done group with check icons, footer note "Dates follow the schedule you entered. Your doctor's advice comes first." The scan entry point is not added here (slice 3b task 5 owns it).
- Visits: upcoming cards with date block, doctor, place, reason; done visits collapsed by month.
- Medicines: list cards with schedule summary and today's progress; admin-only Add/Edit.

- [ ] **Step 1: Write failing tests**: `health has four tabs and medicines is one of them`; `vaccines group next up, overdue and done`; `viewer sees no write controls` (each tab).
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement** (restyle; no data-flow change).
- [ ] **Step 4: Run** `npx vitest run && npx tsc -b`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: Health hub with medicines, vaccines and visits restyled`.

### Task 9: Vitals with charts and the add-reading screen

**Files:**
- Modify: `frontend/src/pages/VitalsTab.tsx`, `VitalsCharts.tsx`, `frontend/src/components/GrowthChart.tsx`, `TrendChart.tsx`, `VitalForm.tsx`, `VitalList.tsx`, `frontend/src/lib/placeColors.ts`, tests `Vitals.test.tsx`, `VitalsCharts.test.tsx`

**Interfaces:**
- Vitals tab opens on charts: metric tabs Weight · Height · Head · Temp (each shows its latest value), a readout (value, date, place, "+x since birth" for growth), the chart and "Recent readings" with `PlaceBadge`. "List" stays available as a second view (`Segmented` Charts / List) with the existing filters.
- Growth chart (Recharts): WHO 3rd–97th percentile band `fill: var(--surface-2)`, median dashed `var(--muted)`, the child's line 2 px `var(--primary)` with 8 px dots, tooltip on hover/tap; Temperature: dashed `var(--danger)` reference line at 38.0 °C labelled with a warning icon and "Fever 38.0 °C", plus the note "Fever line at 38.0 °C · call your doctor for a fever under 3 months." Legends as in the canvas; one y axis only.
- Add reading (`VitalForm` in `Sheet variant="full"`): vital chips (Weight, Length, Head, Temperature, Heart rate, SpO₂, Breathing), one large value field with its unit, place chips (Hospital, Clinic, Home, Other) and place name when not Home, taken by, when, note; the multi-value form and Bulk entry stay reachable from "More readings at once".

- [ ] **Step 1: Write failing tests**: `metric tabs show latest values and switch the chart`; `temperature chart has the fever line label`; `add reading saves one vital with the chosen place`; `bulk entry is still reachable`; `viewer sees no write controls`.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npx vitest run && npx tsc -b`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: chart-led vitals and add-reading screen`.

### Task 10: Snap a record (hidden until slice 3b)

**Files:**
- Create: `frontend/src/api/scan.ts`, `frontend/src/components/ScanNotice.tsx`, `frontend/src/components/PhotoPicker.tsx`, `frontend/src/components/ScanReview.tsx`, `frontend/src/components/scan.test.tsx`
- Modify: `frontend/src/pages/VitalsTab.tsx`, `frontend/src/components/BulkVitals.tsx` (accept `initialRows` and `flagged` cells), `frontend/src/i18n/en.json`

**Interfaces (from slice 3b tasks 3–5, unchanged names so 3b only wires the backend):**
- `useScanStatus(): {enabled: boolean, remaining_today: number}` — `GET /api/scans/status`; any error (404 today) means `enabled: false`, no retry, no error shown.
- `useUploadFile()` — `POST /api/files` multipart → `{id, url, thumb_url, content_type}`; `useScan()` — `POST /api/scans {kind: 'vitals', file_id}` → `{scan_id, draft: {rows: DraftRow[], warnings: string[]}}`.
- `type DraftRow = {measured_at: string | null, values: Partial<VitalValues>, unsure: (keyof VitalValues)[]}`.
- Flow: "Snap a record" button (Vitals header and the add-reading screen), rendered only when `enabled`; `ScanNotice` (must tap "Continue"; text: "The photo is sent to the Anthropic API to read it. You can crop out her name first. Nothing is saved until you confirm."), `Segmented` One reading / Bulk history, `PhotoPicker` (camera `capture` and file, image or PDF), progress state, then `ScanReview`: photo thumbnail, place chips applied to every row, rows with include checkboxes and "Check" badges on unsure cells, warnings list, "Save N readings" through the existing `useBulkVitals`. Errors keep the photo and offer Retry or "Enter by hand". 429 shows "Daily scan limit reached".

- [ ] **Step 1: Write failing tests** with `mockApi`: `snap hidden when status is 404`; `snap hidden when enabled is false`; `notice must be accepted before the picker`; `draft rows appear with check badges`; `unticked rows are not saved and save posts bulk`; `scan failure keeps the photo and offers retry`; `daily limit message`; `viewer sees no write controls`.
- [ ] **Step 2: Run** `npx vitest run src/components/scan.test.tsx`. Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npx vitest run && npx tsc -b`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: snap a record flow behind scan status`.

### Task 11: Timeline

**Files:**
- Modify: `frontend/src/pages/Timeline.tsx`, `frontend/src/api/hooks.ts`, `frontend/src/i18n/en.json`
- Create: `frontend/src/lib/timeline.ts`, `frontend/src/pages/Timeline.test.tsx`

**Interfaces:**
- `type TimelineKind = 'feed'|'diaper'|'sleep'|'dose'|'vital'|'vaccine'|'visit'`; `type TimelineItem = {kind: TimelineKind, id: string, at: string, data: Record<string, unknown>, pending?: boolean}`.
- `useTimeline({from: Date, to: Date, kinds?: TimelineKind[]})` → `TimelineItem[]` (query key `['timeline', from, to, kinds]`, invalidated by every log mutation in `hooks/log.ts`).
- `dayRange(day: Date): {from: Date, to: Date}` (local midnight to 23:59:59.999); `describe(item, t): {title: string, meta: string, tone}` in `lib/timeline.ts`.
- Screen: `PageHeader` "Timeline" with a date button (native date input), filter chips All · Feeds · Diapers · Sleep · Medicine · Vitals · Health (kinds filter), sections per day ("Today · Sat 8 Nov"), rows with tinted icon tile, title, meta (who, "pending sync" for queued items merged from the offline queue), time; "Show earlier day" loads the previous day; tapping a feed/diaper/sleep row opens its existing edit sheet.

- [ ] **Step 1: Write failing tests**: `rows render newest first with titles`; `filter chips limit kinds`; `queued entries show pending sync`; `empty day`; `timeline day edges` (an entry at 23:59 belongs to that day, 00:00 to the next); `show earlier day fetches the previous range`.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npx vitest run && npx tsc -b`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: timeline of every entry`.

### Task 12: Patterns

**Files:**
- Modify: `frontend/src/pages/Patterns.tsx`
- Create: `frontend/src/lib/patterns.ts`, `frontend/src/lib/patterns.test.ts`, `frontend/src/components/Heatmap.tsx`, `frontend/src/pages/Patterns.test.tsx`

**Interfaces:**
- Consumes: `useTimeline` (7 local days ending today, kinds feed, sleep, diaper), `Segmented`, `Sparkline`, `useCountUp`.
- `feedGrid(items, days: Date[]): number[][]` (7×12 counts per 2-hour block by feed start); `sleepGrid(items, days, now): number[][]` (minutes asleep per block, sessions split across blocks and days, an open session counted up to `now`); `dailyStats(items, days, now): {feedsPerDay, sleepMinutesPerDay, diapersPerDay, series: {feeds: number[], sleep: number[], diapers: number[]}, longestSleep: {minutes, start, end} | null}`; `level(value, kind): 0..4` (feeds: 0, 1, 2+ → 0..2; sleep: minutes/30 rounded, capped 4).
- Screen: header "Patterns · Last 7 days", `Segmented` Feeds / Sleep, heatmap (rows = days, 12 two-hour columns, hour labels 12 AM/6 AM/12 PM/6 PM, future blocks dashed, each cell a button with `aria-label` "<day>, <range>, <value>" that fills the readout on tap/hover/focus, legend Fewer→More with the ramp), three stat cards (count-up value, sparkline, change vs the previous 7 days), longest-sleep card. Data shorter than 7 days shows what exists with a "Patterns get clearer after a week" note.

- [ ] **Step 1: Write failing tests** in `patterns.test.ts`: `feeds land in the right 2-hour block`; `sleep across midnight is split between days`; `open sleep counts up to now`; `longest sleep found`; `patterns with two days of data` (averages use days with data); and in `Patterns.test.tsx`: `tapping a cell shows its details`, `switching to sleep changes the legend`.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npx vitest run && npx tsc -b`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: patterns heatmap and weekly stats`.

### Task 13: Family (members and settings) and Login

**Files:**
- Modify: `frontend/src/pages/Family.tsx`, `Members.tsx`, `Settings.tsx`, `Login.tsx`, `frontend/src/components/PushPrompt.tsx`, their tests

**Interfaces:**
- Family: `PageHeader` "Family", `Segmented` Members / Settings. Members: avatar (rotating tint), name, role badge, admin-only role change, remove (two-step confirm) and invite form. Settings: baby (name, birth date, feed interval, diaper alert window; admin only), reminders (per-kind switches as `role="switch"` buttons), appearance (`ThemeToggle` from Task 1), notifications (`PushPrompt`), Sign out at the bottom.
- Login: centred card on `--app`, app mark, "Continue with Google" and email magic-link form, same endpoints.

- [ ] **Step 1: Write failing tests**: `family has members and settings tabs`; `reminder switches toggle prefs`; `only the admin can change roles and baby settings`; `viewer sees no write controls`.
- [ ] **Step 2: Run.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run** `npx vitest run && npx tsc -b`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: Family area with members and settings`.

### Task 14: Final pass and real-browser check

**Files:**
- Modify: whatever the checks below expose; `docs/MANUAL_TEST_CHECKLIST.md` (add a "UI overhaul" section)

- [ ] **Step 1: Run** `cd frontend && npx vitest run && npx tsc -b && npx oxlint && npx vite build`. Expected: all pass; note the PWA precache size in the ledger (must stay under 3 MB; the charts chunk stays lazy).
- [ ] **Step 2: Run** the backend suite `cd backend && .venv/bin/pytest -q`. Expected: PASS.
- [ ] **Step 3: Dev-stack check** (never the real-use stack): bring up `kinnest-dev`, mint a session as in HANDOFF, open `http://localhost:5173` in a 390×844 viewport, light and dark (Night dim), reduced motion on and off; walk Home → log feed → undo, give a partial dose by sliding, Vitals charts, Timeline, Patterns, Family. Record any defect, fix it test-first.
- [ ] **Step 4: Add** the "UI overhaul" checklist section (phone install, safe-area with the floating nav, 3am dim, slide to confirm one-handed) to `docs/MANUAL_TEST_CHECKLIST.md`.
- [ ] **Step 5: Commit** `chore: UI overhaul final pass and checklist`.
- [ ] **Step 6: Review** per HANDOFF: review package `main..ui-overhaul`, one fresh opus reviewer with this plan's Review Focus, grade findings, fix Critical/Important test-first, record rulings in `.superpowers/sdd/2026-11-09-kinnest-ui-overhaul/progress.md`.

## Notes for slice 3b

Slice 3b task 4–5 frontend pieces (`PhotoPicker`, `ScanNotice`, `useScanStatus`, `useUploadFile`, `useScan`, vitals scan flow)
are built here with the same names. When 3b runs, its frontend steps shrink to: attach the uploaded photo as `role: "source"`
after saving, add the vaccine-schedule and medicine-label scan entry points, and drop the "hidden on 404" fallback once the
status endpoint always exists.
