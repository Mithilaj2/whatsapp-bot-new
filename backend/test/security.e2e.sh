#!/usr/bin/env bash
# Security checks (Phase 8). Run last, after the other suites, from the backend folder.
# API .env: PANEL_DOMAINS="localhost,app.webrand360.com", META_APP_SECRET set.
API=http://localhost:4000/api
pass=0; fail=0
check() { if [ "$2" == "$3" ]; then echo "PASS  $1"; pass=$((pass+1)); else echo "FAIL  $1 (expected $2, got $3)"; fail=$((fail+1)); fi; }
code() { curl -s -o /tmp/body.json -w '%{http_code}' "$@"; }
login() { curl -s -X POST $API/auth/login -H 'content-type: application/json' -d "{\"username\":\"$1\",\"password\":\"$2\"}" | jq -r .accessToken; }
trylogin() { code -X POST $API/auth/login -H 'content-type: application/json' -d "{\"username\":\"$1\",\"password\":\"$2\"}"; }
ADMIN=$(login admin 'TestAdmin#2026'); A=(-H "authorization: Bearer $ADMIN" -H 'content-type: application/json')
mkacc() { curl -s -X POST $API/accounts -H "authorization: Bearer $1" -H 'content-type: application/json' -d "$2" | jq -r .id; }

RS=$(mkacc $ADMIN '{"username":"secagency","name":"Sec Agency","type":"RESELLER","password":"Agency#1234","domain":"panel.secagency.in"}'); RT=$(login secagency 'Agency#1234')
CU=$(mkacc $RT '{"username":"secshop","name":"Sec Shop","type":"CUSTOMER","password":"Shop#123456"}')

# --- headers
H=$(curl -s -D - -o /dev/null $API/health)
check "no x-powered-by" 0 "$(echo "$H" | grep -ci '^x-powered-by')"
check "nosniff" 1 "$(echo "$H" | grep -ci '^x-content-type-options: nosniff')"
check "no framing" 1 "$(echo "$H" | grep -ci "frame-ancestors 'none'")"
check "HSTS header" 1 "$(echo "$H" | grep -ci '^strict-transport-security')"

# --- password guessing
for i in $(seq 1 8); do trylogin secshop "wrong-$i" >/dev/null; done
check "9th try blocked" 429 "$(trylogin secshop 'Shop#123456')"
check "says when to retry" true "$(jq -r .message /tmp/body.json | grep -q 'Try again in' && echo true)"
check "other users unaffected" 200 "$(trylogin secagency 'Agency#1234')"
trylogin nobody-here 'x' >/dev/null
check "unknown user: same answer" "Wrong username or password" "$(jq -r .message /tmp/body.json)"
check "failed logins in activity log" true "$(curl -s "$API/audit?action=LOGIN_FAILED&search=secshop" "${A[@]}" | jq '.total >= 8')"
check "very long password refused early" 400 "$(trylogin admin "$(head -c 300 /dev/zero | tr '\0' a)")"

# --- password change signs other sessions out
T1=$(login secagency 'Agency#1234'); T2=$(login secagency 'Agency#1234')
R=$(curl -s -X POST $API/auth/change-password -H "authorization: Bearer $T1" -H 'content-type: application/json' -d '{"currentPassword":"Agency#1234","newPassword":"Agency#5678"}')
NEWT=$(echo $R | jq -r .accessToken)
check "change gives a fresh token" true "$([ ${#NEWT} -gt 40 ] && echo true)"
check "old session 1 out" 401 "$(code $API/auth/me -H "authorization: Bearer $T1")"
check "old session 2 out" 401 "$(code $API/auth/me -H "authorization: Bearer $T2")"
check "fresh token works" 200 "$(code $API/auth/me -H "authorization: Bearer $NEWT")"
check "old password refused" 401 "$(trylogin secagency 'Agency#1234')"
CT=$(login secagency 'Agency#5678')
SHOP=$(curl -s -X POST $API/accounts -H "authorization: Bearer $CT" -H 'content-type: application/json' -d '{"username":"secshop2","name":"Shop Two","type":"CUSTOMER","password":"Shop2#12345"}' | jq -r .id)
ST=$(login secshop2 'Shop2#12345')
curl -s -o /dev/null -X PATCH $API/accounts/$SHOP -H "authorization: Bearer $CT" -H 'content-type: application/json' -d '{"password":"Reset#12345"}'
check "reset by reseller signs customer out" 401 "$(code $API/auth/me -H "authorization: Bearer $ST")"
check "forged token refused" 401 "$(code $API/auth/me -H "authorization: Bearer ${ADMIN%?}x")"

