#!/usr/bin/env bash
# End-to-end checks for Phase 4: Premium Campaigns, refunds, opt-outs, inbox.
# Needs: fresh database, API started with CAMPAIGN_MIN_RECIPIENTS=20 and TEST_PROVIDER_SPEED=3.
API=http://localhost:4000/api
pass=0; fail=0
check() { if [ "$2" == "$3" ]; then echo "PASS  $1"; pass=$((pass+1)); else echo "FAIL  $1 (expected $2, got $3)"; fail=$((fail+1)); fi; }
code() { curl -s -o /tmp/body.json -w '%{http_code}' "$@"; }
login() { curl -s -X POST $API/auth/login -H 'content-type: application/json' -d "{\"username\":\"$1\",\"password\":\"$2\"}" | jq -r .accessToken; }
H() { echo "-H" "authorization: Bearer $1" "-H" "content-type: application/json"; }
ADMIN=$(login admin 'TestAdmin#2026'); A=(-H "authorization: Bearer $ADMIN" -H 'content-type: application/json')
mkacc() { curl -s -X POST $API/accounts -H "authorization: Bearer $1" -H 'content-type: application/json' -d "$2" | jq -r .id; }
give() { curl -s -o /dev/null -X POST $API/credits/transactions -H "authorization: Bearer $1" -H 'content-type: application/json' -d "{\"accountId\":\"$2\",\"service\":\"PREMIUM\",\"countryCode\":\"IN\",\"direction\":\"GIVE\",\"amount\":$3}"; }
bal() { curl -s "$API/credits/summary" -H "authorization: Bearer $1" | jq '.totals.PREMIUM'; }
# Numbers list: N Indian mobiles starting at an offset, one per line, as a JSON string
nums() { python3 -c "import json,sys; print(json.dumps('\n'.join('98450%05d' % (int(sys.argv[1])+i) for i in range(int(sys.argv[2])))))" $1 $2; }
camp() { curl -s "$API/campaigns/$2" -H "authorization: Bearer $1"; }
waitstatus() { for i in $(seq 1 60); do s=$(camp $1 $2 | jq -r .status); [[ " $3 " == *" $s "* ]] && { echo $s; return; }; sleep 0.5; done; echo $s; }

# --- setup: test-mode number as the shared Premium number, accounts and credits
curl -s -X POST $API/gateway/numbers "${A[@]}" -d '{"label":"Shared demo","provider":"TEST","service":"PREMIUM","phoneNumber":"15550108888","isDefault":true}' > /tmp/num.json
NUM=$(jq -r .id /tmp/num.json)
AG=$(mkacc $ADMIN '{"username":"agency","name":"Agency","type":"RESELLER","password":"Agency#1234"}'); AGT=$(login agency 'Agency#1234')
SHOP=$(mkacc $AGT '{"username":"shop","name":"Shop One","type":"CUSTOMER","password":"Shop#12345"}'); ST=$(login shop 'Shop#12345')
OTHER=$(mkacc $AGT '{"username":"othershop","name":"Other","type":"CUSTOMER","password":"Other#1234"}'); OT=$(login othershop 'Other#1234')
give $ADMIN $AG 100; give $AGT $SHOP 30
check "limits" '10|20' "$(curl -s $API/campaigns/limits "${A[@]}" | jq -r '"\(.demoMax)|\(.min)"')"

# --- image upload
printf 'hello' > /tmp/small.txt
python3 -c "open('/tmp/big.jpg','wb').write(b'\xff\xd8\xff\xe0'+b'\0'*20000)"
python3 -c "open('/tmp/fake.jpg','wb').write(b'GIF89a'+b'\0'*20000)"
python3 -c "open('/tmp/tiny.jpg','wb').write(b'\xff\xd8\xff\xe0'+b'\0'*100)"
up() { curl -s -o /tmp/body.json -w '%{http_code}' -X POST $API/media -H "authorization: Bearer $ST" -F "file=@$1"; }
check "rejects non-image" 400 "$(up /tmp/fake.jpg)"
check "rejects under 10 KB" 400 "$(up /tmp/tiny.jpg)"
check "accepts JPEG" 201 "$(up /tmp/big.jpg)"
MEDIA=$(jq -r .id /tmp/body.json); MURL=$(jq -r .url /tmp/body.json)
check "image served publicly" 200 "$(curl -s -o /dev/null -w '%{http_code}' $MURL)"

