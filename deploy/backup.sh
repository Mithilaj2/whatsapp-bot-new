#!/usr/bin/env bash
# Daily backup: database + campaign images, kept 14 days in /var/backups/webrand360.
# Copy that folder somewhere else too (another server, Google Drive, S3): a backup on the same
# server doesn't help if the server is lost.
set -euo pipefail
cd "$(dirname "$0")/.."
DIR=${BACKUP_DIR:-/var/backups/webrand360}
KEEP_DAYS=${KEEP_DAYS:-14}
STAMP=$(date +%Y-%m-%d_%H%M)
DC="docker compose -f docker-compose.prod.yml --env-file .env.production"
mkdir -p "$DIR"

$DC exec -T db pg_dump -U webrand -d webrand360 --format=custom > "$DIR/db_$STAMP.dump"
$DC exec -T api tar czf - -C /data uploads > "$DIR/uploads_$STAMP.tar.gz"
# A backup that is suspiciously small is a failed backup
[ "$(stat -c%s "$DIR/db_$STAMP.dump")" -gt 10000 ] || { echo "Backup looks empty: $DIR/db_$STAMP.dump"; exit 1; }

find "$DIR" -name 'db_*.dump' -mtime +"$KEEP_DAYS" -delete
find "$DIR" -name 'uploads_*.tar.gz' -mtime +"$KEEP_DAYS" -delete
echo "$(date) backup ok: db_$STAMP.dump uploads_$STAMP.tar.gz"
