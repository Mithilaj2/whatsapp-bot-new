#!/usr/bin/env bash
# End-to-end checks for Phase 6: Bot Studio (flows, live replies, handoff, AI answers).
# Run after the other suites. API .env: ANTHROPIC_API_KEY="test-ai-key", AI_API_URL="http://localhost:4900"
# (the fake server answers like the AI), TEST_PROVIDER_SPEED=3.
API=http://localhost:4000/api
pass=0; fail=0
check() { if [ "$2" == "$3" ]; then echo "PASS  $1"; pass=$((pass+1)); else echo "FAIL  $1 (expected $2, got $3)"; fail=$((fail+1)); fi; }
code() { curl -s -o /tmp/body.json -w '%{http_code}' "$@"; }
login() { curl -s -X POST $API/auth/login -H 'content-type: application/json' -d "{\"username\":\"$1\",\"password\":\"$2\"}" | jq -r .accessToken; }
ADMIN=$(login admin 'TestAdmin#2026'); A=(-H "authorization: Bearer $ADMIN" -H 'content-type: application/json')
mkacc() { curl -s -X POST $API/accounts -H "authorization: Bearer $1" -H 'content-type: application/json' -d "$2" | jq -r .id; }

RS=$(mkacc $ADMIN '{"username":"botagency","name":"Bot Agency","type":"RESELLER","password":"Agency#1234"}'); RT=$(login botagency 'Agency#1234')
CU=$(mkacc $RT '{"username":"spicecafe","name":"Spice Cafe","type":"CUSTOMER","password":"Spice#12345"}'); CT=$(login spicecafe 'Spice#12345')
OU=$(mkacc $ADMIN '{"username":"botoutsider","name":"Outsider","type":"CUSTOMER","password":"Outsider#123"}'); OT=$(login botoutsider 'Outsider#123')
C=(-H "authorization: Bearer $CT" -H 'content-type: application/json')
O=(-H "authorization: Bearer $OT" -H 'content-type: application/json')
NUM=$(curl -s -X POST $API/gateway/numbers "${A[@]}" -d '{"label":"Spice Cafe","provider":"TEST","service":"BRANDED","phoneNumber":"15550104444","ownerAccountId":"'$CU'"}' | jq -r .id)
ONUM=$(curl -s -X POST $API/gateway/numbers "${A[@]}" -d '{"label":"Outsider","provider":"TEST","service":"BRANDED","phoneNumber":"15550104445","ownerAccountId":"'$OU'"}' | jq -r .id)

check "AI switched on" true "$(curl -s $API/bots/settings "${C[@]}" | jq .aiAvailable)"
check "customer sees own number only" "$NUM" "$(curl -s $API/bots/numbers "${C[@]}" | jq -r '[.[].id]|join(",")')"

# --- create with a starter flow
check "create bot" 201 "$(code -X POST $API/bots "${C[@]}" -d '{"name":"Cafe assistant"}')"
BOT=$(jq -r .id /tmp/body.json); FLOW=$(jq -c .flow /tmp/body.json)
check "starter flow has steps" 6 "$(jq '.flow.nodes|length' /tmp/body.json)"
check "starter flow has no problems" 0 "$(jq '.problems|length' /tmp/body.json)"
check "starter uses the business name" true "$(jq -r '.flow.nodes[0].text' /tmp/body.json | grep -q 'Spice Cafe' && echo true)"
check "outsider can't open" 404 "$(code $API/bots/$BOT "${O[@]}")"
check "reseller sees it" 1 "$(curl -s $API/bots -H "authorization: Bearer $RT" | jq length)"

