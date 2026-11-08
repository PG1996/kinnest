# Manual test checklist (slice 1)

Run on the dev stack through a tunnel first, then on the real-use stack (`docs/RUNNING_ON_MAC.md`) with the family's
phones before they rely on it. Use at least one iPhone and one Android phone, and three accounts: Admin (you), Caregiver, Viewer.

## Install and sign-in
- [ ] Open the address on each phone and install it (iPhone: Add to Home Screen). It opens full screen with the Kinnest icon.
- [ ] Admin signs in with Google or an email link. Home loads.
- [ ] Admin invites a Caregiver and a Viewer from Family. Each receives an email and signs in with that address.
- [ ] An email that was never invited cannot sign in (no link arrives; Google shows an error) and sees no data.
- [ ] Inviting `Nanny@Gmail.com` still works when signing in as `nanny@gmail.com`.
- [ ] Admin removes the Caregiver. On that phone the next action returns to the login page.
- [ ] The Viewer sees Home and Family but no Feed or Diaper buttons.

## Logging
- [ ] Feed takes two taps from opening the app (Feed, Save). Home shows "Last fed … ago", who, how much, and next due.
- [ ] Breast types hide the ml field; formula and expressed milk show it. The sheet opens prefilled from the last feed.
- [ ] Diaper, then Wet saves at once. Undo within 5 seconds removes it. Today's counts update.
- [ ] Two caregivers log within 2 minutes: the second sees "<name> also logged this a moment ago".
- [ ] A time more than 5 minutes in the future is refused. Backdating to last night works.
- [ ] Admin can change baby name and feed interval in Settings. A Caregiver sees them read-only.
- [ ] Light and dim dark mode are readable at night. Buttons are easy to hit one-handed.

## Offline
- [ ] Airplane mode: log a feed. The toast says it is saved on the phone and Home shows it with "1 waiting to sync".
- [ ] Airplane mode off: within about 30 seconds it syncs, with exactly one server row and the original time.
- [ ] Log offline, force-quit and reopen the app, then reconnect: the entry still syncs.
- [ ] Stop the API for 3 minutes (`docker-compose stop api`): the red "can't reach the server" banner appears, then clears after restart.

## Reminders (needs VAPID keys in `.env`)
- [ ] Each phone taps Turn on reminders and allows notifications. An iPhone Safari tab shows the Add to Home Screen steps instead.
- [ ] Set the feed interval to 2 minutes, log a feed, wait. Admin and Caregiver get "feed due"; the Viewer does not.
- [ ] 15 minutes later with no feed logged: "still no feed logged" to both.
- [ ] 30 minutes later: only the Admin gets the overdue alert, high priority.
- [ ] Logging a feed at any point stops the sequence. Tapping a notification opens the feed sheet.
- [ ] Turn "Feed reminders" off for one user: only that user stops receiving them.
- [ ] `docker-compose restart worker` mid-sequence: no repeated notification, and the next one still arrives.
- [ ] Revoke one phone's notification permission: the worker keeps running and the others still get theirs.
- [ ] Set the diaper alert to 5 minutes and log nothing: exactly one "diaper check" arrives.

## Medicines (slice 2)
Use at least two phones logged in as different people (Admin and Caregiver), plus the Viewer.
- [ ] Medicines screen: only the Admin sees Add, Edit and Delete. The Caregiver and Viewer see the list read-only. Delete asks a second time.
- [ ] Add a **fixed-time** medicine with two times (set the first about 3 minutes from now). Today's slots appear on Home on every phone.
- [ ] At the due time the Admin and Caregiver phones get "<medicine> due" (the Viewer does not). Tapping the notification opens Home at the medicines card.
- [ ] Tap **Given** on one phone: the slot shows "Given by <name>" on the other phone within about 30 seconds and the reminder sequence stops.
- [ ] Leave one dose alone: a second "still not given" arrives after 15 minutes, and after 30 minutes only the Admin gets the high-priority one.
- [ ] **Skip** a dose: the slot says "Skipped by <name>" and reminders stop. **Undo** reopens the slot.
- [ ] Both phones tap Given for the same dose at about the same moment: one dose is recorded, and the second person sees "<name> already gave this dose".
- [ ] Add an **every-N-hours** medicine (first dose a few minutes away, N = 1 for testing). Give the first dose late: the next due time is that moment plus N hours, not the original schedule.
- [ ] Add an **as-needed** medicine with a 6-hour minimum gap. **Give now** twice in a row: the second time asks "Give anyway?" and still saves when confirmed. It never sends reminders.
- [ ] Set an end date of yesterday on a medicine: it moves to "Past medicines" and stops reminding. Delete a medicine: it disappears but old doses are kept (check via the history route if curious).
- [ ] Settings: turn **Medicine reminders** off for one person. That person gets feed reminders but no medicine ones.
- [ ] Airplane mode: tap Given. It shows "Waiting to sync", then syncs on reconnect with the original time.
- [ ] Add a medicine just after one of its times has passed: you are **not** reminded about the earlier time. If the Mac slept through a dose, you get no burst of old reminders when it wakes (the dose stays listed as overdue).