# --- activity log
curl -s -o /dev/null -X POST $API/credits/transactions "${A[@]}" -d "{\"accountId\":\"$RS\",\"service\":\"PREMIUM\",\"countryCode\":\"IN\",\"direction\":\"GIVE\",\"amount\":321}"
sleep 0.5
check "credit move logged with amount" 321 "$(curl -s "$API/audit?action=POST%20/api/credits" "${A[@]}" | jq '.items[0].details.amount')"
check "password not stored" 0 "$(curl -s "$API/audit?pageSize=200" "${A[@]}" | grep -c 'Reset#12345\|Agency#5678')"
check "reset shown as password change" true "$(curl -s "$API/audit?search=$SHOP" "${A[@]}" | jq '[.items[]|select(.details.passwordChanged)]|length >= 1')"
check "customer can't read the log" 403 "$(code $API/audit -H "authorization: Bearer $(login secshop2 'Reset#12345')")"
check "reseller sees only own tree" 0 "$(curl -s "$API/audit?pageSize=200" -H "authorization: Bearer $CT" | jq '[.items[]|select(.username=="admin")]|length')"
check "IP recorded" true "$(curl -s "$API/audit?action=LOGIN" "${A[@]}" | jq -r '.items[0].ip' | grep -Eq '127.0.0.1|::1|localhost' && echo true)"

# --- webhooks, domains, inputs
check "unsigned webhook refused" 401 "$(code -X POST $API/webhooks/meta -H 'content-type: application/json' -d '{"object":"whatsapp_business_account","entry":[]}')"
check "wrong verify token" 403 "$(code "$API/webhooks/meta?hub.mode=subscribe&hub.verify_token=nope&hub.challenge=1")"
check "SSL allowed for our domain" 200 "$(code "$API/public/branding/tls-check?domain=app.webrand360.com")"
check "SSL allowed for reseller domain" 200 "$(code "$API/public/branding/tls-check?domain=panel.secagency.in")"
check "SSL refused for strangers" 404 "$(code "$API/public/branding/tls-check?domain=evil.example.com")"
check "unknown fields refused" 400 "$(code -X POST $API/accounts "${A[@]}" -d '{"username":"x1x1x1","name":"X","type":"CUSTOMER","password":"Xx#1234567","isAdmin":true}')"
check "search with SQL is just text" 0 "$(curl -s "$API/accounts?search=%27%20or%201%3D1%20--" "${A[@]}" | jq .total)"
check "media path tricks refused" 404 "$(code "$API/media/..%2F..%2F.env")"
python3 -c "import json; print(json.dumps({'service':'PREMIUM','numbers':'9'*6_000_000}))" > /tmp/big.json
check "huge body refused" 413 "$(code -X POST $API/campaigns/check "${A[@]}" --data-binary @/tmp/big.json)"
check "customer can't see admin pages" 403 "$(code $API/gateway/numbers -H "authorization: Bearer $(login secshop2 'Reset#12345')")"

# --- production settings guard
# Run from an empty folder so the test .env isn't picked up
MAIN="$(cd "$(dirname "$0")/.." && pwd)/dist/main.js"
OUT=$(cd "$(mktemp -d)" && env -i PATH="$PATH" NODE_ENV=production JWT_SECRET=short DATABASE_URL=postgres://x timeout 20 node "$MAIN" 2>&1)
check "weak production settings stop the API" true "$(echo "$OUT" | grep -q "can't start in production" && echo true)"
check "names the fixes" true "$(echo "$OUT" | grep -q 'ENCRYPTION_KEY' && echo "$OUT" | grep -q 'META_APP_SECRET' && echo true)"

echo; echo "$pass passed, $fail failed"; [ $fail -eq 0 ]
