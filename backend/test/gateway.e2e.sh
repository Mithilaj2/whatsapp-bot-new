#!/usr/bin/env bash
# End-to-end checks for Phase 3: numbers, templates, queue, retries, webhooks, test mode
API=http://localhost:4000/api
FAKE=http://localhost:4900
SECRET=testsecret
pass=0; fail=0
check() { if [ "$2" == "$3" ]; then echo "PASS  $1"; pass=$((pass+1)); else echo "FAIL  $1 (expected $2, got $3)"; fail=$((fail+1)); fi; }
code() { curl -s -o /tmp/body.json -w '%{http_code}' "$@"; }
login() { curl -s -X POST $API/auth/login -H 'content-type: application/json' -d "{\"username\":\"$1\",\"password\":\"$2\"}" | jq -r .accessToken; }
ADMIN=$(login admin 'TestAdmin#2026'); A=(-H "authorization: Bearer $ADMIN" -H 'content-type: application/json')
post() { curl -s -X POST "$API$1" "${A[@]}" -d "$2"; }
msg() { curl -s "$API/gateway/messages/$1" "${A[@]}"; }
# Wait until a message reaches one of the given statuses (max ~20s)
waitfor() { for i in $(seq 1 40); do s=$(msg $1 | jq -r .status); [[ " $2 " == *" $s "* ]] && { echo $s; return; }; sleep 0.5; done; echo "$s"; }
# Send a webhook to our API, signed like Meta does (or unsigned with $2=nosig)
hook() {
  local sig; sig="sha256=$(printf '%s' "$1" | openssl dgst -sha256 -hmac $SECRET | sed 's/^.* //')"
  [ "$2" == "nosig" ] && sig="sha256=bad"
  curl -s -o /dev/null -w '%{http_code}' -X POST $API/webhooks/meta -H 'content-type: application/json' -H "x-hub-signature-256: $sig" --data-binary "$1"
}
curl -s $FAKE/__reset >/dev/null

check "setup: app secret set" true "$(curl -s $API/gateway/setup "${A[@]}" | jq .appSecretSet)"
check "setup: worker running" true "$(curl -s $API/gateway/setup "${A[@]}" | jq .workerRunning)"

# --- numbers
check "add Meta number" 201 "$(code -X POST $API/gateway/numbers "${A[@]}" -d '{"label":"Platform +1","provider":"META","service":"PREMIUM","phoneNumber":"+1 555 010 0001","phoneNumberId":"1111222233","wabaId":"9999888877","accessToken":"good-token-abcdefghijklmnop","isDefault":true,"ratePerSecond":50}')"
META_N=$(jq -r .id /tmp/body.json)
check "connection checked: verified name" "We Brand 360" "$(jq -r .displayName /tmp/body.json)"
check "token never returned" "****mnop" "$(jq -r .accessToken /tmp/body.json)"
check "token stored encrypted" 0 "$(psql -h /tmp -U postgres -d webrand360 -tAc "select count(*) from sender_numbers where access_token_enc like '%good-token%'")"
check "duplicate number rejected" 409 "$(code -X POST $API/gateway/numbers "${A[@]}" -d '{"label":"Dup","provider":"META","service":"PREMIUM","phoneNumber":"15550100001","phoneNumberId":"1111222233","wabaId":"9999888877"}')"
check "add number with wrong token" 201 "$(code -X POST $API/gateway/numbers "${A[@]}" -d '{"label":"Broken","provider":"META","service":"BRANDED","phoneNumber":"15550100002","phoneNumberId":"4444555566","wabaId":"9999888877","accessToken":"bad-token-abcdefghijklmnopq"}')"
BAD_N=$(jq -r .id /tmp/body.json)
check "wrong token shows error on number" true "$(jq -r .lastError /tmp/body.json | grep -qi 'access token' && echo true)"
check "add test-mode number" 201 "$(code -X POST $API/gateway/numbers "${A[@]}" -d '{"label":"Demo","provider":"TEST","service":"PREMIUM","phoneNumber":"15550109999"}')"
TEST_N=$(jq -r .id /tmp/body.json)

