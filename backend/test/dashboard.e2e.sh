#!/usr/bin/env bash
# End-to-end checks for Phase 7: dashboard numbers and notifications.
# Run last, after the other suites (same database). API with LOW_CREDIT_THRESHOLD=100,
# META_APP_SECRET=testsecret, TEST_PROVIDER_SPEED=3.
API=http://localhost:4000/api
SECRET=testsecret
pass=0; fail=0
check() { if [ "$2" == "$3" ]; then echo "PASS  $1"; pass=$((pass+1)); else echo "FAIL  $1 (expected $2, got $3)"; fail=$((fail+1)); fi; }
code() { curl -s -o /tmp/body.json -w '%{http_code}' "$@"; }
login() { curl -s -X POST $API/auth/login -H 'content-type: application/json' -d "{\"username\":\"$1\",\"password\":\"$2\"}" | jq -r .accessToken; }
ADMIN=$(login admin 'TestAdmin#2026'); A=(-H "authorization: Bearer $ADMIN" -H 'content-type: application/json')
mkacc() { curl -s -X POST $API/accounts -H "authorization: Bearer $1" -H 'content-type: application/json' -d "$2" | jq -r .id; }
move() { curl -s -o /dev/null -X POST $API/credits/transactions -H "authorization: Bearer $1" -H 'content-type: application/json' -d "{\"accountId\":\"$2\",\"service\":\"PREMIUM\",\"countryCode\":\"IN\",\"direction\":\"$3\",\"amount\":$4}"; sleep 0.4; }
notes() { curl -s "$API/notifications?pageSize=50" -H "authorization: Bearer $1"; }
has() { notes $1 | jq --arg t "$2" '[.items[]|select(.type==$t)]|length'; }
camp() { curl -s "$API/campaigns/$2" -H "authorization: Bearer $1"; }
waitstatus() { for i in $(seq 1 60); do s=$(camp $1 $2 | jq -r .status); [[ " $3 " == *" $s "* ]] && { echo $s; return; }; sleep 0.5; done; echo $s; }

RS=$(mkacc $ADMIN '{"username":"dashagency","name":"Dash Agency","type":"RESELLER","password":"Agency#1234"}'); RT=$(login dashagency 'Agency#1234')
CU=$(mkacc $RT '{"username":"dashshop","name":"Dash Shop","type":"CUSTOMER","password":"Shop#123456"}'); CT=$(login dashshop 'Shop#123456')
R=(-H "authorization: Bearer $RT" -H 'content-type: application/json'); C=(-H "authorization: Bearer $CT" -H 'content-type: application/json')

# --- credit notifications
check "nothing yet" 0 "$(notes $CT | jq .total)"
move $ADMIN $RS GIVE 1000
check "reseller told about credits" 1 "$(has $RT CREDITS_RECEIVED)"
check "message says how many" true "$(notes $RT | jq -r '.items[0].title' | grep -q '1,000 Premium credits (India)' && echo true)"
move $RT $CU GIVE 150
check "customer told, with sender" "From Dash Agency." "$(notes $CT | jq -r '[.items[]|select(.type=="CREDITS_RECEIVED")][0].body')"
move $RT $CU TAKE 20
check "customer told about take-back" 1 "$(has $CT CREDITS_REMOVED)"
check "reseller not told it 'received' its own take-back" 1 "$(has $RT CREDITS_RECEIVED)"
check "no low alert at 130" 0 "$(has $CT CREDITS_LOW)"
move $RT $CU TAKE 40
check "low alert at 90" 1 "$(has $CT CREDITS_LOW)"
check "reseller told customer is low" 1 "$(has $RT CREDITS_LOW)"
move $RT $CU TAKE 5
check "low alert only once a day" 1 "$(has $CT CREDITS_LOW)"

# --- read / unread
U=$(curl -s $API/notifications/unread-count "${C[@]}" | jq .unread)
check "unread counted (received, 3 take-backs, low)" 5 "$U"
NID=$(notes $CT | jq -r '.items[0].id')
check "mark one read" 201 "$(code -X POST $API/notifications/$NID/read "${C[@]}")"
check "one fewer unread" $((U-1)) "$(curl -s $API/notifications/unread-count "${C[@]}" | jq .unread)"
check "unread filter" $((U-1)) "$(curl -s "$API/notifications?unread=true" "${C[@]}" | jq .total)"
RNID=$(notes $RT | jq -r '.items[0].id')
check "can't touch someone else's" 404 "$(code -X POST $API/notifications/$RNID/read "${C[@]}")"
check "read all" $((U-1)) "$(curl -s -X POST $API/notifications/read-all "${C[@]}" | jq .marked)"
check "none unread" 0 "$(curl -s $API/notifications/unread-count "${C[@]}" | jq .unread)"

