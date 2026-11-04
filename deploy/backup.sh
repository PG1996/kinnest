#!/usr/bin/env bash
# Nightly database backup. Cron example (on the VM):  15 2 * * * /home/ubuntu/kinnest/deploy/backup.sh >> /var/log/kinnest-backup.log 2>&1
#   BACKUP_TARGET=s3           upload to S3-compatible storage (needs BACKUP_BUCKET, BACKUP_ENDPOINT, aws cli configured)
#   BACKUP_TARGET=local:<dir>  copy into <dir> and delete files older than 14 days there
# For s3, set an object lifecycle rule on the bucket to delete objects after 14 days.
# Exits non-zero on any failure so cron/monitoring can notice.
set -euo pipefail
cd "$(dirname "$0")/.."

COMPOSE=${COMPOSE:-"docker compose -f deploy/docker-compose.prod.yml --env-file .env"}
TARGET=${BACKUP_TARGET:-s3}
stamp=$(date -u +%Y%m%dT%H%M%SZ)
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
file="$tmp/kinnest-$stamp.sql.gz"

$COMPOSE exec -T db pg_dump -U kinnest --no-owner kinnest | gzip > "$file"
if [ "$(wc -c < "$file")" -lt 500 ]; then
  echo "backup too small, refusing to store it" >&2
  exit 1
fi

case "$TARGET" in
  local:*)
    dir=${TARGET#local:}
    mkdir -p "$dir"
    cp "$file" "$dir/"
    find "$dir" -name 'kinnest-*.sql.gz' -mtime +14 -delete
    echo "backup stored: $dir/$(basename "$file")"
    ;;
  s3)
    : "${BACKUP_BUCKET:?set BACKUP_BUCKET}" "${BACKUP_ENDPOINT:?set BACKUP_ENDPOINT}"
    aws s3 cp "$file" "s3://$BACKUP_BUCKET/db/$(basename "$file")" --endpoint-url "$BACKUP_ENDPOINT"
    echo "backup uploaded: s3://$BACKUP_BUCKET/db/$(basename "$file")"
    ;;
  *)
    echo "unknown BACKUP_TARGET: $TARGET" >&2
    exit 1
    ;;
esac
