#!/usr/bin/env bash
# End-to-end checks for Phase 5: brand onboarding, Branded Campaigns, auto responder, opt-out scope.
# Run after the other suites (same database). API started with TEST_PROVIDER_SPEED=3.
API=http://localhost:4000/api
pass=0; fail=0
check() { if [ "$2" == "$3" ]; then echo "PASS  $1"; pass=$((pass+1)); else echo "FAIL  $1 (expected $2, got $3)"; fail=$((fail+1)); fi; }
code() { curl -s -o /tmp/body.json -w '%{http_code}' "$@"; }
login() { curl -s -X POST $API/auth/login -H 'content-type: application/json' -d "{\"username\":\"$1\",\"password\":\"$2\"}" | jq -r .accessToken; }
ADMIN=$(login admin 'TestAdmin#2026'); A=(-H "authorization: Bearer $ADMIN" -H 'content-type: application/json')
mkacc() { curl -s -X POST $API/accounts -H "authorization: Bearer $1" -H 'content-type: application/json' -d "$2" | jq -r .id; }
give() { curl -s -o /dev/null -X POST $API/credits/transactions -H "authorization: Bearer $1" -H 'content-type: application/json' -d "{\"accountId\":\"$2\",\"service\":\"$3\",\"countryCode\":\"IN\",\"direction\":\"GIVE\",\"amount\":$4}"; }
bal() { curl -s "$API/credits/summary" -H "authorization: Bearer $1" | jq ".totals.$2"; }
nums() { python3 -c "import json,sys; print(json.dumps('\n'.join('97450%05d' % (int(sys.argv[1])+i) for i in range(int(sys.argv[2])))))" $1 $2; }
camp() { curl -s "$API/campaigns/$2" -H "authorization: Bearer $1"; }
waitstatus() { for i in $(seq 1 60); do s=$(camp $1 $2 | jq -r .status); [[ " $3 " == *" $s "* ]] && { echo $s; return; }; sleep 0.5; done; echo $s; }
J() { echo "-H" "authorization: Bearer $1"; }

# --- accounts
RS=$(mkacc $ADMIN '{"username":"brandagency","name":"Brand Agency","type":"RESELLER","password":"Agency#1234"}'); RT=$(login brandagency 'Agency#1234')
CU=$(mkacc $RT '{"username":"bakery","name":"Kochi Bakery","type":"CUSTOMER","password":"Bakery#1234"}'); CT=$(login bakery 'Bakery#1234')
OU=$(mkacc $ADMIN '{"username":"outsider","name":"Outsider","type":"CUSTOMER","password":"Outsider#123"}'); OT=$(login outsider 'Outsider#123')
give $ADMIN $RS BRANDED 100; give $RT $CU BRANDED 40

# --- logo
python3 -c "open('/tmp/logo.png','wb').write(b'\x89PNG\r\n\x1a\n'+b'\0'*20000)"
LOGO=$(curl -s -X POST $API/media -H "authorization: Bearer $CT" -F "file=@/tmp/logo.png" | jq -r .id)