# --- campaigns
python3 -c "open('/tmp/d.jpg','wb').write(b'\xff\xd8\xff\xe0'+b'\0'*20000)"
MEDIA=$(curl -s -X POST $API/media -H "authorization: Bearer $CT" -F "file=@/tmp/d.jpg" | jq -r .id)
body() { echo "{\"service\":\"PREMIUM\",\"title\":\"$1\",\"numbers\":\"$2\",\"mediaId\":\"$MEDIA\",\"message\":\"$3\",\"consent\":true$4}"; }
C1=$(curl -s -X POST $API/campaigns "${C[@]}" -d "$(body 'Dash demo' '9746010001\n9746010002\n9746010000' 'Dashboard test offer for you')" | jq -r .id)
check "campaign completes" COMPLETED "$(waitstatus $CT $C1 COMPLETED)"
sleep 2
check "finished notification" 1 "$(has $CT CAMPAIGN_FINISHED)"
check "it links to the report" "/campaigns/premium/reports/$C1" "$(notes $CT | jq -r '[.items[]|select(.type=="CAMPAIGN_FINISHED")][0].link')"
check "mentions the failure" true "$(notes $CT | jq -r '[.items[]|select(.type=="CAMPAIGN_FINISHED")][0].body' | grep -q '1 failed' && echo true)"
C2=$(curl -s -X POST $API/campaigns "${R[@]}" -d "$(body 'For my customer' '9746010003' 'Agency sends this for the shop' ",\"accountId\":\"$CU\"")" | jq -r .id)
check "reseller's campaign for customer completes" COMPLETED "$(waitstatus $RT $C2 COMPLETED)"
sleep 2
check "customer told" 2 "$(has $CT CAMPAIGN_FINISHED)"
check "reseller who sent it told too" 1 "$(has $RT CAMPAIGN_FINISHED)"
C3=$(curl -s -X POST $API/campaigns "${C[@]}" -d "$(body 'Bad one' '9746010004' 'Please reject this text')" | jq -r .id)
check "rejected campaign" REJECTED "$(waitstatus $CT $C3 REJECTED)"
sleep 1
check "rejection notification" ERROR "$(notes $CT | jq -r '[.items[]|select(.type=="CAMPAIGN_REJECTED")][0].level')"

# --- brands
ADM_BEFORE=$(has $ADMIN BRAND_SUBMITTED)
B=$(curl -s -X POST $API/brands "${C[@]}" -d '{"organizationName":"Dash Shop LLP","displayName":"Dash Shop","category":"Shopping and retail","email":"a@dash.in","phoneNumber":"+91 97460 55555","address":"Kochi","contactName":"Asha"}' | jq -r .id)
sleep 0.5
check "admin told about new brand" $((ADM_BEFORE+1)) "$(has $ADMIN BRAND_SUBMITTED)"
curl -s -o /dev/null -X POST $API/brands/$B/review "${A[@]}" -d '{"decision":"REJECT","note":"Add the GST number"}'; sleep 0.5
check "customer told it was sent back" "To fix: Add the GST number" "$(notes $CT | jq -r '[.items[]|select(.type=="BRAND_REJECTED")][0].body')"
BN=$(curl -s -X POST $API/gateway/numbers "${A[@]}" -d '{"label":"Dash Shop","provider":"TEST","service":"BRANDED","phoneNumber":"919746055555"}' | jq -r .id)
curl -s -o /dev/null -X POST $API/brands/$B/review "${A[@]}" -d '{"decision":"APPROVE","senderNumberId":"'$BN'"}'; sleep 0.5
check "customer told it is live" 1 "$(has $CT BRAND_APPROVED)"

# --- bot hand-over
BOT=$(curl -s -X POST $API/bots "${C[@]}" -d '{"name":"Shop bot"}' | jq -r .id)
curl -s -o /dev/null -X PATCH $API/bots/$BOT "${C[@]}" -d '{"senderNumberId":"'$BN'","isActive":true}'
say() { curl -s -o /dev/null -X POST $API/gateway/test/inbound "${A[@]}" -d "{\"senderNumberId\":\"$BN\",\"from\":\"919746000077\",\"text\":\"$1\",\"name\":\"Nimmi\"${2:+,\"replyId\":\"$2\"}}"; sleep 1.2; }
say hi; say "Talk to us" "welcome:o3"
check "hand-over notification" true "$(notes $CT | jq -r '[.items[]|select(.type=="BOT_HANDOFF")][0].title' | grep -q 'Nimmi' && echo true)"

