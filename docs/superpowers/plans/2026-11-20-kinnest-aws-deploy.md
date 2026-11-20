# Kinnest: move from the Mac to AWS (draft 2)

## Context
Kinnest has had a week of family beta on the owner's Mac:
- The **dev stack** (`kinnest-dev`, Postgres on 5433) holds the real data.
- `vite preview` on port 4173 serves the app.
- `ngrok http --url=matchless-expenses-stock.ngrok-free.dev 4173` is the family's address.

Reminders stop whenever the Mac sleeps. Goal: run the same Docker stack on AWS so the Mac is out of the path, without the
family reinstalling the PWA or losing data.

Earlier options (spec §7; conversations 2026-10-30 and 2026-11-09): Oracle Always Free (the spec's v1), AWS EC2 + Caddy + S3
(the spec's v2, later called "the original plan"), Hetzner/DigitalOcean, Neon/RDS, and a Cloudflare Pages split.

## Decisions (owner, 2026-11-15/16)
- **AWS Mumbai (`ap-south-1`)**:
  - One `t4g.small` (ARM64, 2 GB) on Ubuntu 24.04 with 20 GB gp3.
  - Default (shared) tenancy, CPU credits `standard`.
  - Postgres stays in Docker on the VM.
- **Keep the ngrok address.** The ngrok agent moves to the VM. The origin stays the same, so these all keep working and
  **nobody reinstalls**:
  - installed PWAs;
  - push subscriptions (same VAPID keys);
  - sign-in cookies (same `SESSION_SECRET`);
  - the Google redirect URI.
- **Migrate the dev database** (`kinnest-dev`, at migration head `d4f2a7c9e1b3` from `ui-overhaul`).
- **The address moves only after EC2 has run perfectly** in a soak on a rehearsal copy (phase 3).
- **Deploys: GitHub Actions → S3 release bundle → SSM**:
  - CI tests the commit, builds ARM64 images to GHCR, uploads a checksummed bundle of `deploy/` to S3, then tells the VM
    through SSM to verify and run it.
  - **No Git and no GitHub deploy key on the VM.** The VM has **no inbound ports**: ngrok, SSM and S3 all dial out.
- Backups: nightly `pg_dump` to a private, versioned S3 bucket.

**Cost.** Third-party prices; verify in the AWS Pricing Calculator.

| Item | Per month |
|---|---|
| `t4g.small` | about $8.2 |
| Public IPv4 | $3.65 |
| EBS (20 GB gp3) | about $2 |
| S3 | cents |
| Total, once credits end | about $14 |

- New accounts (after 2025-07-15) get $100–200 of Free-plan credits for up to 6 months. **Upgrade to the Paid plan before the
  Free plan ends, or AWS closes the account.** The credits carry over.
- GitHub Actions: about 600–800 of the 2,000 free private-repo minutes a month.
- Confirm on docs.github.com/billing that GHCR storage and bandwidth are free before building.

## Open items (do not block building)
- **Cloudflare named tunnel.** One is running on the Mac (`cloudflared tunnel run --token-file ...`). If it has a domain, that
  domain avoids ngrok's free limits, at the cost of one reinstall. The ingress is a single compose service, so either works.
- **ngrok free limits.** About 1 GB/month outbound, possibly 20k requests/month, and one agent online per address. Check
  last week's Usage page on the ngrok dashboard.

## Phase 0: Code readiness (branch `deploy-aws` from `main`)
**Prerequisite:** the owner merges `ui-overhaul` (98 commits) and `fix/public-url-trailing-slash` into `main`. Deployed code
must be at or past the dev DB's migration head.

1. **Compose files**
   - `deploy/docker-compose.prod.yml` becomes **image-only**:
     - `api` and `worker` use `${KINNEST_API_IMAGE:-kinnest-api:local}`; `caddy` uses `${KINNEST_WEB_IMAGE:-kinnest-web:local}`.
     - On the VM these are set to **digest-pinned** refs (`ghcr.io/pg1996/kinnest-api@sha256:...`).
   - The `build:` sections move to a new `deploy/docker-compose.build.yml` override, used only on the Mac:
     `-f docker-compose.prod.yml -f docker-compose.build.yml`. The release bundle holds only `deploy/`, so the VM never sees a
     build context.
   - **Profiles** control which optional services run, through `COMPOSE_PROFILES` in `.env`:
     - `worker` under profile `worker`;
     - a new `ngrok` service under profile `ngrok`: `ngrok/ngrok:<pinned 3.x>`, command `http --url=${NGROK_DOMAIN} caddy:80`,
       env `NGROK_AUTHTOKEN`.
     - The soak starts with both off; the cutover turns both on.
   - Caddy keeps `PUBLIC_HOST=:80` (plain HTTP; ngrok adds HTTPS). It publishes only `127.0.0.1:8080:80`.
   - `name: kinnest-prod` stays fixed, so volumes (`dbdata`) survive every release directory.
   - Log rotation on every service (`json-file`, `max-size: 10m`, `max-file: 3`).
2. **`deploy/Dockerfile.caddy`**: the web stage is `FROM --platform=$BUILDPLATFORM node:22-slim`, so the frontend builds
   natively and only the Caddy layer is ARM64.
3. **`deploy/backup.sh`**:
   - `BACKUP_ENDPOINT` becomes optional (`${BACKUP_ENDPOINT:+--endpoint-url ...}`) for plain AWS S3 with the instance role.
   - It reads only its own `BACKUP_*` keys from `.env`, so other values never have to be shell-safe.
4. **`deploy/deploy.sh <sha> <api-digest> <web-digest>`** (new). It runs as root from the extracted release
   `/opt/kinnest/releases/<sha>/deploy/`:
   1. Link `/opt/kinnest/.env` into the release dir. Secrets live only there, never in a bundle.
   2. Write `releases/<sha>/digests.env`. Running `deploy.sh` with no arguments reuses it, which is how a hand redeploy or
      rollback works.
   3. Install `deploy/systemd/*` into `/etc/systemd/system/`, `daemon-reload`, and re-enable the timer.
   4. `docker compose pull` (digest-pinned), then run `backup.sh`. Abort if the backup fails.
   5. `docker compose up -d --remove-orphans`.
   6. Wait for `127.0.0.1:8080/api/health`, then print `alembic current`.
   7. On success, point the `/opt/kinnest/current` symlink at this release and record it in `.last-good`.
   8. On failure, re-run the `.last-good` release's `deploy.sh` and exit non-zero. If a migration caused the failure, restore
      the backup taken in step 4; migrations only go forward.
   9. Keep the newest 5 releases and prune unused images.
5. **`deploy/systemd/kinnest-backup.{service,timer}`**:
   - Runs `/opt/kinnest/current/deploy/backup.sh` daily at `20:45 UTC` (02:15 IST), with `Persistent=true`.
   - Logs go to journald.
6. **`deploy/ec2-setup.sh`** (new, idempotent, run once by the owner). It installs:
   - a 2 GB swap file and `unattended-upgrades`;
   - Docker Engine with the compose plugin;
   - AWS CLI v2 (official aarch64 installer; Ubuntu 24.04 has no `awscli` in apt);
   - `/opt/kinnest/{releases}`, owned by root, mode 700.
7. **`.github/workflows/ci.yml`** (every push and PR, also called from deploy). Three parallel jobs, about 5 minutes:
   - **Backend**: `pytest -q` with a `postgres:16` service on `5433`.
   - **Frontend**: `npm ci`, `vitest run`, `tsc -b`, `npm run build`, and `oxlint src` (fails above the 34-warning baseline).
   - **Deploy files**: `bash -n` and `shellcheck` on `deploy/*.sh`, plus `docker compose ... config` with dummy env values
     for both profile sets.
   - The UTC runner keeps the known `medicine-tiles` night-time test failure from showing up.
8. **`.github/workflows/deploy.yml`** (push to `main`, plus `workflow_dispatch` with an optional `ref`):
   1. `ci` (reusable workflow) must pass.
   2. `docker/build-push-action` builds `linux/arm64` `kinnest-api` and `kinnest-web`, pushes them to GHCR tagged `<sha>`,
      and **captures each digest** from the action's output.
   3. `tar czf <sha>.tar.gz deploy/`, take its `sha256`, and upload it to `s3://<bucket>/releases/<sha>.tar.gz`.
   4. `aws ssm send-command` (`AWS-RunShellScript`) sends a short bash script. It:
      - downloads the bundle;
      - **checks the sha256 against the value in the command text**, and refuses on a mismatch;
      - extracts to `/opt/kinnest/releases/<sha>`;
      - runs `deploy.sh <sha> <api-digest> <web-digest>`.
   5. Poll `get-command-invocation`, print the VM's output in the job log, and fail on non-zero.
   6. Hardening:
      - Every third-party action is **pinned to a commit SHA**.
      - `permissions: { contents: read, id-token: write, packages: write }`.
      - The job runs in GitHub environment `production`, limited to `main`; adding a required reviewer is optional.
      - `concurrency: deploy`, so two deploys never overlap.
      - Non-secret IDs (role ARN, instance ID, bucket, region) are repo Variables. There are no AWS keys anywhere.
9. **Docs**:
   - New `deploy/AWS_SETUP.md` covering phases 1–4, including the security rules below.
   - `deploy/ORACLE_SETUP.md` is marked superseded.
   - Spec §7 gets a dated decision note.
   - `.env.example` gains `NGROK_AUTHTOKEN`, `NGROK_DOMAIN`, `COMPOSE_PROFILES`, and the AWS backup keys.
   - `docs/RUNNING_ON_MAC.md` and HANDOFF get the new Mac compose command (with `docker-compose.build.yml`) and note
     `COMPOSE_PROFILES=worker`.
   - `docs/CHANGES.md` is updated in the same commit.

## Phase 1: AWS account (owner, guided by `AWS_SETUP.md`)
1. MFA on the root user, an admin user through IAM Identity Center, budget alerts at $1, $10 and $20, region `ap-south-1`.
2. **S3 bucket** `kinnest-backups-<random>`:
   - Block Public Access on, SSE-S3 encryption, **versioning on**, so an overwritten backup or release can be recovered.
   - Lifecycle rules:

     | Prefix | Expire after |
     |---|---|
     | `db/` | 30 days |
     | `migration/` | 30 days |
     | `releases/` | 90 days |
     | Noncurrent versions | 30 days |

   - Size: a dump is 27 KB today, so the bucket stays under 100 MB for years, costing under one cent a month at about
     $0.025/GB (unverified Mumbai price).
3. **IAM**, least privilege:
   - **Instance role `kinnest-ec2`**:
     - `AmazonSSMManagedInstanceCore`.
     - `s3:GetObject` on `releases/*` and `migration/*`.
     - `s3:PutObject` and `s3:GetObject` on `db/*`.
     - `s3:ListBucket` on the bucket.
     - **No write to `releases/`**, so the VM cannot plant its own deploy bundle.
   - **GitHub OIDC provider and role `kinnest-github-deploy`**:
     - Trusted only for `token.actions.githubusercontent.com` with audience `sts.amazonaws.com` and subject
       `repo:PG1996/kinnest:environment:production`. A job that uses an environment sends this subject, not the branch ref.
     - Allowed: `s3:PutObject` on `releases/*` only; `ssm:SendCommand` on this instance's ARN and the `AWS-RunShellScript`
       document; `ssm:GetCommandInvocation`.
4. **EC2**:
   - `t4g.small`, Ubuntu 24.04 ARM64 AMI (the SSM agent is preinstalled), 20 GB gp3.
   - Default tenancy, credit specification `standard`.
   - **IMDSv2 required with hop limit 1**, so containers cannot read the instance role's credentials.
   - Security group with **no inbound rules**.
   - Auto-assigned public IPv4, needed for outbound traffic. No Elastic IP.
   - The `kinnest-ec2` instance profile.
5. Optional: Data Lifecycle Manager daily EBS snapshots, keeping 7.
6. GitHub side:
   - 2FA on the account.
   - Branch protection on `main`, requiring CI.
   - Environment `production`, restricted to `main`.

## Phase 2: Prepare the VM (owner, through `aws ssm start-session`; the Mac needs `session-manager-plugin`)
This is the only hand-run setup. After it, deploys need no commands on the VM.
1. Paste and run `deploy/ec2-setup.sh` in the session.
2. `docker login ghcr.io` with a classic PAT scoped to `read:packages` only, because the packages are private. It is stored
   in `/root/.docker/config.json`.
3. Create `/opt/kinnest/.env` (root, mode 600) from the Mac's `.env`:
   - **Keep as is**: `SESSION_SECRET`, `VAPID_*`, `GOOGLE_*`, `SMTP_URL`, `OWNER_EMAIL`, `PUBLIC_BASE_URL`, `APP_TIMEZONE`.
   - **New**:
     - a strong `POSTGRES_PASSWORD` and the matching `DATABASE_URL` (dumps are `--no-owner`);
     - `PUBLIC_HOST=:80`;
     - `BACKUP_TARGET=s3` and `BACKUP_BUCKET`;
     - `NGROK_AUTHTOKEN` and `NGROK_DOMAIN`;
     - `COMPOSE_PROFILES=` (empty for now).
   - Keep a copy in a password manager. Losing the VAPID keys means every phone re-subscribes.

## Phase 3: Bring EC2 fully up and soak it (the family stays on the Mac and the ngrok address)
1. Run the deploy workflow. With `COMPOSE_PROFILES` empty, only `db`, `api` and `caddy` run: no worker, no ngrok.
2. **Rehearsal copy**:
   1. On the Mac, upload the newest `~/kinnest-backups/dev/dev-*.sql.gz` to S3 `migration/`.
   2. On the VM, download it and run `RESTORE_DB=kinnest /opt/kinnest/current/deploy/restore.sh <dump>`.
3. **Make the copy safe.** Delete every `push_subscriptions` row in the rehearsal DB only, so the VM worker cannot remind the
   family. Test data is allowed here because the copy is thrown away in phase 4.
4. Check the data: `alembic current` is at head, and row counts match the Mac for these tables: users, members, feeds,
   diapers, sleeps, medicines, doses, vitals, vaccines, visits, reminder states.
5. **Temporary address**:
   1. Start `docker run --rm --network kinnest-prod_default cloudflare/cloudflared:<pinned> tunnel --url http://caddy:80`. It
      prints a `https://<random>.trycloudflare.com` address.
   2. Set `PUBLIC_BASE_URL` to that address and `COMPOSE_PROFILES=worker`.
   3. Run `/opt/kinnest/current/deploy/deploy.sh`.
6. **End-to-end test** from the owner's phone on the temporary address:
   - Install the app, sign in, and turn on reminders.
   - Log feeds, diapers, sleep and doses. Reminders and escalations arrive.
   - The offline queue syncs.
   - The timeline, health tabs and feed timer work.
7. **Operations**:
   - The nightly backup lands in S3 and restores into `kinnest_restored` with matching counts.
   - Deploy two commits in a row, then **roll one back**.
   - A **tampered bundle is refused**: re-upload a modified `releases/<sha>.tar.gz` and re-send the command; the checksum
     must fail.
   - The stack survives a reboot.
   - `docker stats` and `free -m` look healthy.
8. **Soak for 2–3 days** with clean API and worker logs. Then:
   - Stop the quick tunnel.
   - Restore `PUBLIC_BASE_URL` to the ngrok address and set `COMPOSE_PROFILES=` again.
   - The owner resets the rehearsal DB (`DROP DATABASE kinnest` and recreate it). This is destructive, so the agent does not
     run it.

## Phase 4: Switch the address to AWS (only after phase 3 passes; 15–20 minutes of downtime, phones queue offline)
Run the steps in this order.
1. Tell the family. Pick a quiet time.
2. Mac: stop the ngrok agent.
3. Mac: stop the dev `api`, `worker` and `web`, and keep `db` running. The owner also stops `kinnest-prod`.
4. Mac: take the final dump with `deploy/backup-dev.sh`, note its sha256, and upload it to S3 `migration/`.
5. VM: download the dump, verify the sha256, restore it into the empty `kinnest` DB, and compare counts with the Mac.
6. VM: set `COMPOSE_PROFILES=worker,ngrok` and run `/opt/kinnest/current/deploy/deploy.sh`. Check
   `curl -H 'ngrok-skip-browser-warning: 1' https://matchless-expenses-stock.ngrok-free.dev/api/health`.
7. On a phone:
   - The app opens with no reinstall, and the queued entries sync.
   - A logged feed leads to a reminder on time.
   - Google sign-in works on a second device.
8. **Rollback** within the first hours:
   1. On the VM, set `COMPOSE_PROFILES=` and redeploy.
   2. Start the Mac's dev `api`, `worker` and `web`, plus ngrok.
   3. Dump any VM-side entries and move them back by hand.

## Phase 5: After cutover
- **Neutralise the Mac dev stack.** Its DB still holds the family's push subscriptions, and its `.env` has the real VAPID
  key and SMTP. A restarted dev worker would send real reminders.
  - Give dev its own `.env`: `PUBLIC_BASE_URL=http://localhost:8000`, no `SMTP_URL`, and new dev VAPID keys.
  - Keep the dev DB frozen for 2 weeks, then reseed it (the owner decides).
  - Unload the launchd dev-backup job.
  - Change the HANDOFF rule to "real data lives on AWS".
- A monthly restore drill from S3. Before day 150, move AWS to the Paid plan.
- No external uptime probe at first, because probes through ngrok use up its quota. Watch the worker logs and check ngrok
  usage weekly.
- **Slice 3b note** (not part of this deploy):
  - Documents and reports go to a separate private, versioned bucket `kinnest-media`, through an `S3Storage` behind the
    planned `Storage` protocol.
  - Downloads use short-lived presigned URLs, which keep files off ngrok's 1 GB.
  - Size is about 0.3–0.5 GB a year.

## Security rules (summary)
| Risk | Guard |
|---|---|
| Swapped deploy bundle in S3 | The sha256 travels separately in the SSM command and the VM checks it. The VM cannot write `releases/`. Versioning is on. |
| Swapped image in GHCR | The VM runs images only by digest, captured at build time. |
| Workflow misuse | OIDC trust limited to environment `production` on `main`; branch protection; actions pinned to SHAs; minimal `permissions`; 2FA. |
| Hacked container steals AWS credentials | IMDSv2 with hop limit 1. |
| Network attack on the VM | No inbound ports. Postgres is never published. `unattended-upgrades` is on. |
| Secret leaks | Secrets only in `/opt/kinnest/.env` (root, 600) and a password manager. None in bundles, SSM commands or GitHub. |

## Files
- **Change**: `deploy/docker-compose.prod.yml`, `deploy/Dockerfile.caddy`, `deploy/backup.sh`, `deploy/ORACLE_SETUP.md`,
  `.env.example`, `docs/RUNNING_ON_MAC.md`, `docs/HANDOFF.md`, `docs/CHANGES.md`, spec §7.
- **New**: `deploy/docker-compose.build.yml`, `deploy/deploy.sh`, `deploy/ec2-setup.sh`,
  `deploy/systemd/kinnest-backup.{service,timer}`, `.github/workflows/{ci,deploy}.yml`, `deploy/AWS_SETUP.md`.
- **Reused unchanged**:
  - `deploy/restore.sh`, which runs from the release dir through the linked `.env`;
  - `deploy/backup-dev.sh`;
  - `backend/Dockerfile`, which runs migrations on start;
  - `app.worker.main.run_once`.

## Verification
- **On the Mac, before pushing**:
  - `bash -n` and `shellcheck deploy/*.sh`.
  - `docker compose config` for the prod file alone and with the build override, for each profile set.
  - Extract a bundle into a scratch directory with only `deploy/` and check that `docker compose config` resolves without
    build contexts.
  - A full `deploy.sh` run against locally built images tagged as digests.
  - `backup.sh` with the local target.
- **CI**: green on the PR. The first deploy run shows `linux/arm64` images, digests in the log, and the bundle's sha256.
- **Soak (phase 3)**:
  - Counts match and `alembic current` is at head.
  - The S3 restore matches.
  - Phone reminders arrive.
  - Deploy, rollback and the tampered-bundle refusal all work.
  - The stack survives a reboot.
  - 2–3 clean days.
- **Cutover**:
  - Same URL and no reinstall.
  - The queued entries synced and a reminder was delivered.
  - A backup object is in S3 the next morning.

## Execution
After approval:
1. Save this as `docs/superpowers/plans/2026-11-16-kinnest-aws-deploy.md` with superpowers:writing-plans, task by task with
   test steps.
2. Run it natively with superpowers:executing-plans.
3. Commit with the owner as sole author and no co-author line.