# --- onboarding form
FORM='{"organizationName":"Kochi Bakery Pvt Ltd","displayName":"Kochi Bakery","category":"Food and grocery","description":"Fresh cakes","website":"https://kochibakery.in","email":"Owner@KochiBakery.in","phoneNumber":"94470 12345","address":"MG Road, Kochi","taxId":"32abcde1234f1z5","contactName":"Anil","logoMediaId":"'$LOGO'"}'
check "categories list" true "$(curl -s $API/brands/categories -H "authorization: Bearer $CT" | jq 'length > 10')"
check "bad category rejected" 400 "$(code -X POST $API/brands -H "authorization: Bearer $CT" -H 'content-type: application/json' -d "$(echo $FORM | jq -c '.category="Space"')")"
check "bad phone rejected" 400 "$(code -X POST $API/brands -H "authorization: Bearer $CT" -H 'content-type: application/json' -d "$(echo $FORM | jq -c '.phoneNumber="12ab"')")"
check "customer submits brand" 201 "$(code -X POST $API/brands -H "authorization: Bearer $CT" -H 'content-type: application/json' -d "$FORM")"
B1=$(jq -r .id /tmp/body.json)
check "status submitted" SUBMITTED "$(jq -r .status /tmp/body.json)"
check "phone stored with country code" 919447012345 "$(jq -r .phoneNumber /tmp/body.json)"
check "email lower-cased" owner@kochibakery.in "$(jq -r .email /tmp/body.json)"
check "GST upper-cased" 32ABCDE1234F1Z5 "$(jq -r .taxId /tmp/body.json)"
check "logo link given" true "$(jq -r .logoUrl /tmp/body.json | grep -q '/media/' && echo true)"
check "reseller submits for own customer" 201 "$(code -X POST $API/brands -H "authorization: Bearer $RT" -H 'content-type: application/json' -d "$(echo $FORM | jq -c --arg a $CU '.accountId=$a | .displayName="Kochi Bakery Cakes" | del(.logoMediaId)')")"
B2=$(jq -r .id /tmp/body.json)
check "outsider can't submit for bakery" 404 "$(code -X POST $API/brands -H "authorization: Bearer $OT" -H 'content-type: application/json' -d "$(echo $FORM | jq -c --arg a $CU '.accountId=$a')")"
check "admin needs to pick a customer" 400 "$(code -X POST $API/brands "${A[@]}" -d "$FORM")"
check "reseller sees 2" 2 "$(curl -s "$API/brands" -H "authorization: Bearer $RT" | jq .total)"
check "outsider sees none" 0 "$(curl -s "$API/brands" -H "authorization: Bearer $OT" | jq .total)"
check "outsider can't open" 404 "$(code $API/brands/$B1 -H "authorization: Bearer $OT")"
check "search by display name" 1 "$(curl -s "$API/brands?search=Cakes" "${A[@]}" | jq .total)"
check "customer can't review" 403 "$(code -X POST $API/brands/$B1/review -H "authorization: Bearer $CT" -H 'content-type: application/json' -d '{"decision":"REJECT","note":"x"}')"
check "reject needs a note" 400 "$(code -X POST $API/brands/$B2/review "${A[@]}" -d '{"decision":"REJECT"}')"
check "admin rejects with note" 201 "$(code -X POST $API/brands/$B2/review "${A[@]}" -d '{"decision":"REJECT","note":"Display name must match the business name"}')"
check "rejected" REJECTED "$(jq -r .status /tmp/body.json)"
check "fix and resubmit" SUBMITTED "$(curl -s -X PUT $API/brands/$B2 -H "authorization: Bearer $RT" -H 'content-type: application/json' -d "$(echo $FORM | jq -c --arg a $CU '.accountId=$a | .displayName="Kochi Bakery" | del(.logoMediaId)')" | jq -r .status)"

# --- no approved brand yet
check "no brands to send from yet" 0 "$(curl -s "$API/brands/approved" -H "authorization: Bearer $CT" | jq length)"
check "branded check needs a brand" 400 "$(code -X POST $API/campaigns/check -H "authorization: Bearer $CT" -H 'content-type: application/json' -d '{"service":"BRANDED","numbers":"9845012345"}')"
check "unapproved brand can't send" 400 "$(code -X POST $API/campaigns/check -H "authorization: Bearer $CT" -H 'content-type: application/json' -d '{"service":"BRANDED","brandId":"'$B1'","numbers":"9845012345"}')"

# --- admin sets up the customer's number and approves
P=$(curl -s -X POST $API/gateway/numbers "${A[@]}" -d '{"label":"Premium spare","provider":"TEST","service":"PREMIUM","phoneNumber":"15550109997"}' | jq -r .id)
BN=$(curl -s -X POST $API/gateway/numbers "${A[@]}" -d '{"label":"Kochi Bakery","provider":"TEST","service":"BRANDED","phoneNumber":"919447012345"}' | jq -r .id)
BN2=$(curl -s -X POST $API/gateway/numbers "${A[@]}" -d '{"label":"Spare branded","provider":"TEST","service":"BRANDED","phoneNumber":"15550109996"}' | jq -r .id)
check "approve needs a number" 400 "$(code -X POST $API/brands/$B1/review "${A[@]}" -d '{"decision":"APPROVE"}')"
check "premium number refused" 400 "$(code -X POST $API/brands/$B1/review "${A[@]}" -d '{"decision":"APPROVE","senderNumberId":"'$P'"}')"
check "approve with branded number" 201 "$(code -X POST $API/brands/$B1/review "${A[@]}" -d '{"decision":"APPROVE","senderNumberId":"'$BN'"}')"
check "approved" APPROVED "$(jq -r .status /tmp/body.json)"
check "number shown on brand" 919447012345 "$(jq -r .number.phoneNumber /tmp/body.json)"
check "number now owned by bakery" "$CU" "$(curl -s $API/gateway/numbers "${A[@]}" | jq -r --arg n $BN '.[]|select(.id==$n)|.ownerAccountId')"
check "same number can't go to second brand" 409 "$(code -X POST $API/brands/$B2/review "${A[@]}" -d '{"decision":"APPROVE","senderNumberId":"'$BN'"}')"
check "approved brand is locked" 400 "$(code -X PUT $API/brands/$B1 -H "authorization: Bearer $CT" -H 'content-type: application/json' -d "$FORM")"
check "can't reject a live brand" 400 "$(code -X POST $API/brands/$B1/review "${A[@]}" -d '{"decision":"REJECT","note":"x"}')"
check "brand ready in composer" "Kochi Bakery" "$(curl -s "$API/brands/approved" -H "authorization: Bearer $CT" | jq -r '.[0].displayName')"
check "reseller sees it for the customer" 1 "$(curl -s "$API/brands/approved?accountId=$CU" -H "authorization: Bearer $RT" | jq length)"
check "outsider can't use bakery's brand" 404 "$(code -X POST $API/campaigns/check -H "authorization: Bearer $OT" -H 'content-type: application/json' -d '{"service":"BRANDED","brandId":"'$B1'","numbers":"9845012345"}')"

