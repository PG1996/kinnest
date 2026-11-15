#!/usr/bin/env bash
# Full snapshot of the DEV database, keeping the newest 3. Run by launchd every 15 minutes
# (deploy/com.kinnest.dev-backup.plist). Old snapshots are deleted only after a new one is verified.
#   BACKUP_DIR=<dir>   where snapshots go (default ~/kinnest-backups/dev)
#   KEEP=<n>           how many snapshots to keep (default 3)
#   DB_CONTAINER=<name> (default kinnest-dev-db-1)
# Restore: COMPOSE="docker-compose -p kinnest-dev -f deploy/docker-compose.yml" deploy/restore.sh <snapshot> [target_db]
set -euo pipefail
export PATH="/Applications/OrbStack.app/Contents/MacOS/xbin:$PATH"

dir=${BACKUP_DIR:-$HOME/kinnest-backups/dev}
keep=${KEEP:-3}
container=${DB_CONTAINER:-kinnest-dev-db-1}
mkdir -p "$dir"
tmp="$dir/.tmp-$$"
trap 'rm -f "$tmp"' EXIT

docker exec "$container" pg_dump -U kinnest --no-owner kinnest | gzip > "$tmp"
if [ "$(wc -c < "$tmp")" -lt 500 ]; then
  echo "$(date -u +%FT%TZ) backup too small, refusing to store it" >&2
  exit 1
fi
gzip -t "$tmp"

final="$dir/dev-$(date +%Y%m%dT%H%M%S).sql.gz"
mv "$tmp" "$final"
ls -1t "$dir"/dev-*.sql.gz | tail -n +$((keep + 1)) | while read -r old; do rm -f "$old"; done
echo "$(date -u +%FT%TZ) stored $final"
