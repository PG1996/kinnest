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

## Real-use stack on the Mac
- [ ] `curl localhost:8080/api/health` returns ok through Caddy, and the tunnel address opens the app.
- [ ] Reboot the Mac: OrbStack and the four containers come back, and reminders still fire.
- [ ] `deploy/backup.sh` writes a dump. A practice restore into `kinnest_restored` shows the same row counts.