# --- limits
check "branded limits" '10|11' "$(curl -s "$API/campaigns/limits?service=BRANDED" -H "authorization: Bearer $CT" | jq -r '"\(.demoMax)|\(.min)"')"
curl -s -X POST $API/campaigns/check -H "authorization: Bearer $CT" -H 'content-type: application/json' -d '{"service":"BRANDED","brandId":"'$B1'","numbers":'"$(nums 0 12)"'}' > /tmp/chk.json
check "12 numbers is a full branded campaign" null "$(jq .problem /tmp/chk.json)"
check "branded credits shown" 40 "$(jq '.byCountry[0].balance' /tmp/chk.json)"

# --- branded campaign
python3 -c "open('/tmp/b.jpg','wb').write(b'\xff\xd8\xff\xe0'+b'\0'*20000)"
MEDIA=$(curl -s -X POST $API/media -H "authorization: Bearer $CT" -F "file=@/tmp/b.jpg" | jq -r .id)
BODY='{"service":"BRANDED","brandId":"'$B1'","title":"Plum cake week","numbers":'"$(nums 0 12)"',"mediaId":"'$MEDIA'","message":"Christmas plum cakes are here. Order today.","consent":true}'
check "branded campaign created" 201 "$(code -X POST $API/campaigns -H "authorization: Bearer $CT" -H 'content-type: application/json' -d "$BODY")"
BC=$(jq -r .id /tmp/body.json)
check "brand name on campaign" "Kochi Bakery" "$(jq -r .brandName /tmp/body.json)"
check "sends from bakery's number" 919447012345 "$(jq -r .senderPhone /tmp/body.json)"
check "branded credits charged" 28 "$(bal $CT BRANDED)"
check "premium credits untouched" 0 "$(bal $CT PREMIUM)"
check "completes" COMPLETED "$(waitstatus $CT $BC COMPLETED)"
check "template made on bakery's number" "$BN" "$(curl -s "$API/gateway/templates?senderNumberId=$BN" "${A[@]}" | jq -r '.items[0].senderNumberId')"
check "brand without credits for premium" 400 "$(code -X POST $API/campaigns -H "authorization: Bearer $CT" -H 'content-type: application/json' -d "$(echo $BODY | jq -c '.brandId=null | .service="PREMIUM" | .numbers="9845099991"')")"
check "listed under branded" 1 "$(curl -s "$API/campaigns?service=BRANDED" -H "authorization: Bearer $CT" | jq .total)"
check "list shows brand" "Kochi Bakery" "$(curl -s "$API/campaigns?service=BRANDED" -H "authorization: Bearer $RT" | jq -r '.items[0].brandName')"
check "not under premium" 0 "$(curl -s "$API/campaigns?service=PREMIUM" -H "authorization: Bearer $CT" | jq .total)"

