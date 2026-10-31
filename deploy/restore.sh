#!/usr/bin/env bash
# Puts a backup back. Overwrites the current database and images.
#   sudo bash deploy/restore.sh /var/backups/webrand360/db_2026-11-01_0230.dump [uploads_....tar.gz]
set -euo pipefail
cd "$(dirname "$0")/.."
DUMP=${1:?give the db_....dump file}
UPLOADS=${2:-}
DC="docker compose -f docker-compose.prod.yml --env-file .env.production"
read -rp "This replaces ALL current data with $DUMP. Type RESTORE to continue: " OK
[ "$OK" = "RESTORE" ] || exit 1
$DC stop api
$DC exec -T db pg_restore -U webrand -d webrand360 --clean --if-exists --no-owner < "$DUMP"
if [ -n "$UPLOADS" ]; then
  $DC start api
  $DC exec -T api sh -c 'rm -rf /data/uploads/* && tar xzf - -C /data' < "$UPLOADS"
fi
$DC start api
echo "Restored."
