#!/usr/bin/env bash
# End-to-end checks for Phase 1 API rules
API=http://localhost:4000/api
pass=0; fail=0
check() { # name expected actual
  if [ "$2" == "$3" ]; then echo "PASS  $1"; pass=$((pass+1)); else echo "FAIL  $1 (expected $2, got $3)"; fail=$((fail+1)); fi
}
code() { curl -s -o /tmp/body.json -w '%{http_code}' "$@"; }
login() { curl -s -X POST $API/auth/login -H 'content-type: application/json' -d "{\"username\":\"$1\",\"password\":\"$2\"}" | jq -r .accessToken; }

check "no token -> 401" 401 "$(code $API/accounts)"
check "wrong password -> 401" 401 "$(code -X POST $API/auth/login -H 'content-type: application/json' -d '{"username":"admin","password":"nope"}')"

ADMIN=$(login admin 'TestAdmin#2026'); A=(-H "authorization: Bearer $ADMIN" -H 'content-type: application/json')
check "admin login" true "$([ ${#ADMIN} -gt 20 ] && echo true)"

check "admin creates reseller" 201 "$(code -X POST $API/accounts "${A[@]}" -d '{"username":"ChannelSoftech","name":"Channel Softech","type":"RESELLER","password":"Reseller#123","domain":"https://App.WeBrand360.com/login","brandName":"We Brand 360"}')"
RID=$(jq -r .id /tmp/body.json); check "username lowercased" channelsoftech "$(jq -r .username /tmp/body.json)"
check "domain normalised" app.webrand360.com "$(jq -r .domain /tmp/body.json)"
check "duplicate username -> 409" 409 "$(code -X POST $API/accounts "${A[@]}" -d '{"username":"channelsoftech","name":"Xx","type":"CUSTOMER","password":"Customer#123"}')"
check "short password -> 400" 400 "$(code -X POST $API/accounts "${A[@]}" -d '{"username":"x1","name":"Xy","type":"CUSTOMER","password":"short"}')"

RES=$(login channelsoftech 'Reseller#123'); R=(-H "authorization: Bearer $RES" -H 'content-type: application/json')
check "reseller creates customer" 201 "$(code -X POST $API/accounts "${R[@]}" -d '{"username":"iitb","name":"IIT Bombay","type":"CUSTOMER","password":"Customer#123"}')"
CID=$(jq -r .id /tmp/body.json)
check "reseller creates sub-reseller" 201 "$(code -X POST $API/accounts "${R[@]}" -d '{"username":"subres","name":"Sub Reseller","type":"RESELLER","password":"SubRes#1234"}')"
SID=$(jq -r .id /tmp/body.json)
check "reseller creates customer under sub-reseller" 201 "$(code -X POST $API/accounts "${R[@]}" -d "{\"username\":\"shop1\",\"name\":\"Shop One\",\"type\":\"CUSTOMER\",\"password\":\"Customer#123\",\"parentId\":\"$SID\"}")"
check "shop1 parent is subres" subres "$(jq -r .parent.username /tmp/body.json)"
check "cannot put account under a customer" 400 "$(code -X POST $API/accounts "${R[@]}" -d "{\"username\":\"bad1\",\"name\":\"Bad\",\"type\":\"CUSTOMER\",\"password\":\"Customer#123\",\"parentId\":\"$CID\"}")"

check "reseller list total (excludes self)" 3 "$(curl -s "$API/accounts" "${R[@]}" | jq .total)"
check "reseller list does not include itself" 0 "$(curl -s "$API/accounts?pageSize=50" "${R[@]}" | jq '[.items[]|select(.username=="channelsoftech")]|length')"
check "filter customers" 2 "$(curl -s "$API/accounts?type=CUSTOMER" "${R[@]}" | jq .total)"
check "search shop" 1 "$(curl -s "$API/accounts?search=shop" "${R[@]}" | jq .total)"
check "stats resellers" 1 "$(curl -s "$API/accounts/stats" "${R[@]}" | jq .resellers)"
check "stats customers" 2 "$(curl -s "$API/accounts/stats" "${R[@]}" | jq .customers)"
check "tree has 4 nodes" 4 "$(curl -s "$API/accounts/tree" "${R[@]}" | jq length)"
check "admin sees all 4" 4 "$(curl -s "$API/accounts" "${A[@]}" | jq .total)"