# --- auto responder
check "customer sees own number" "$BN" "$(curl -s $API/auto-responders -H "authorization: Bearer $CT" | jq -r '[.[].senderNumberId]|join(",")')"
check "outsider sees none" 0 "$(curl -s $API/auto-responders -H "authorization: Bearer $OT" | jq length)"
check "customer can't set premium number" 404 "$(code -X PUT $API/auto-responders/$P -H "authorization: Bearer $CT" -H 'content-type: application/json' -d '{"name":"Shop","normalMessage":"hi","isActive":true}')"
check "needs a message when on" 400 "$(code -X PUT $API/auto-responders/$BN -H "authorization: Bearer $CT" -H 'content-type: application/json' -d '{"name":"Shop","isActive":true}')"
check "save responder" 200 "$(code -X PUT $API/auto-responders/$BN -H "authorization: Bearer $CT" -H 'content-type: application/json' -d '{"name":"Shop hours","normalMessage":"Thanks for writing to Kochi Bakery! We reply 9am to 9pm.","optOutMessage":"You will not get offers from us again.","isActive":true}')"
check "update keeps one row" 200 "$(code -X PUT $API/auto-responders/$BN -H "authorization: Bearer $CT" -H 'content-type: application/json' -d '{"name":"Shop hours","normalMessage":"Thanks for writing to Kochi Bakery! We reply 9am to 9pm.","optOutMessage":"You will not get offers from us again.","isActive":true}')"
inbound() { curl -s -o /dev/null -X POST $API/gateway/test/inbound "${A[@]}" -d "{\"senderNumberId\":\"$BN\",\"from\":\"$1\",\"text\":\"$2\",\"name\":\"$3\"}"; }
autos() { curl -s "$API/inbox/$BN/$1" -H "authorization: Bearer $CT" | jq "[.messages[]|select(.direction==\"OUT\" and .auto==\"$2\")]|length"; }
inbound 919745000003 "Do you have eggless cakes?" "Meera"; sleep 2
check "auto reply sent" 1 "$(autos 919745000003 normal)"
inbound 919745000003 "Hello?" "Meera"; sleep 2
check "only once a day" 1 "$(autos 919745000003 normal)"
check "reply goes to bakery's inbox" 1 "$(curl -s "$API/inbox/conversations?service=BRANDED" -H "authorization: Bearer $CT" | jq .total)"
check "not in premium inbox" 0 "$(curl -s "$API/inbox/conversations?service=PREMIUM" -H "authorization: Bearer $CT" | jq .total)"
# 9745000000 is not on WhatsApp in test mode, so 1 credit came back
check "auto reply counted no credits, failed one refunded" 29 "$(bal $CT BRANDED)"
inbound 919745000004 "STOP" "Ravi"; sleep 2
check "STOP gets opt-out message" 1 "$(autos 919745000004 optout)"
check "STOP gets no normal reply" 0 "$(autos 919745000004 normal)"
check "STOP recorded on bakery's number" 1 "$(curl -s "$API/opt-outs?service=BRANDED&search=919745000004" -H "authorization: Bearer $CT" | jq .total)"
check "opt-out shows brand" "Kochi Bakery" "$(curl -s "$API/opt-outs?service=BRANDED&search=919745000004" -H "authorization: Bearer $CT" | jq -r '.items[0].brandName')"
curl -s -X PUT $API/auto-responders/$BN -H "authorization: Bearer $CT" -H 'content-type: application/json' -d '{"name":"Shop hours","normalMessage":"x","isActive":false}' >/dev/null
inbound 919745000005 "Hi" "Off"; sleep 2
check "switched off: no reply" 0 "$(autos 919745000005 normal)"

# --- opt-out numbers and scope
check "customer can block on own + shared numbers" true "$(curl -s $API/opt-outs/numbers -H "authorization: Bearer $CT" | jq --arg b $BN '[.[].id]|index($b) != null and length == 2')"
check "outsider: shared number only" "PREMIUM" "$(curl -s $API/opt-outs/numbers -H "authorization: Bearer $OT" | jq -r '[.[].service]|unique|join(",")')"
check "outsider can't block on bakery's number" 404 "$(code -X POST $API/opt-outs -H "authorization: Bearer $OT" -H 'content-type: application/json' -d '{"senderNumberId":"'$BN'","phone":"9745000099"}')"
check "outsider can't use spare number" 404 "$(code -X POST $API/opt-outs -H "authorization: Bearer $OT" -H 'content-type: application/json' -d '{"senderNumberId":"'$BN2'","phone":"9745000099"}')"
check "customer blocks manually" 201 "$(code -X POST $API/opt-outs -H "authorization: Bearer $CT" -H 'content-type: application/json' -d '{"senderNumberId":"'$BN'","phone":"97450 00001"}')"
curl -s -X POST $API/campaigns/check -H "authorization: Bearer $CT" -H 'content-type: application/json' -d '{"service":"BRANDED","brandId":"'$B1'","numbers":'"$(nums 0 12)"'}' > /tmp/chk.json
check "STOP and manual blocks left out of branded" 2 "$(jq .optedOut /tmp/chk.json)"

echo; echo "$pass passed, $fail failed"; [ $fail -eq 0 ]
