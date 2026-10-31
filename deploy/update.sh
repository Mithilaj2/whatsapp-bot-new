#!/usr/bin/env bash
# Installs the latest version from GitHub: backup first, then rebuild and restart.
# The database updates itself when the API starts.
#   sudo bash deploy/update.sh
set -euo pipefail
cd "$(dirname "$0")/.."
bash deploy/backup.sh
git pull --ff-only
docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build
docker image prune -f >/dev/null
echo "Updated to $(git log -1 --format='%h %s')"