# --- recipient check
UAE=$(curl -s "$API/countries?search=United%20Arab" "${A[@]}" | jq -r '.items[0].id')
curl -s -X PATCH $API/countries/$UAE "${A[@]}" -d '{"isActive":false}' >/dev/null
LIST='"9845662183\n+91 98456 62183\nabc\n12345\n+971501234567\n+1 415 555 2671\n98450 11111"'
curl -s -X POST $API/campaigns/check -H "authorization: Bearer $ST" -H 'content-type: application/json' -d "{\"service\":\"PREMIUM\",\"numbers\":$LIST}" > /tmp/chk.json
check "check: total 7" 7 "$(jq .total /tmp/chk.json)"
check "check: 2 invalid" 2 "$(jq .invalid /tmp/chk.json)"
check "check: 1 duplicate (+91 same number)" 1 "$(jq .duplicates /tmp/chk.json)"
check "check: 1 country switched off" 1 "$(jq .countryOff /tmp/chk.json)"
check "check: 3 recipients" 3 "$(jq .recipients /tmp/chk.json)"
check "check: India + US" "IN,US" "$(jq -r '[.byCountry[].code]|sort|join(",")' /tmp/chk.json)"
check "check: no US credits" false "$(jq .enoughCredits /tmp/chk.json)"
check "check: demo" true "$(jq .isDemo /tmp/chk.json)"
curl -s -X PATCH $API/countries/$UAE "${A[@]}" -d '{"isActive":true}' >/dev/null

C() { # token json -> http code, body in /tmp/body.json
  code -X POST $API/campaigns -H "authorization: Bearer $1" -H 'content-type: application/json' -d "$2"; }
body() { echo "{\"service\":\"PREMIUM\",\"title\":\"$1\",\"numbers\":$2,\"mediaId\":\"$MEDIA\",\"message\":\"$3\",\"callNumber\":\"98989 89898\",\"visitUrl\":\"https://webrand360.com\",\"consent\":true${4}}"; }

check "between demo and minimum rejected" 400 "$(C $ST "$(body 'Too few' "$(nums 100 12)" 'Diwali offer for you')")"
check "consent required" 400 "$(C $ST "$(body 'No consent' "$(nums 100 3)" 'Hi' | sed 's/"consent":true/"consent":false/')")"

# --- demo campaign: 5 numbers, one fails in test mode (ends with 0000)
DEMO_NUMS='"9845010001\n9845010002\n9845010003\n9845010004\n9845010000"'
check "demo campaign created" 201 "$(C $ST "$(body 'Website design offer' "$DEMO_NUMS" 'Website design and digital marketing at special prices this month.')")"
C1=$(jq -r .id /tmp/body.json); NO1=$(jq -r .campaignNo /tmp/body.json)
check "6-character campaign number" 6 "${#NO1}"
check "charged 5 credits" 25 "$(bal $ST)"
check "waits for WhatsApp approval first" PENDING_APPROVAL "$(jq -r .status /tmp/body.json)"
check "starts and completes on its own" COMPLETED "$(waitstatus $ST $C1 COMPLETED)"
sleep 4
camp $ST $C1 > /tmp/c1.json
check "4 read" 4 "$(jq .stats.read /tmp/c1.json)"
check "1 failed" 1 "$(jq .stats.failed /tmp/c1.json)"
check "failed credit refunded" 1 "$(jq .creditsRefunded /tmp/c1.json)"
check "balance back to 26" 26 "$(bal $ST)"
check "failure reason listed" true "$(jq -r '.failureReasons[0].reason' /tmp/c1.json | grep -q 'not on WhatsApp' && echo true)"
check "run time recorded" true "$(jq '.completedAt != null and .startedAt != null' /tmp/c1.json)"
check "ledger shows spend and refund" "REFUND,SPENT" "$(curl -s "$API/credits/transactions?category=campaign&search=$NO1" -H "authorization: Bearer $ST" | jq -r '[.items[].type]|sort|join(",")')"

