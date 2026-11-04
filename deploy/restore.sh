#!/usr/bin/env bash
# Restore a backup into a database that is empty or does not exist yet. Never overwrites existing data.
#   deploy/restore.sh kinnest-20261104T021500Z.sql.gz [target_db]
# target_db defaults to kinnest_restored. To recover on a fresh VM: start only the db service, run
#   RESTORE_DB=kinnest deploy/restore.sh <dump>
# then start everything. FORCE=1 allows restoring into a non-empty database (replaces nothing, adds on top).
set -euo pipefail
cd "$(dirname "$0")/.."

dump=${1:?usage: restore.sh <dump.sql.gz> [target_db]}
db=${2:-${RESTORE_DB:-kinnest_restored}}
COMPOSE=${COMPOSE:-"docker compose -f deploy/docker-compose.prod.yml --env-file .env"}
psql_admin() { $COMPOSE exec -T db psql -U kinnest -d postgres -v ON_ERROR_STOP=1 "$@"; }

exists=$(psql_admin -tAc "SELECT 1 FROM pg_database WHERE datname='$db'")
if [ -z "$exists" ]; then
  psql_admin -c "CREATE DATABASE \"$db\""
else
  tables=$($COMPOSE exec -T db psql -U kinnest -d "$db" -tAc "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'")
  if [ "$tables" != "0" ] && [ "${FORCE:-0}" != "1" ]; then
    echo "database $db already has $tables tables; refusing (set FORCE=1 to override)" >&2
    exit 1
  fi
fi

gunzip -c "$dump" | $COMPOSE exec -T db psql -U kinnest -d "$db" -v ON_ERROR_STOP=1 -q >/dev/null
echo "restored $dump into database $db"
