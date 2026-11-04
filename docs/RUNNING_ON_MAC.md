# Running Kinnest for real on your Mac

This is the first step: your Mac is the server. Hosting on a VM with a proper domain comes later (see
`deploy/ORACLE_SETUP.md`); the same Docker stack moves there unchanged.

**The trade-off to know about:** reminders are sent by a process on this Mac. If the Mac is asleep, shut down or offline at
3am, nobody is reminded. Keep it awake and plugged in while the family relies on it.

## 1. Start the stack

```bash
export PATH=/Applications/OrbStack.app/Contents/MacOS/xbin:$PATH      # only if docker is not on your PATH
cp .env.example .env                                                   # first time only, then edit it
```
Set in `.env`:
- `OWNER_EMAIL` to your email. The first sign-in with this address becomes the Admin.
- `SESSION_SECRET` to the output of `openssl rand -hex 32`.
- `POSTGRES_PASSWORD` and the matching password inside `DATABASE_URL`.
- `PUBLIC_HOST=:80` and `CADDY_HTTP_PORT=8080` (already the defaults in `.env.example`).
- `VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY` from `cd backend && .venv/bin/python scripts/gen_vapid.py`. Never change them
  later, or every phone has to turn reminders on again.
- `PUBLIC_BASE_URL` to the HTTPS address phones will use (step 3).
- `SMTP_URL` for sign-in emails (for example `smtps://you%40gmail.com:APP_PASSWORD@smtp.gmail.com:465` with a Gmail app
  password). Without it, sign-in links are only printed in the API log.
- `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` for Google sign-in (optional; email links work without them). The redirect
  URI to register is `<PUBLIC_BASE_URL>/api/auth/google/callback`.

```bash
docker-compose -p kinnest-prod -f deploy/docker-compose.prod.yml --env-file .env up -d --build
curl localhost:8080/api/health        # {"status":"ok"}
```
Open http://localhost:8080 on the Mac and sign in. Containers restart themselves after a reboot once OrbStack is running
(OrbStack → Settings → start at login).

## 2. Keep the Mac awake

- Plugged in: `sudo pmset -c sleep 0` stops system sleep on power (the display may still sleep).
- Laptop: leave the lid open, or use an external display. Closing the lid sleeps it regardless.
- Quick option while testing: run `caffeinate -s` in a terminal.

## 3. Let phones reach it over HTTPS

Push notifications and installing the app need HTTPS. The Mac has no public address, so use a tunnel that dials out:

- **Trying it out (free, no account):** `cloudflared tunnel --url http://localhost:8080` prints a temporary
  `https://<random>.trycloudflare.com`. It changes every time the tunnel restarts, and each phone's installed app and
  notification permission belong to one address, so this suits testing, not daily family use.
- **Daily family use needs a stable address.** Free options to compare: Tailscale Funnel (stable `*.ts.net` address,
  Tailscale account on the Mac only), ngrok's free static domain, or a Cloudflare named tunnel (needs a domain you own).
  Pick one before the family installs the app. Whichever you choose, put the final address in `PUBLIC_BASE_URL`, then
  `docker-compose -p kinnest-prod -f deploy/docker-compose.prod.yml --env-file .env up -d`.

## 4. Back up the database

```bash
COMPOSE="docker-compose -p kinnest-prod -f deploy/docker-compose.prod.yml --env-file .env" \
BACKUP_TARGET=local:$HOME/kinnest-backups deploy/backup.sh
```
Keeps 14 days of dumps in `~/kinnest-backups`. Schedule it daily with `crontab -e`, for example
`15 2 * * * cd ~/code/cursor/kinnest && COMPOSE="docker-compose -p kinnest-prod -f deploy/docker-compose.prod.yml --env-file .env" BACKUP_TARGET=local:$HOME/kinnest-backups PATH=/Applications/OrbStack.app/Contents/MacOS/xbin:$PATH deploy/backup.sh`
(cron may need Full Disk Access in macOS settings). A backup that lives only on this Mac dies with the Mac, so also copy
that folder somewhere else, such as iCloud Drive or an external disk.

Practice a restore once: `COMPOSE="..." deploy/restore.sh ~/kinnest-backups/<file>.sql.gz` restores into a new database
`kinnest_restored` and refuses to touch one that already has data.

## 5. Updating

Pull the new code, rerun the `up -d --build` command above. Database migrations run when the API starts.