TPLS_BEFORE=$(curl -s "$API/gateway/templates" "${A[@]}" | jq .total)
check "same message again" 201 "$(C $ST "$(body 'Repeat' '"9845010005\n9845010006\n9845010007"' 'Website design and digital marketing at special prices this month.')")"
C2=$(jq -r .id /tmp/body.json)
check "reuses approved template: sends at once" SENDING "$(jq -r .status /tmp/body.json)"
check "no new template created" "$TPLS_BEFORE" "$(curl -s "$API/gateway/templates" "${A[@]}" | jq .total)"
check "balance 23" 23 "$(bal $ST)"

BEFORE=$(curl -s "$API/campaigns" -H "authorization: Bearer $ST" | jq .total)
check "not enough credits refused" 400 "$(C $ST "$(body 'Too big' "$(nums 200 30)" 'Big sale')")"
check "says not enough credits" true "$(jq -r .message /tmp/body.json | grep -q 'Not enough credits' && echo true)"
check "nothing saved after refusal" "$BEFORE" "$(curl -s "$API/campaigns" -H "authorization: Bearer $ST" | jq .total)"
check "balance unchanged (23)" 23 "$(bal $ST)"

check "reseller sends for its customer" 201 "$(C $AGT "$(body 'For shop' '"9845010008\n9845010009"' 'Website design and digital marketing at special prices this month.' ",\"accountId\":\"$SHOP\"")")"
C3=$(jq -r .id /tmp/body.json)
check "charged to the customer (21)" 21 "$(bal $ST)"
check "reseller balance untouched" 70 "$(bal $AGT)"
check "other customer can't see it" 404 "$(code $API/campaigns/$C3 -H "authorization: Bearer $OT")"
check "customer can't send for others" 404 "$(C $ST "$(body 'Not mine' '"9845010008"' 'hi' ",\"accountId\":\"$OTHER\"")")"
check "reseller list shows shop campaigns" 3 "$(curl -s "$API/campaigns" -H "authorization: Bearer $AGT" | jq .total)"
check "search by campaign number" 1 "$(curl -s "$API/campaigns?search=$NO1" -H "authorization: Bearer $AGT" | jq .total)"

# --- replies, opt-out, inbox
sleep 2
reply_in() { curl -s -o /dev/null -X POST $API/gateway/test/inbound "${A[@]}" -d "{\"senderNumberId\":\"$NUM\",\"from\":\"$1\",\"text\":\"$2\",\"name\":\"$3\"}"; }
reply_in 919845010001 "Hai, need a website" "Santhosh Kumar"; reply_in 919845010002 "STOP" "Seleniel"; sleep 1
check "customer sees 2 conversations" 2 "$(curl -s "$API/inbox/conversations?service=PREMIUM" -H "authorization: Bearer $ST" | jq .total)"
check "reseller sees them too" 2 "$(curl -s "$API/inbox/conversations?service=PREMIUM" -H "authorization: Bearer $AGT" | jq .total)"
check "other customer sees none" 0 "$(curl -s "$API/inbox/conversations?service=PREMIUM" -H "authorization: Bearer $OT" | jq .total)"
curl -s "$API/inbox/$NUM/919845010001" -H "authorization: Bearer $ST" > /tmp/thread.json
check "thread has campaign tag" "$NO1" "$(jq -r '[.messages[]|select(.direction=="OUT")][0].campaignNo' /tmp/thread.json)"
check "reply allowed within 24h" true "$(jq .canReply /tmp/thread.json)"
check "reply sent" 201 "$(code -X POST $API/inbox/$NUM/919845010001/reply -H "authorization: Bearer $ST" -H 'content-type: application/json' -d '{"text":"Sure! Our team will call you today."}')"
check "reply counted on campaign" 2 "$(camp $ST $C1 | jq .stats.replies)"
check "STOP recorded as opt-out" 1 "$(curl -s "$API/opt-outs" -H "authorization: Bearer $ST" | jq .total)"
check "opted-out number excluded" 1 "$(curl -s -X POST $API/campaigns/check -H "authorization: Bearer $ST" -H 'content-type: application/json' -d '{"service":"PREMIUM","numbers":"9845010002\n9845010003"}' | jq .optedOut)"
check "conversation csv export" true "$(curl -s "$API/inbox/export?service=PREMIUM" -H "authorization: Bearer $ST" | grep -q 'need a website' && echo true)"

