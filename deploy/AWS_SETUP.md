# Running Kinnest on AWS (EC2 in Mumbai)

The same Docker stack that ran on the Mac runs on one small VM. GitHub Actions builds the images and sends each release;
nothing is built or pulled from Git on the VM. Design and decisions: `docs/superpowers/plans/2026-11-20-kinnest-aws-deploy.md`.

```
push to main -> CI -> build arm64 images (GHCR) -> upload deploy/ bundle to S3 -> SSM command on the VM
                                                    VM: download bundle, check sha256, deploy.sh (images by digest)
family phones -> ngrok address -> ngrok container on the VM -> Caddy -> API   (no inbound ports on the VM)
```

## Security rules these steps follow
- The VM has **no inbound rules**. ngrok, SSM and S3 are all outbound.
- The bundle's sha256 travels in the SSM command, apart from the bundle; the VM refuses a mismatch. The VM role cannot write `releases/`.
- Images run by digest (`@sha256:...`), taken from the build, so a re-pushed tag changes nothing.
- IMDSv2 with hop limit 1: containers cannot read the VM's AWS credentials.
- The GitHub role trusts only environment `production` of this repo. Third-party actions are pinned to commit SHAs.
- Secrets live only in `/opt/kinnest/.env` (root, mode 600) and your password manager. Never in a bundle, an SSM command or GitHub.

## 1. AWS account
1. MFA on the root user, an admin user (IAM Identity Center), budget alerts at $1, $10 and $20. Region **ap-south-1**.
2. S3 bucket `kinnest-<random>`: Block Public Access on, default encryption SSE-S3, **versioning on**. Lifecycle rules: expire
   `db/` and `migration/` after 30 days, `releases/` after 90 days, noncurrent versions after 30 days.
3. IAM role `kinnest-ec2` (EC2 trust), with the managed policy `AmazonSSMManagedInstanceCore` and this inline policy:
   ```json
   {"Version":"2012-10-17","Statement":[
     {"Effect":"Allow","Action":"s3:ListBucket","Resource":"arn:aws:s3:::BUCKET"},
     {"Effect":"Allow","Action":"s3:GetObject","Resource":["arn:aws:s3:::BUCKET/releases/*","arn:aws:s3:::BUCKET/migration/*"]},
     {"Effect":"Allow","Action":["s3:PutObject","s3:GetObject"],"Resource":"arn:aws:s3:::BUCKET/db/*"}]}
   ```
4. IAM OIDC provider `token.actions.githubusercontent.com` (audience `sts.amazonaws.com`) and role `kinnest-github-deploy`:
   - trust condition: `sub` equals `repo:PG1996/kinnest:environment:production`, `aud` equals `sts.amazonaws.com`;
   - inline policy: `s3:PutObject` on `arn:aws:s3:::BUCKET/releases/*`; `ssm:SendCommand` on the instance ARN and on
     `arn:aws:ssm:ap-south-1::document/AWS-RunShellScript`; `ssm:GetCommandInvocation` on `*`.
5. EC2: `t4g.small`, Ubuntu 24.04 LTS arm64, 20 GB gp3, default (shared) tenancy, credit specification **standard**,
   **IMDSv2 required with hop limit 1**, a security group with **no inbound rules**, auto-assigned public IPv4, instance
   profile `kinnest-ec2`. Optional: a Data Lifecycle Manager policy for daily EBS snapshots, keeping 7.
6. GitHub repo settings: 2FA on your account; branch protection on `main` requiring the `ci` checks; an environment named
   `production` limited to `main` (a required reviewer is optional); repo **Variables** `AWS_REGION`, `AWS_DEPLOY_ROLE_ARN`,
   `DEPLOY_BUCKET`, `EC2_INSTANCE_ID`. The packages are created on the first run; leave them private.

## 2. Prepare the VM (once)
```bash
aws ssm start-session --target <instance-id>         # needs the session-manager-plugin on the Mac
sudo -i
# paste deploy/ec2-setup.sh into a file and run it:  bash ec2-setup.sh
docker login ghcr.io -u <github user>                 # classic token, scope read:packages only
install -m 600 /dev/null /opt/kinnest/.env && nano /opt/kinnest/.env
```
`/opt/kinnest/.env` is the Mac's `.env` with these differences:
- **Keep**: `SESSION_SECRET`, `VAPID_*`, `GOOGLE_*`, `SMTP_URL`, `OWNER_EMAIL`, `PUBLIC_BASE_URL`, `APP_TIMEZONE`. Changing them logs people out or breaks push.
- **New**: a strong `POSTGRES_PASSWORD` and the same password inside `DATABASE_URL`; `PUBLIC_HOST=:80`; `BACKUP_TARGET=s3`;
  `BACKUP_BUCKET=<bucket>`; `NGROK_AUTHTOKEN`; `NGROK_DOMAIN`; `COMPOSE_PROFILES=` (empty while soaking, then `worker,ngrok`).