R=$(curl -s -X POST $API/accounts "${A[@]}" -d '{"username":"gwres","name":"GW Reseller","type":"RESELLER","password":"GwRes#1234"}' | jq -r .id)
RT=$(login gwres 'GwRes#1234')
check "reseller cannot see numbers" 403 "$(code $API/gateway/numbers -H "authorization: Bearer $RT")"
check "webhook endpoint needs no login" 401 "$(hook '{"object":"whatsapp_business_account","entry":[]}' nosig)"

# --- webhook verification
check "webhook verify ok" "abc123" "$(curl -s "$API/webhooks/meta?hub.mode=subscribe&hub.verify_token=verify123&hub.challenge=abc123")"
check "webhook verify wrong token" 403 "$(code "$API/webhooks/meta?hub.mode=subscribe&hub.verify_token=nope&hub.challenge=abc123")"

# --- templates
check "template needs sample values" 400 "$(code -X POST $API/gateway/templates "${A[@]}" -d "{\"senderNumberId\":\"$META_N\",\"name\":\"offer\",\"category\":\"MARKETING\",\"body\":\"Hi {{1}}, 20% off\"}")"
check "create template with image + buttons" 201 "$(code -X POST $API/gateway/templates "${A[@]}" -d "{\"senderNumberId\":\"$META_N\",\"name\":\"Diwali Offer\",\"category\":\"MARKETING\",\"header\":{\"type\":\"IMAGE\",\"exampleUrl\":\"$FAKE/img.jpg\"},\"body\":\"Hi {{1}}, get {{2}} off this Diwali!\",\"bodyExamples\":[\"Ravi\",\"20%\"],\"footer\":\"Reply STOP to unsubscribe\",\"buttons\":[{\"type\":\"PHONE_NUMBER\",\"text\":\"Call now\",\"phone\":\"98989 89898\"},{\"type\":\"URL\",\"text\":\"Visit\",\"url\":\"https://example.com\"}]}")"
TPL=$(jq -r .id /tmp/body.json); TPL_PID=$(jq -r .providerTemplateId /tmp/body.json)
check "name cleaned for Meta" diwali_offer "$(jq -r .name /tmp/body.json)"
check "template pending" PENDING "$(jq -r .status /tmp/body.json)"
SENT_TPL=$(curl -s $FAKE/__calls | jq '[.[]|select(.path|endswith("/message_templates"))][-1].body')
check "image sample uploaded, handle sent" HANDLE-123 "$(echo "$SENT_TPL" | jq -r '.components[0].example.header_handle[0]')"
check "call button phone with +" "+919898989898" "$(echo "$SENT_TPL" | jq -r '.components[]|select(.type=="BUTTONS").buttons[0].phone_number')"
check "body sample values sent" '["Ravi","20%"]' "$(echo "$SENT_TPL" | jq -c '.components[]|select(.type=="BODY").example.body_text[0]')"

check "cannot send with pending template" 400 "$(code -X POST $API/gateway/numbers/$META_N/test "${A[@]}" -d "{\"to\":\"9845662183\",\"templateId\":\"$TPL\",\"bodyParams\":[\"Ravi\",\"20%\"]}")"

APPROVE="{\"object\":\"whatsapp_business_account\",\"entry\":[{\"id\":\"9999888877\",\"changes\":[{\"field\":\"message_template_status_update\",\"value\":{\"event\":\"APPROVED\",\"message_template_id\":$TPL_PID,\"message_template_name\":\"diwali_offer\",\"message_template_language\":\"en\",\"reason\":\"NONE\"}}]}]}"
check "unsigned webhook refused" 401 "$(hook "$APPROVE" nosig)"
check "template still pending" PENDING "$(curl -s "$API/gateway/templates?senderNumberId=$META_N" "${A[@]}" | jq -r '.items[0].status')"
check "signed approval webhook accepted" 200 "$(hook "$APPROVE")"
check "template approved" APPROVED "$(curl -s "$API/gateway/templates?senderNumberId=$META_N" "${A[@]}" | jq -r '.items[0].status')"

