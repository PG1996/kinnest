#!/usr/bin/env bash
# Deploy one release on the VM. Runs as root from an extracted release bundle:
#   /opt/kinnest/releases/<sha>/deploy/deploy.sh <sha> <api-digest> <web-digest>   (from the GitHub deploy workflow)
#   /opt/kinnest/current/deploy/deploy.sh                                          (redeploy or roll back: reuses digests.env)
# Secrets live only in $KINNEST_HOME/.env (never in a bundle). Images run by digest, so only the exact images CI built can start.
# Tests on a Mac: KINNEST_HOME=<scratch dir> COMPOSE_BIN="docker-compose -p <scratch project>" (never the real kinnest-prod project).
set -euo pipefail

REL=$(cd "$(dirname "$0")/.." && pwd -P)
HOME_DIR=${KINNEST_HOME:-/opt/kinnest}
COMPOSE_BIN=${COMPOSE_BIN:-docker compose}
SYSTEMD_DIR=${SYSTEMD_DIR:-/etc/systemd/system}
cd "$REL"

die() { echo "deploy: $*" >&2; exit 1; }

if [ $# -eq 3 ]; then
  sha=$1 api=$2 web=$3
  [[ "$sha" =~ ^[0-9a-f]{7,40}$ ]] || die "bad sha: $sha"
  [[ "$api" =~ ^sha256:[0-9a-f]{64}$ ]] || die "bad api digest: $api"
  [[ "$web" =~ ^sha256:[0-9a-f]{64}$ ]] || die "bad web digest: $web"
  printf 'KINNEST_API_IMAGE=ghcr.io/pg1996/kinnest-api@%s\nKINNEST_WEB_IMAGE=ghcr.io/pg1996/kinnest-web@%s\n' "$api" "$web" > digests.env
elif [ $# -ne 0 ]; then
  die "usage: deploy.sh [<sha> <api-digest> <web-digest>]"
fi
[ -f digests.env ] || die "no digests.env in $REL (pass <sha> <api-digest> <web-digest>)"
[ -f "$HOME_DIR/.env" ] || die "missing $HOME_DIR/.env"

ln -sfn "$HOME_DIR/.env" "$REL/.env"
env_value() { grep -E "^$1=" .env | tail -n1 | cut -d= -f2- || true; }

profiles=$(env_value COMPOSE_PROFILES)
if [[ ",$profiles," == *,ngrok,* ]]; then
  [ -n "$(env_value NGROK_AUTHTOKEN)" ] && [ -n "$(env_value NGROK_DOMAIN)" ] || die "COMPOSE_PROFILES has ngrok: set NGROK_AUTHTOKEN and NGROK_DOMAIN in .env"
fi

COMPOSE="$COMPOSE_BIN -f deploy/docker-compose.prod.yml --env-file .env --env-file digests.env"
export COMPOSE
port=$(env_value CADDY_HTTP_PORT); port=${port:-8080}
name=$(basename "$REL")

# the backup timer follows the release: install the units whenever systemd is there
if command -v systemctl >/dev/null 2>&1 && [ -d "$SYSTEMD_DIR" ] && [ -d deploy/systemd ]; then
  cp deploy/systemd/kinnest-backup.service deploy/systemd/kinnest-backup.timer "$SYSTEMD_DIR/"
  systemctl daemon-reload
  systemctl enable --now kinnest-backup.timer
fi

if [ -z "${KINNEST_SKIP_PULL:-}" ]; then   # KINNEST_SKIP_PULL is for local tests with locally built images
  echo "deploy: pulling images for $name"
  $COMPOSE pull
fi

# a backup before every release; the very first deploy has no database yet
if [ -n "$($COMPOSE ps --status running -q db 2>/dev/null || true)" ]; then
  echo "deploy: backing up"
  BACKUP_TARGET=${BACKUP_TARGET:-$(env_value BACKUP_TARGET)} "$REL/deploy/backup.sh" || die "backup failed, not deploying"
elif [ -e "$HOME_DIR/.last-good" ]; then
  die "database is not running but a release is already live; fix that first"
else
  echo "deploy: first deploy, no database to back up"
fi

echo "deploy: starting"
$COMPOSE up -d --remove-orphans

healthy=0
for _ in $(seq 1 60); do
  if curl -fsS "http://127.0.0.1:$port/api/health" >/dev/null 2>&1; then healthy=1; break; fi
  sleep 2
done

if [ "$healthy" != 1 ]; then
  echo "deploy: health check failed for $name" >&2
  $COMPOSE logs --tail 40 api >&2 || true
  last=$(cat "$HOME_DIR/.last-good" 2>/dev/null || true)
  if [ -z "${KINNEST_ROLLBACK:-}" ] && [ -n "$last" ] && [ "$last" != "$name" ] && [ -x "$HOME_DIR/releases/$last/deploy/deploy.sh" ]; then
    echo "deploy: rolling back to $last (a migration cannot be undone: restore the backup if the schema changed)" >&2
    KINNEST_ROLLBACK=1 "$HOME_DIR/releases/$last/deploy/deploy.sh" || true
  fi
  exit 1
fi

ln -sfn "$REL" "$HOME_DIR/current.tmp" && mv -fh "$HOME_DIR/current.tmp" "$HOME_DIR/current" 2>/dev/null || mv -fT "$HOME_DIR/current.tmp" "$HOME_DIR/current"
echo "$name" > "$HOME_DIR/.last-good"
$COMPOSE exec -T api alembic current || true

# keep the newest 5 releases (never the live one) and drop images unused for 30 days
ls -1dt "$HOME_DIR"/releases/*/ | tail -n +6 | while read -r d; do
  [ "$(basename "$d")" = "$name" ] || rm -rf "$d"
done
docker image prune -af --filter "until=720h" >/dev/null 2>&1 || true
echo "deploy: $name is live"