# --- number quality (Meta webhook)
hook() { local sig; sig="sha256=$(printf '%s' "$1" | openssl dgst -sha256 -hmac $SECRET | sed 's/^.* //')"; curl -s -o /dev/null -w '%{http_code}' -X POST $API/webhooks/meta -H 'content-type: application/json' -H "x-hub-signature-256: $sig" --data-binary "$1"; }
Q='{"object":"whatsapp_business_account","entry":[{"id":"9999888877","changes":[{"field":"phone_number_quality_update","value":{"display_phone_number":"15550100001","event":"RED","current_limit":"TIER_1K"}}]}]}'
check "quality webhook accepted" 200 "$(hook "$Q")"; sleep 1
check "admin warned about quality" true "$(notes $ADMIN | jq -r '[.items[]|select(.type=="NUMBER_QUALITY")][0].title' | grep -q 'is low' && echo true)"
hook "$Q" >/dev/null; sleep 1
check "same rating again: no second alert" 1 "$(has $ADMIN NUMBER_QUALITY)"

# --- dashboard
curl -s "$API/dashboard" "${C[@]}" > /tmp/dc.json
check "customer: 3 campaigns" 3 "$(jq .tiles.campaigns /tmp/dc.json)"
check "customer: messages" 5 "$(jq .tiles.messages /tmp/dc.json)"
check "customer: balance shown" true "$(jq '.tiles.balance.PREMIUM > 0' /tmp/dc.json)"
check "customer: delivery rate" true "$(jq '.tiles.deliveryRate > 0.5 and .tiles.deliveryRate < 1' /tmp/dc.json)"
check "customer: failed message counted" 1 "$(jq .delivery.failed /tmp/dc.json)"
check "customer: status split" "2|1" "$(jq -r '"\(.campaignStatus.COMPLETED)|\(.campaignStatus.REJECTED)"' /tmp/dc.json)"
check "customer: 30 days by day" "30|day" "$(jq -r '"\(.creditActivity|length)|\(.range.unit)"' /tmp/dc.json)"
check "customer: today received 150" 150 "$(jq '.creditActivity[-1].received' /tmp/dc.json)"
check "customer: bot chats" 1 "$(jq .tiles.botChats /tmp/dc.json)"
check "customer: branded filter" 0 "$(curl -s "$API/dashboard?service=BRANDED" "${C[@]}" | jq .tiles.campaigns)"
curl -s "$API/dashboard" "${R[@]}" > /tmp/dr.json
check "reseller: sees customer's campaigns" 3 "$(jq .tiles.campaigns /tmp/dr.json)"
check "reseller: 1 customer" 1 "$(jq .tiles.customers /tmp/dr.json)"
check "reseller: gave 150 today" 150 "$(jq '.creditActivity[-1].given' /tmp/dr.json)"
check "reseller: credits used below" true "$(jq '.creditActivity[-1].used > 0' /tmp/dr.json)"
check "reseller: new customer today" 1 "$(jq '.accountGrowth[-1].customers' /tmp/dr.json)"
check "outsider: none of it" 0 "$(curl -s "$API/dashboard" -H "authorization: Bearer $(login spicecafe 'Spice#12345')" | jq .tiles.campaigns)"
check "admin: no own balance" null "$(curl -s "$API/dashboard" "${A[@]}" | jq .tiles.balance)"
check "90 days by week" week "$(curl -s "$API/dashboard?from=2026-08-01&to=2026-10-29" "${A[@]}" | jq -r .range.unit)"
check "a year by month" 12 "$(curl -s "$API/dashboard?from=2025-11-01&to=2026-10-31" "${A[@]}" | jq '.campaignVolume|length')"
check "start after end" 400 "$(code "$API/dashboard?from=2026-10-10&to=2026-10-01" "${A[@]}")"
check "too long" 400 "$(code "$API/dashboard?from=2020-01-01&to=2026-10-01" "${A[@]}")"
check "bad date" 400 "$(code "$API/dashboard?from=2026-13-45" "${A[@]}")"

echo; echo "$pass passed, $fail failed"; [ $fail -eq 0 ]