## Structured doses and partial dosing (slice 2b)
Use two phones as different people (Admin and Caregiver) so you can test who gave what.
- [ ] **Add a medicine** with a dose amount and a unit (try 1 ml, a fixed time a few minutes away). The unit list has ml, drops, mg, mcg, g, IU, tablet, puff, and an amount of 0, nothing, or more than 2 decimals is refused.
- [ ] A medicine saved **before** this change shows "Set a proper dose for this medicine" for the Admin, and editing it requires an amount and unit. Until then, ticking it still works with **Given** and **Skip**.
- [ ] **Give full dose**: the slot completes, shows who gave it, and the reminders stop.
- [ ] **Pieces by two phones**: on phone A tap **Partial dose** and give 0.25; on phone B give 0.25, then 0.5. Both phones show "0.25 ml of 1 ml given, 0.75 ml left" and so on, then the slot completes at exactly 1 ml.
- [ ] **Too much is refused**: with 0.25 ml left, try to give 0.5 (typed) and see the amount refused; if a stale screen still offers the full dose, the phone says "Only 0.25 ml left" and refreshes.
- [ ] **Double tap on two phones**: tap **Give full dose** on both phones at the same moment. Only one is recorded; the other says the dose was already given in full. Check the history shows one dose only.
- [ ] **Reminders keep coming** while a dose is only partly given, and say how much is left ("0.75 ml left"). They stop when the dose is complete.
- [ ] **Reminder for the rest**: after a partial dose pick "15 min". Both phones show "Reminder at <time>", and at that time every caregiver gets "still to give", once. Cancel one and confirm it never arrives.
- [ ] Complete the dose **before** the temporary reminder time: no reminder arrives for it.
- [ ] **Skip after a partial dose**: the slot says skipped and keeps the piece already given; no more can be added.
- [ ] **Undo a piece**: the freed amount can be given again; undoing the piece that completed the slot makes it "partial" again and the reminders resume.
- [ ] **As needed**: **Give full dose** records the whole dose; **Partial dose** records the typed amount; a dose inside the minimum gap still asks "Give anyway?".
- [ ] **Offline**: in airplane mode give a partial piece. It shows "<amount> waiting to sync", the offered amount drops by what is queued, and it syncs on reconnect. A piece that was refused meanwhile appears in the "couldn't be saved" notice, not silently.
- [ ] Check that **1 ml given as 4 x 0.25 ml** and **2 x 0.5 ml** both complete the slot with no rounding oddities.

## Sleep (slice 2)
- [ ] Tap **Sleep**: Home shows "Asleep since <time>" and the button becomes **Wake up**. Another phone shows it within about 30 seconds.
- [ ] Both phones tap Sleep at once: one session exists, and the other phone is told who already started it.
- [ ] **Wake up** shows "Slept <length>, woke <time> ago". Starting again afterwards works.
- [ ] Airplane mode: Sleep then Wake up. Both sync in order on reconnect and the session has the right length.
- [ ] The Viewer sees the sleep card without buttons.

## Real-use stack on the Mac
- [ ] `curl localhost:8080/api/health` returns ok through Caddy, and the tunnel address opens the app.
- [ ] Reboot the Mac: OrbStack and the four containers come back, and reminders still fire.
- [ ] `deploy/backup.sh` writes a dump. A practice restore into `kinnest_restored` shows the same row counts.