SUB=$(login subres 'SubRes#1234'); S=(-H "authorization: Bearer $SUB" -H 'content-type: application/json')
check "sub-reseller sees only its own customer" 1 "$(curl -s "$API/accounts" "${S[@]}" | jq .total)"
check "sub-reseller cannot see iitb" 404 "$(code "$API/accounts/$CID" "${S[@]}")"
check "sub-reseller cannot edit parent" 404 "$(code -X PATCH "$API/accounts/$RID" "${S[@]}" -d '{"name":"hacked"}')"
check "reseller cannot edit itself here" 403 "$(code -X PATCH "$API/accounts/$RID" "${R[@]}" -d '{"name":"hacked"}')"

CUS=$(login iitb 'Customer#123'); C=(-H "authorization: Bearer $CUS" -H 'content-type: application/json')
check "customer cannot list accounts" 403 "$(code "$API/accounts" "${C[@]}")"
check "customer cannot create" 403 "$(code -X POST $API/accounts "${C[@]}" -d '{"username":"zz1","name":"Zz","type":"CUSTOMER","password":"Customer#123"}')"
check "customer /auth/me shows parent" channelsoftech "$(curl -s $API/auth/me "${C[@]}" | jq -r .account.parent.username)"

check "reseller resets customer password" 200 "$(code -X PATCH "$API/accounts/$CID" "${R[@]}" -d '{"password":"NewPass#456"}')"
check "old password stops working" 401 "$(code -X POST $API/auth/login -H 'content-type: application/json' -d '{"username":"iitb","password":"Customer#123"}')"
check "suspend customer" SUSPENDED "$(curl -s -X PATCH "$API/accounts/$CID" "${R[@]}" -d '{"status":"SUSPENDED"}' | jq -r .status)"
check "suspended customer token rejected" 401 "$(code $API/auth/me "${C[@]}")"
check "suspended customer cannot log in" 401 "$(code -X POST $API/auth/login -H 'content-type: application/json' -d '{"username":"iitb","password":"NewPass#456"}')"

check "delete reseller with children blocked" 400 "$(code -X DELETE "$API/accounts/$SID" "${R[@]}")"
SHOP=$(curl -s "$API/accounts?search=shop1" "${R[@]}" | jq -r '.items[0].id')
check "delete shop1" 200 "$(code -X DELETE "$API/accounts/$SHOP" "${R[@]}")"
check "now delete subres" 200 "$(code -X DELETE "$API/accounts/$SID" "${R[@]}")"
check "deleted accounts hidden" 1 "$(curl -s "$API/accounts" "${R[@]}" | jq .total)"

check "countries total" 252 "$(curl -s "$API/countries" "${R[@]}" | jq .total)"
check "search +91 -> India" India "$(curl -s "$API/countries?search=%2B91" "${R[@]}" | jq -r '.items[0].name')"
IN=$(curl -s "$API/countries?search=India" "${R[@]}" | jq -r '.items[]|select(.code=="IN")|.id')
check "reseller cannot change country" 403 "$(code -X PATCH "$API/countries/$IN" "${R[@]}" -d '{"isActive":false}')"
check "admin deactivates country" false "$(curl -s -X PATCH "$API/countries/$IN" "${A[@]}" -d '{"isActive":false}' | jq .isActive)"
check "inactive filter" 1 "$(curl -s "$API/countries?status=inactive" "${A[@]}" | jq .total)"
curl -s -X PATCH "$API/countries/$IN" "${A[@]}" -d '{"isActive":true}' >/dev/null

check "branding by reseller domain" "We Brand 360" "$(curl -s "$API/public/branding?host=app.webrand360.com:443" | jq -r .brandName)"
check "branding default" "We Brand 360" "$(curl -s "$API/public/branding?host=unknown.com" | jq -r .brandName)"

echo; echo "$pass passed, $fail failed"