# --- test chat
sim() { curl -s -X POST $API/bots/simulate "${C[@]}" -d "{\"flow\":$FLOW,\"state\":$1,\"text\":\"$2\"${3:+,\"replyId\":\"$3\"}}"; }
R=$(sim null hi)
check "test: hi shows 3 buttons" 3 "$(echo $R | jq '.messages[0].rich.buttons|length')"
check "test: waits on welcome" welcome "$(echo $R | jq -r .state.nodeId)"
check "test: name filled in" true "$(echo $R | jq -r '.messages[0].rich.body' | grep -q 'Hi spicecafe' && echo true)"
R=$(sim "$(echo $R | jq -c .state)" "Get a callback" "welcome:o2")
check "test: button leads to question" "Sure! What is your name?" "$(echo $R | jq -r '.messages[0].text')"
R=$(sim "$(echo $R | jq -c .state)" "Asha")
check "test: answer used in next step" true "$(echo $R | jq -r '.messages[0].text' | grep -q 'Thanks Asha' && echo true)"
R2=$(sim "$(echo $R | jq -c .state)" "call me maybe")
check "test: bad phone asked again" "Please send a valid phone number." "$(echo $R2 | jq -r '.messages[0].text')"
check "test: still on the question" ask_phone "$(echo $R2 | jq -r .state.nodeId)"
R=$(sim "$(echo $R | jq -c .state)" "+91 98450 12345")
check "test: finished" COMPLETED "$(echo $R | jq -r .state.status)"
check "test: answers kept" "Asha|+91 98450 12345" "$(echo $R | jq -r '"\(.state.vars.customer_name)|\(.state.vars.callback_phone)"')"
R=$(sim '{"status":"ACTIVE","nodeId":"welcome","vars":{}}' "2")
check "test: typing the option number works" ask_name "$(echo $R | jq -r .state.nodeId)"
R=$(sim '{"status":"ACTIVE","nodeId":"ask_name","vars":{}}' "menu")
check "test: keyword leaves a question" welcome "$(echo $R | jq -r .state.nodeId)"

# --- checks before going live
check "can't go live without a number" 400 "$(code -X PATCH $API/bots/$BOT "${C[@]}" -d '{"isActive":true}')"
check "can't use someone else's number" 404 "$(code -X PATCH $API/bots/$BOT "${C[@]}" -d '{"senderNumberId":"'$ONUM'"}')"
BAD=$(echo $FLOW | jq -c '.nodes[0].options[0].title="This title is far too long for WhatsApp"')
check "too-long button can't go live" 400 "$(code -X PATCH $API/bots/$BOT "${C[@]}" -d '{"senderNumberId":"'$NUM'","isActive":true,"flow":'"$BAD"'}')"
check "error names the problem" true "$(jq -r .message /tmp/body.json | grep -q 'longer than 20' && echo true)"
BROKEN=$(echo $FLOW | jq -c '.nodes[1].next="nowhere"')
check "broken link reported" true "$(curl -s -X PATCH $API/bots/$BOT "${C[@]}" -d '{"flow":'"$BROKEN"'}' | jq -r '.problems[0]' | grep -q 'no longer exists' && echo true)"
check "go live" 200 "$(code -X PATCH $API/bots/$BOT "${C[@]}" -d '{"senderNumberId":"'$NUM'","isActive":true,"flow":'"$FLOW"'}')"
check "live" true "$(jq .isActive /tmp/body.json)"
BOT2=$(curl -s -X POST $API/bots "${C[@]}" -d '{"name":"Second"}' | jq -r .id)
check "one live bot per number" 409 "$(code -X PATCH $API/bots/$BOT2 "${C[@]}" -d '{"senderNumberId":"'$NUM'","isActive":true}')"

# --- live chat
say() { curl -s -o /dev/null -X POST $API/gateway/test/inbound "${A[@]}" -d "{\"senderNumberId\":\"$NUM\",\"from\":\"$1\",\"text\":\"$2\",\"name\":\"$3\"${4:+,\"replyId\":\"$4\"}}"; sleep 1.5; }
thread() { curl -s "$API/inbox/$NUM/$1" "${C[@]}"; }
botmsgs() { thread $1 | jq '[.messages[]|select(.direction=="OUT" and .bot)]|length'; }
P1=919800000001
say $P1 "Hi" "Meera"
check "bot answered with buttons" INTERACTIVE "$(thread $P1 | jq -r '[.messages[]|select(.direction=="OUT")][-1].kind')"
check "buttons shown in inbox text" true "$(thread $P1 | jq -r '[.messages[]|select(.direction=="OUT")][-1].body' | grep -q '\[Get a callback\]' && echo true)"
say $P1 "Get a callback" "Meera" "welcome:o2"
say $P1 "Meera Nair" "Meera"
say $P1 "98450 77777" "Meera"
check "4 bot messages" 4 "$(botmsgs $P1)"
check "thanks with the number" true "$(thread $P1 | jq -r '[.messages[]|select(.direction=="OUT")][-1].body' | grep -q '98450 77777' && echo true)"
curl -s "$API/bots/$BOT/sessions" "${C[@]}" > /tmp/s.json
check "one chat recorded" 1 "$(jq .total /tmp/s.json)"
check "finished" COMPLETED "$(jq -r '.items[0].status' /tmp/s.json)"
check "answers saved" "Meera Nair|98450 77777|Get a callback" "$(jq -r '.items[0].variables|"\(.customer_name)|\(.callback_phone)|\(.welcome)"' /tmp/s.json)"
check "outsider can't see answers" 404 "$(code $API/bots/$BOT/sessions "${O[@]}")"
curl -s "$API/bots/$BOT/sessions/export" "${C[@]}" > /tmp/bot.csv
check "CSV has answer columns" true "$(head -1 /tmp/bot.csv | grep -q 'customer_name' && echo true)"
check "CSV has the lead" true "$(grep -q 'Meera Nair' /tmp/bot.csv && echo true)"

