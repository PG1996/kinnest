# Testing Kinnest on a phone

Push notifications, installing the app and the offline queue need **HTTPS** (or `localhost`). Plain
`http://192.168.x.x:8000` loads the page but silently disables those features, so use one of the routes below.

## Daily development loop (desktop Chrome)
```bash
export PATH=/Applications/OrbStack.app/Contents/MacOS/xbin:$PATH      # only if docker is not on your PATH
cp .env.example .env                                                   # first time only
docker-compose -f deploy/docker-compose.yml up -d --build
```
Open http://localhost:5173. With no `SMTP_URL`, sign-in links appear in the API log:
`docker-compose -f deploy/docker-compose.yml logs api | grep magic/verify`.
The service worker (install, push, offline) is off in `vite dev`. To test those, build and preview:
```bash
cd frontend && npm run build && npm run preview -- --host      # http://localhost:4173, proxies /api to :8000
```
Chrome treats `localhost` as secure, so push and install work there. Generate push keys once with
`cd backend && .venv/bin/python scripts/gen_vapid.py` and add them to `.env`.

## Real phone over HTTPS (Cloudflare quick tunnel, free, no account)
```bash
brew install cloudflared
cloudflared tunnel --url http://localhost:4173     # with `npm run preview` running; prints https://<random>.trycloudflare.com
```
Set `PUBLIC_BASE_URL` in `.env` to that URL and restart the API (`docker-compose -f deploy/docker-compose.yml up -d api`)
so sign-in links point at it. The URL changes on every tunnel restart, and an installed app belongs to one URL, so
reinstall after it changes. For a stable address see `docs/RUNNING_ON_MAC.md`.

- **iPhone (iOS 16.4+):** Safari receives web push only from an installed app. Open the URL in Safari, Share → **Add to
  Home Screen**, open Kinnest from the icon, sign in, tap **Turn on reminders**.
- **Android:** open the URL in Chrome, menu → **Install app**, then **Turn on reminders**.
- **Android emulator:** `adb reverse tcp:4173 tcp:4173`, then open `http://localhost:4173` in the emulator's Chrome.
- **iOS simulator:** not reliable for web push. Use a real iPhone.

## Making reminders fire quickly
Settings → "Feed every (minutes)" accepts small values such as 2. Log a feed and wait: level 0 arrives at due time, the repeat
15 minutes later, and the Admin-only alert at 30 minutes.