# --- rejected message: all credits back
check "message WhatsApp rejects" 201 "$(C $ST "$(body 'Rejected one' '"9845010011\n9845010012\n9845010013"' 'This text will be rejected in test mode')")"
C4=$(jq -r .id /tmp/body.json)
check "campaign rejected" REJECTED "$(waitstatus $ST $C4 REJECTED)"
sleep 1
check "all 3 credits returned" 3 "$(camp $ST $C4 | jq .creditsRefunded)"
check "balance back to 21" 21 "$(bal $ST)"
check "same rejected text refused at once" 400 "$(C $ST "$(body 'Again' '"9845010014"' 'This text will be rejected in test mode')")"

# --- stop a running campaign: slow the number to 1 message/second
curl -s -X PATCH $API/gateway/numbers/$NUM "${A[@]}" -d '{"ratePerSecond":1}' >/dev/null
check "20-number campaign" 201 "$(C $ST "$(body 'Slow one' "$(nums 300 20)" 'Website design and digital marketing at special prices this month.')")"
C5=$(jq -r .id /tmp/body.json)
check "balance 1" 1 "$(bal $ST)"
sleep 3
check "stop campaign" 201 "$(code -X POST $API/campaigns/$C5/cancel -H "authorization: Bearer $ST")"
STOPPED=$(jq .stopped /tmp/body.json)
check "most messages stopped" true "$([ "$STOPPED" -ge 10 ] && echo true)"
sleep 6
camp $ST $C5 > /tmp/c5.json
check "status cancelled" CANCELLED "$(jq -r .status /tmp/c5.json)"
check "stopped messages refunded" "$STOPPED" "$(jq .creditsRefunded /tmp/c5.json)"
SENT5=$(( 20 - STOPPED ))
check "balance = 1 + stopped" $(( 1 + STOPPED )) "$(bal $ST)"
check "cannot stop twice" 400 "$(code -X POST $API/campaigns/$C5/cancel -H "authorization: Bearer $ST")"
curl -s -X PATCH $API/gateway/numbers/$NUM "${A[@]}" -d '{"ratePerSecond":20}' >/dev/null

check "csv report rows (5 + header)" 6 "$(curl -s "$API/campaigns/$C1/report" -H "authorization: Bearer $ST" | grep -c '')"
check "recipients filter failed" 1 "$(curl -s "$API/campaigns/$C1/recipients?status=FAILED" -H "authorization: Bearer $ST" | jq .total)"
check "defaults saved" "Hello default" "$(curl -s -X PUT $API/campaigns/defaults -H "authorization: Bearer $ST" -H 'content-type: application/json' -d '{"message":"Hello default","callNumber":"98989 89898"}' >/dev/null; curl -s $API/campaigns/defaults -H "authorization: Bearer $ST" | jq -r .message)"
check "ledger matches balances" true "$(curl -s "$API/credits/reconcile" "${A[@]}" | jq .ok)"

echo; echo "$pass passed, $fail failed"