# --- sending
check "invalid phone rejected" 400 "$(code -X POST $API/gateway/numbers/$META_N/test "${A[@]}" -d "{\"to\":\"12345\",\"templateId\":\"$TPL\"}")"
M1=$(post /gateway/numbers/$META_N/test "{\"to\":\"98456 62183\",\"templateId\":\"$TPL\",\"bodyParams\":[\"Ravi\",\"20%\"]}" | jq -r .id)
check "message sent" SENT "$(waitfor $M1 'SENT FAILED')"
check "number normalised to +91" 919845662183 "$(msg $M1 | jq -r .contactPhone)"
check "body rendered for inbox" "Hi Ravi, get 20% off this Diwali!" "$(msg $M1 | jq -r .body)"
LAST=$(curl -s $FAKE/__calls | jq '[.[]|select(.path|endswith("/messages"))][-1].body')
check "template params sent to Meta" '["Ravi","20%"]' "$(echo "$LAST" | jq -c '[.template.components[]|select(.type=="body").parameters[].text]')"
check "header image sent" "$FAKE/img.jpg" "$(echo "$LAST" | jq -r '.template.components[]|select(.type=="header").parameters[0].image.link')"
WAMID=$(msg $M1 | jq -r .providerMessageId)
NOW=$(date +%s)
st() { echo "{\"object\":\"whatsapp_business_account\",\"entry\":[{\"id\":\"9999888877\",\"changes\":[{\"field\":\"messages\",\"value\":{\"messaging_product\":\"whatsapp\",\"metadata\":{\"phone_number_id\":\"1111222233\"},\"statuses\":[{\"id\":\"$1\",\"status\":\"$2\",\"timestamp\":\"$NOW\",\"recipient_id\":\"919845662183\"$3}]}}]}]}"; }
hook "$(st $WAMID delivered)" >/dev/null; hook "$(st $WAMID read)" >/dev/null
check "read via webhook" READ "$(msg $M1 | jq -r .status)"
hook "$(st $WAMID delivered)" >/dev/null
check "late 'delivered' doesn't go backwards" READ "$(msg $M1 | jq -r .status)"
check "read time saved" true "$(msg $M1 | jq '.readAt != null and .deliveredAt != null')"

M2=$(post /gateway/numbers/$META_N/test "{\"to\":\"+91 98450 02222\",\"templateId\":\"$TPL\",\"bodyParams\":[\"A\",\"B\"]}" | jq -r .id)
check "throttled message retried and sent" SENT "$(waitfor $M2 'SENT FAILED')"
check "took 3 attempts" 3 "$(msg $M2 | jq .attempts)"

M3=$(post /gateway/numbers/$META_N/test "{\"to\":\"+91 98450 03333\",\"templateId\":\"$TPL\",\"bodyParams\":[\"A\",\"B\"]}" | jq -r .id)
check "permanent error fails at once" FAILED "$(waitfor $M3 'SENT FAILED')"
check "Meta error code kept" 132001 "$(msg $M3 | jq -r .errorCode)"
check "only 1 attempt" 1 "$(msg $M3 | jq .attempts)"

M4=$(post /gateway/numbers/$BAD_N/test '{"to":"+91 98450 04444","text":"hello"}' | jq -r .id)
check "bad token fails" FAILED "$(waitfor $M4 'SENT FAILED')"
check "bad token code 190" 190 "$(msg $M4 | jq -r .errorCode)"

FAILHOOK=$(st $WAMID failed ',"errors":[{"code":131026,"title":"Message undeliverable","error_data":{"details":"Receiver is incapable"}}]')
M5=$(post /gateway/numbers/$META_N/test "{\"to\":\"+91 98450 06666\",\"templateId\":\"$TPL\",\"bodyParams\":[\"A\",\"B\"]}" | jq -r .id)
waitfor $M5 'SENT' >/dev/null
W5=$(msg $M5 | jq -r .providerMessageId)
hook "$(st $W5 failed ',"errors":[{"code":131026,"title":"Message undeliverable","error_data":{"details":"Receiver is incapable"}}]')" >/dev/null
check "failure from webhook" FAILED "$(msg $M5 | jq -r .status)"
check "failure reason kept" "Receiver is incapable" "$(msg $M5 | jq -r .errorMessage)"

