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

## Vitals and growth (slice 3a)
- [ ] Settings: set the birth date. The box under it says charts and the vaccine schedule need it.
- [ ] **At home**: Health > Vitals > **Add vitals**, pick Weight and Temperature, enter 3.42 and 36.8, place Home. The list shows "3.42 kg · 36.8 °C", Home, and "entered by <you>". Home's **Latest vitals** card shows it with the date and place.
- [ ] **At the hospital**: add Weight, Height and Head with place Hospital, place name "City Hospital", measured by "Nurse", backdated to yesterday. The list shows the hospital name and "measured by Nurse"; the Home card now shows each value with its own date and place.
- [ ] **Fahrenheit refused**: type 98.6 for temperature. The form shows "Temperature must be 30 to 45 °C" and says it looks like Fahrenheit (about 37.0 °C). Nothing is saved.
- [ ] Other refusals: 62 kg, 0 kg, an entry with nothing picked, a time later today. Each shows a message and saves nothing.
- [ ] **Edit** an entry (change the weight, drop the temperature) and **Delete** it (asks a second time). It disappears from the list, the charts and the Home card.
- [ ] Place filter and date range on the list work.
- [ ] **Bulk history**: **Add history**, fill three rows from the hospital record book (or paste rows copied from a spreadsheet: date, time, place, weight, height, head, temperature, heart rate, breathing rate, SpO2). Put 98.6 in one row: the row is marked and **Save all** saves nothing. Fix it and save: all rows appear. Tap **Save all** again quickly: nothing is duplicated ("0 new, 3 already there").
- [ ] A row dated before the birth date comes back marked by the server and nothing is saved.
- [ ] **Charts**: Vitals > Charts shows weight, length/height and head against five WHO lines (3rd, 15th, 50th, 85th, 97th) with the WHO source and date under each. Dots are coloured by place, tapping one shows date, value, percentile and place. Turning off **Hospital** hides hospital readings on every chart.
- [ ] Temperature chart shows a dashed 38.0 °C line labelled as information; heart rate, breathing rate and SpO2 are plain lines.
- [ ] Clear the birth date: each growth chart says it needs the birth date and links to Settings (no crash). Set it again afterwards.
- [ ] **Offline vital**: in airplane mode add a weight. It shows "Waiting to sync" at the top of the list and syncs once online, once only.

## Vaccines (slice 3a)
- [ ] Health > Vaccines with no schedule lists **India IAP (2025)** and **India UIP (government)** with the number of vaccines, the source link and its date. Open each source link.
- [ ] **Check the template against the hospital sheet** before relying on it (names, doses, due ages). Note any difference for the owner.
- [ ] Pick one: the list fills with due dates from the birth date (6 weeks after birth, 9 months on the same day of the month, and so on), grouped into Overdue, Due in the next 30 days, Later and Done. The note says the doctor's advice comes first.
- [ ] Pick a template again from a second phone at the same time: only one schedule is created; the other phone says a schedule already exists.
- [ ] **Mark given** (date defaults to today; a date after today is refused), with place and notes. It moves to Done and shows the date and place.
- [ ] **Skip**, **Edit** (change a due date or name), **Delete** (asks twice), and **Add vaccine** for a special one.
- [ ] **Add missing from a template** adds only vaccines that are not in the list (a deleted one comes back) and never changes given ones.
- [ ] The Viewer sees the list only, no buttons.

## Doctor visits (slice 3a)
- [ ] Health > Visits > **Add visit** with date and time, doctor, place and reason. It is under Upcoming, soonest first. Home's **Coming up** card lists visits and vaccines in the next 7 days and overdue vaccines; tapping one opens the right tab.
- [ ] **Mark done** with notes and prescription notes; it moves to Past with them. On a done visit the Admin sees **Add medicine**, which opens Medicines with the add form open.
- [ ] **Cancel visit** and **Delete** (asks twice). A past visit can be added and marked done afterwards.
- [ ] The Viewer sees the lists only.

## Vaccine and visit reminders (slice 3a)
- [ ] A vaccine due tomorrow: at 18:00 the caregivers and the Admin get "vaccines due tomorrow" listing that day's vaccines (one message, not one per vaccine); at 08:00 on the day, "vaccines due today". Each arrives once.
- [ ] A visit tomorrow at 11:00: "doctor visit tomorrow" at 18:00 today and "doctor visit at 11:00" at 10:00 tomorrow. Tapping the notification opens Health > Visits (or Vaccines).
- [ ] Mark the vaccine given (or the visit cancelled) before its reminder time: no reminder arrives.
- [ ] Settings: turn off **Vaccine reminders** on one phone: that phone gets no vaccine reminders, the others still do. Same for **Doctor visit reminders**. The Viewer never gets them.
- [ ] Let the Mac sleep through an 18:00 reminder: when it wakes more than 3 hours later, the old reminder is not sent.

## Real-use stack on the Mac
- [ ] `curl localhost:8080/api/health` returns ok through Caddy, and the tunnel address opens the app.
- [ ] Reboot the Mac: OrbStack and the four containers come back, and reminders still fire.
- [ ] `deploy/backup.sh` writes a dump. A practice restore into `kinnest_restored` shows the same row counts.
