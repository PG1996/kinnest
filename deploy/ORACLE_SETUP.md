> **Later stage.** The first step is running on your Mac (`docs/RUNNING_ON_MAC.md`). Use this guide when you move to a
> hosted VM with a domain, so reminders no longer depend on your Mac being awake.

# Moving Kinnest to an Oracle Cloud Always Free VM

The same Docker stack runs on the VM; only `.env` differs. These steps need your own Oracle account. Budget about an hour.

## 1. Create the VM
1. Sign up at cloud.oracle.com (a card is needed for verification; Always Free resources are not charged).
2. Compute → Instances → Create: image **Ubuntu 24.04**, shape **VM.Standard.A1.Flex** (ARM) with 2 OCPU and 12 GB, plus your SSH key.
   If Oracle reports no capacity, retry later. The fallback is a Google Cloud e2-micro (Always Free, 1 GB RAM, so add swap).
3. Reserve a public IP and attach it, so the address survives restarts.
4. In the VCN's Security List allow inbound TCP **80** and **443** from `0.0.0.0/0`.
5. Recommended: upgrade to Pay As You Go. Always Free resources stay free, and idle VMs are no longer at risk of reclaim.

## 2. Prepare the machine
```bash
ssh ubuntu@<public-ip>
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 80 -j ACCEPT    # Oracle's Ubuntu also firewalls locally
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 443 -j ACCEPT
sudo apt-get update && sudo apt-get install -y netfilter-persistent && sudo netfilter-persistent save
curl -fsSL https://get.docker.com | sudo sh && sudo usermod -aG docker ubuntu     # then log out and in
```

## 3. Free domain (DuckDNS) and HTTPS
Create a subdomain at duckdns.org (for example `kinnest`) pointing at the VM's IP. Caddy then gets the HTTPS certificate
by itself. Optional IP updater in cron: `*/5 * * * * curl -s "https://www.duckdns.org/update?domains=kinnest&token=TOKEN&ip=" >/dev/null`

## 4. Code and configuration
```bash
rsync -az --exclude .git --exclude node_modules --exclude .venv --exclude .env ./ ubuntu@<public-ip>:kinnest/
ssh ubuntu@<public-ip> && cd kinnest && cp .env.example .env && nano .env
```
Differences from the Mac `.env`: `PUBLIC_HOST=kinnest.duckdns.org`, remove `CADDY_HTTP_PORT`,
`PUBLIC_BASE_URL=https://kinnest.duckdns.org`, `BACKUP_TARGET=s3` with `BACKUP_BUCKET` and `BACKUP_ENDPOINT`. Reuse the VAPID keys
from the Mac so phones keep their notification subscriptions. Update the Google redirect URI to the new address.

```bash
docker compose -f deploy/docker-compose.prod.yml --env-file .env up -d --build
curl https://kinnest.duckdns.org/api/health
```

## 5. Move the data
On the Mac: `deploy/backup.sh` (local target), copy the `.sql.gz` to the VM, then on the VM start only the database and restore:
```bash
docker compose -f deploy/docker-compose.prod.yml --env-file .env up -d db
RESTORE_DB=kinnest deploy/restore.sh kinnest-<stamp>.sql.gz
docker compose -f deploy/docker-compose.prod.yml --env-file .env up -d --build
```
A new web address means each caregiver reinstalls the app and turns reminders on again once.

## 6. Backups to Oracle Object Storage
Create a private bucket with a lifecycle rule deleting objects after 14 days. Create a **Customer secret key** (Profile → your user),
install the AWS CLI (`sudo apt-get install -y awscli`), run `aws configure` with that key pair, and set
`BACKUP_ENDPOINT=https://<namespace>.compat.objectstorage.<region>.oraclecloud.com`. Test with `deploy/backup.sh`, then schedule it:
`15 2 * * * cd /home/ubuntu/kinnest && set -a && . ./.env && set +a && deploy/backup.sh >> /home/ubuntu/backup.log 2>&1`
Practice a restore once. A backup never restored is a guess.
