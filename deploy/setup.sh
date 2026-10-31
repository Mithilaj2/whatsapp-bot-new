#!/usr/bin/env bash
# One-time setup on a fresh Ubuntu 22.04 / 24.04 server. Run as root from the project folder:
#   sudo bash deploy/setup.sh
# Installs Docker, writes .env.production with fresh secrets, starts everything, creates the
# first admin, and schedules a daily backup. Safe to run again (it keeps an existing .env.production).
set -euo pipefail
cd "$(dirname "$0")/.."
ENV_FILE=.env.production

if [ "$(id -u)" -ne 0 ]; then echo "Run with sudo: sudo bash deploy/setup.sh"; exit 1; fi

echo "== 1/5 Docker"
if ! command -v docker >/dev/null; then
  curl -fsSL https://get.docker.com | sh
fi
systemctl enable --now docker >/dev/null

echo "== 2/5 Settings"
if [ ! -f "$ENV_FILE" ]; then
  read -rp "Panel address (e.g. app.webrand360.com): " DOMAIN
  read -rp "Email for SSL certificate notices: " EMAIL
  while true; do
    read -rsp "Password for the first admin login (12+ characters): " ADMINPW; echo
    [ ${#ADMINPW} -ge 12 ] && break
    echo "Too short, try again."
  done
  cp deploy/.env.production.example "$ENV_FILE"
  set_var() { python3 - "$ENV_FILE" "$1" "$2" <<'PY'
import sys, re
path, key, val = sys.argv[1:]
s = open(path).read()
s = re.sub(rf'^{key}=.*$', f'{key}="{val}"', s, flags=re.M)
open(path, 'w').write(s)
PY
  }
  set_var PANEL_DOMAINS "$DOMAIN"
  set_var PUBLIC_API_URL "https://$DOMAIN/api"
  set_var ACME_EMAIL "$EMAIL"
  set_var POSTGRES_PASSWORD "$(openssl rand -hex 24)"
  set_var JWT_SECRET "$(openssl rand -hex 32)"
  set_var ENCRYPTION_KEY "$(openssl rand -hex 32)"
  set_var META_VERIFY_TOKEN "$(openssl rand -hex 16)"
  set_var SEED_ADMIN_PASSWORD "$ADMINPW"
  chmod 600 "$ENV_FILE"
  echo "Wrote $ENV_FILE. Add the Meta settings (META_APP_ID, META_APP_SECRET, META_ACCESS_TOKEN) to it before going live."
fi
if ! grep -q '^META_APP_SECRET=".\+"' "$ENV_FILE"; then
  echo
  echo "META_APP_SECRET is empty in $ENV_FILE. The API refuses to start without it."
  echo "Open the file (nano $ENV_FILE), fill in META_APP_ID, META_APP_SECRET and META_ACCESS_TOKEN, then run this again."
  exit 1
fi

echo "== 3/5 Building and starting (first time takes a few minutes)"
docker compose -f docker-compose.prod.yml --env-file "$ENV_FILE" up -d --build

echo "== 4/5 Countries and first admin"
for i in $(seq 1 30); do
  docker compose -f docker-compose.prod.yml --env-file "$ENV_FILE" exec -T api node -e "fetch('http://127.0.0.1:4000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" && break
  sleep 3
done
docker compose -f docker-compose.prod.yml --env-file "$ENV_FILE" exec -T api node dist/db/seed.js
# The password is only needed once
sed -i 's/^SEED_ADMIN_PASSWORD=.*/SEED_ADMIN_PASSWORD=""/' "$ENV_FILE"

echo "== 5/5 Daily backup at 02:30"
mkdir -p /var/backups/webrand360
CRON="30 2 * * * cd $(pwd) && bash deploy/backup.sh >> /var/log/webrand360-backup.log 2>&1"
( crontab -l 2>/dev/null | grep -v 'deploy/backup.sh' ; echo "$CRON" ) | crontab -

DOMAIN=$(grep '^PANEL_DOMAINS=' "$ENV_FILE" | cut -d'"' -f2 | cut -d, -f1)
VERIFY=$(grep '^META_VERIFY_TOKEN=' "$ENV_FILE" | cut -d'"' -f2)
cat <<MSG

Done. Open https://$DOMAIN and log in as admin.
(If the page doesn't load, check the domain's DNS A record points to this server.)

Meta webhook (developers.facebook.com > your app > WhatsApp > Configuration):
  Callback URL: https://$DOMAIN/api/webhooks/meta
  Verify token: $VERIFY
  Subscribe to: messages, message_template_status_update, phone_number_quality_update
MSG