# --- talk to a person
P2=919800000002
say $P2 "hello" "Ravi"
say $P2 "Talk to us" "Ravi" "welcome:o3"
check "handoff message" true "$(thread $P2 | jq -r '[.messages[]|select(.direction=="OUT")][-1].body' | grep -q 'team will reply' && echo true)"
B=$(botmsgs $P2); say $P2 "Are you there?" "Ravi"
check "bot quiet during handoff" $B "$(botmsgs $P2)"
SID=$(curl -s "$API/bots/$BOT/sessions?status=HANDOFF" "${C[@]}" | jq -r '.items[0].id')
check "listed as waiting for team" true "$([ "$SID" != null ] && echo true)"
check "end handoff" 201 "$(code -X POST $API/bots/sessions/$SID/end "${C[@]}")"
say $P2 "hi" "Ravi"
check "bot back on" $((B+1)) "$(botmsgs $P2)"

# --- AI fallback
AIFLOW=$(echo $FLOW | jq -c '.fallback={"mode":"AI"} | .ai={"knowledge":"Opening hours: 8 am to 11 pm every day\nDelivery: free within 5 km of MG Road","noAnswerText":"Let me check with the team and get back to you."}')
check "switch to AI fallback" 200 "$(code -X PATCH $API/bots/$BOT "${C[@]}" -d '{"flow":'"$AIFLOW"'}')"
P3=919800000003
say $P3 "What are your opening hours?" "Anu"; sleep 1
last() { thread $1 | jq -r '[.messages[]|select(.direction=="OUT")][-1]'; }
check "AI answers from the info" true "$(last $P3 | jq -r .body | grep -q '8 am to 11 pm' && echo true)"
check "marked as AI" true "$(last $P3 | jq .ai)"
say $P3 "Do you sell bicycles?" "Anu"; sleep 1
check "no answer: polite message" "Let me check with the team and get back to you." "$(last $P3 | jq -r .body)"
check "no chat saved for AI questions" 0 "$(curl -s "$API/bots/$BOT/sessions?search=919800000003" "${C[@]}" | jq .total)"
P4=919800000004
say $P4 "hi" "Joby"
say $P4 "is delivery free here?" "Joby"; sleep 1
check "question inside menu: AI then menu again" "true|INTERACTIVE" "$(thread $P4 | jq -r '[.messages[]|select(.direction=="OUT")] | "\(.[-2].ai)|\(.[-1].kind)"')"
check "test chat uses AI too" true "$(curl -s -X POST $API/bots/simulate "${C[@]}" -d "{\"flow\":$AIFLOW,\"text\":\"when is delivery free\"}" | jq -r '.messages[0].text' | grep -q 'MG Road' && echo true)"

# --- auto responder and STOP
curl -s -o /dev/null -X PUT $API/auto-responders/$NUM "${C[@]}" -d '{"name":"Auto","normalMessage":"Thanks for writing!","optOutMessage":"Unsubscribed.","isActive":true}'
P5=919800000005
say $P5 "hi" "Lal"
check "bot answers instead of auto reply" 0 "$(thread $P5 | jq '[.messages[]|select(.auto=="normal")]|length')"
B=$(botmsgs $P5); say $P5 "STOP" "Lal"
check "STOP: no bot reply" $B "$(botmsgs $P5)"
check "STOP: opt-out reply still sent" 1 "$(thread $P5 | jq '[.messages[]|select(.auto=="optout")]|length')"

# --- list and delete
check "list shows chats" true "$(curl -s $API/bots "${C[@]}" | jq --arg b $BOT '.[]|select(.id==$b)|.chats >= 4')"
check "can't delete a live bot" 400 "$(code -X DELETE $API/bots/$BOT "${C[@]}")"
curl -s -o /dev/null -X PATCH $API/bots/$BOT "${C[@]}" -d '{"isActive":false}'
P6=919800000006; say $P6 "hi" "Off"
check "bot off: auto responder back" 1 "$(thread $P6 | jq '[.messages[]|select(.auto=="normal")]|length')"
check "delete" 200 "$(code -X DELETE $API/bots/$BOT "${C[@]}")"

echo; echo "$pass passed, $fail failed"; [ $fail -eq 0 ]