# --- inbound reply
IN="{\"object\":\"whatsapp_business_account\",\"entry\":[{\"id\":\"9999888877\",\"changes\":[{\"field\":\"messages\",\"value\":{\"messaging_product\":\"whatsapp\",\"metadata\":{\"phone_number_id\":\"1111222233\"},\"contacts\":[{\"profile\":{\"name\":\"Santhosh Kumar\"},\"wa_id\":\"919845662183\"}],\"messages\":[{\"from\":\"919845662183\",\"id\":\"wamid.IN1\",\"timestamp\":\"$NOW\",\"type\":\"text\",\"text\":{\"body\":\"Hai\"},\"context\":{\"id\":\"$WAMID\"}}]}}]}]}"
check "reply webhook accepted" 200 "$(hook "$IN")"
hook "$IN" >/dev/null
check "reply saved once (duplicates ignored)" 1 "$(curl -s "$API/gateway/messages?direction=IN" "${A[@]}" | jq '[.items[]|select(.providerMessageId=="wamid.IN1")]|length')"
check "reply text and name" "Hai|Santhosh Kumar" "$(curl -s "$API/gateway/messages?direction=IN" "${A[@]}" | jq -r '.items[0]|"\(.body)|\(.contactName)"')"

# --- speed limit: 5 per second
curl -s -X PATCH $API/gateway/numbers/$META_N "${A[@]}" -d '{"ratePerSecond":5}' >/dev/null
curl -s $FAKE/__reset >/dev/null
for i in $(seq 10 29); do post /gateway/numbers/$META_N/test "{\"to\":\"+91 98450 100$i\",\"templateId\":\"$TPL\",\"bodyParams\":[\"A\",\"B\"]}" >/dev/null; done
sleep 7
SPAN=$(curl -s $FAKE/__calls | jq '[.[]|select(.path|endswith("/messages"))|.t] | (max - min)')
COUNT=$(curl -s $FAKE/__calls | jq '[.[]|select(.path|endswith("/messages"))]|length')
check "20 messages sent" 20 "$COUNT"
check "spread over >= 3.6s at 5/s" true "$([ "$SPAN" -ge 3600 ] && echo true)"

# --- test mode
check "test template submitted" 201 "$(code -X POST $API/gateway/templates "${A[@]}" -d "{\"senderNumberId\":\"$TEST_N\",\"name\":\"demo\",\"category\":\"MARKETING\",\"body\":\"Hello from the demo\"}")"
TT=$(jq -r .id /tmp/body.json); sleep 1.5
check "test template auto-approved" APPROVED "$(curl -s "$API/gateway/templates?senderNumberId=$TEST_N" "${A[@]}" | jq -r '.items[0].status')"
T1=$(post /gateway/numbers/$TEST_N/test "{\"to\":\"9845662183\",\"templateId\":\"$TT\"}" | jq -r .id)
check "test mode reaches READ" READ "$(waitfor $T1 'READ FAILED')"
T2=$(post /gateway/numbers/$TEST_N/test "{\"to\":\"9845660000\",\"templateId\":\"$TT\"}" | jq -r .id)
check "test mode 0000 fails" FAILED "$(waitfor $T2 'FAILED READ')"
check "simulate reply" 201 "$(code -X POST $API/gateway/test/inbound "${A[@]}" -d "{\"senderNumberId\":\"$TEST_N\",\"from\":\"919845662183\",\"text\":\"STOP\",\"name\":\"Seleniel\"}")"
sleep 0.5
check "simulated reply stored" STOP "$(curl -s "$API/gateway/messages?direction=IN&senderNumberId=$TEST_N" "${A[@]}" | jq -r '.items[0].body')"
check "webhook log kept" true "$([ $(psql -h /tmp -U postgres -d webrand360 -tAc 'select count(*) from webhook_events') -gt 5 ] && echo true)"

echo; echo "$pass passed, $fail failed"