- Keep a copy in a password manager. Lost VAPID keys mean every phone turns reminders on again.

## 3. Soak on a rehearsal copy (the family stays on the Mac)
1. Run the deploy workflow (Actions -> deploy -> Run workflow on `main`). With `COMPOSE_PROFILES` empty only `db`, `api` and `caddy` start.
2. On the Mac upload the newest dump: `aws s3 cp ~/kinnest-backups/dev/dev-<stamp>.sql.gz s3://BUCKET/migration/`. On the VM:
   `aws s3 cp s3://BUCKET/migration/<file> /tmp/ && cd /opt/kinnest/current && RESTORE_DB=kinnest deploy/restore.sh /tmp/<file>`.
3. **Remove the family's push subscriptions from this copy** so the VM worker cannot remind them:
   `docker exec -i kinnest-prod-db-1 psql -U kinnest -d kinnest -c "DELETE FROM push_subscriptions"`.
4. Check `alembic current` is at head and the row counts match the Mac.
5. Temporary HTTPS address:
   `docker run -d --name quicktunnel --network kinnest-prod_default cloudflare/cloudflared:latest tunnel --url http://caddy:80`,
   read the `https://<random>.trycloudflare.com` from `docker logs quicktunnel`. Set `PUBLIC_BASE_URL` to it and
   `COMPOSE_PROFILES=worker` in `/opt/kinnest/.env`, then `/opt/kinnest/current/deploy/deploy.sh`.
6. Test on a phone: install, sign in, reminders on, log everything, airplane-mode queue, reminders arrive.
7. Test operations: the nightly backup lands in S3 and restores into `kinnest_restored`; two deploys then a rollback
   (`/opt/kinnest/releases/<old>/deploy/deploy.sh`); a tampered `releases/<sha>.tar.gz` is refused; the VM survives a reboot.
8. After 2 to 3 clean days: `docker rm -f quicktunnel`, put `PUBLIC_BASE_URL` back to the ngrok address, `COMPOSE_PROFILES=`,
   and **you** reset the rehearsal database (`DROP DATABASE kinnest`, then `CREATE DATABASE kinnest`).

## 4. Switch the address (15 to 20 minutes of downtime; phones queue offline)
1. Tell the family; pick a quiet time.
2. Mac: stop the ngrok agent, the dev `api`, `worker` and `web`, and the `kinnest-prod` stack. Keep the dev `db` running.
3. Mac: `deploy/backup-dev.sh`, note the file's `shasum -a 256`, upload it to `s3://BUCKET/migration/`.
4. VM: download it, verify the checksum, restore into the empty `kinnest` database, compare row counts with the Mac.
5. VM: `COMPOSE_PROFILES=worker,ngrok` in `.env`, then `/opt/kinnest/current/deploy/deploy.sh`.
   Check `curl -H 'ngrok-skip-browser-warning: 1' https://<ngrok domain>/api/health`.
6. Phone: the app opens without reinstalling and queued entries sync; a logged feed leads to a reminder; Google sign-in works.
7. Rollback in the first hours: set `COMPOSE_PROFILES=` on the VM and redeploy, start the Mac's dev stack and ngrok again,
   and move any entries made on the VM back by hand.

## 5. After the switch
- The Mac dev stack must not send real reminders: give it its own `.env` (`PUBLIC_BASE_URL=http://localhost:8000`, no `SMTP_URL`, new dev VAPID keys).
- Monthly: restore the newest S3 backup into `kinnest_restored` and compare counts. Before day 150 of the AWS Free plan,
  move to the Paid plan or the account closes.

## Day to day
- Deploy: merge to `main`. Redeploy an older commit: Actions -> deploy -> Run workflow, `ref` = the commit.
- `.env` change: edit `/opt/kinnest/.env` on the VM, then `/opt/kinnest/current/deploy/deploy.sh`.
- Logs: `docker logs kinnest-prod-api-1`, `docker logs kinnest-prod-worker-1`; backups: `journalctl -u kinnest-backup`.
