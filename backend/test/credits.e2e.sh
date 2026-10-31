#!/usr/bin/env bash
# End-to-end checks for Phase 2 credits rules
API=http://localhost:4000/api
pass=0; fail=0
check() { if [ "$2" == "$3" ]; then echo "PASS  $1"; pass=$((pass+1)); else echo "FAIL  $1 (expected $2, got $3)"; fail=$((fail+1)); fi; }
code() { curl -s -o /tmp/body.json -w '%{http_code}' "$@"; }
login() { curl -s -X POST $API/auth/login -H 'content-type: application/json' -d "{\"username\":\"$1\",\"password\":\"$2\"}" | jq -r .accessToken; }
mk() { # token-array-name json -> id
  curl -s -X POST $API/accounts -H "authorization: Bearer $1" -H 'content-type: application/json' -d "$2" | jq -r .id; }
txn() { code -X POST $API/credits/transactions -H "authorization: Bearer $1" -H 'content-type: application/json' -d "$2"; }
bal() { # token accountId service -> premium IN balance
  curl -s "$API/credits/balances?accountId=$2&service=${3:-PREMIUM}" -H "authorization: Bearer $1" | jq '[.items[]|select(.countryCode=="IN")|.balance]|add // 0'; }

ADMIN=$(login admin 'TestAdmin#2026')
AG=$(mk $ADMIN '{"username":"agencyx","name":"Agency X","type":"RESELLER","password":"Agency#1234"}')
AGT=$(login agencyx 'Agency#1234')
CA=$(mk $AGT '{"username":"cust_a","name":"Customer A","type":"CUSTOMER","password":"CustA#1234"}')
SUB=$(mk $AGT '{"username":"subx","name":"Sub X","type":"RESELLER","password":"SubX#12345"}')
SUBT=$(login subx 'SubX#12345')
CB=$(mk $SUBT '{"username":"cust_b","name":"Customer B","type":"CUSTOMER","password":"CustB#1234"}')
CAT=$(login cust_a 'CustA#1234')

check "admin adds 50,000 to agencyx" 201 "$(txn $ADMIN "{\"accountId\":\"$AG\",\"service\":\"PREMIUM\",\"countryCode\":\"in\",\"direction\":\"GIVE\",\"amount\":50000,\"remarks\":\"Opening stock\"}")"
check "row type CREDIT" CREDIT "$(jq -r '.transactions[0].type' /tmp/body.json)"
check "agencyx balance 50000" 50000 "$(bal $AGT $AG)"

check "agencyx gives 5 to direct customer" 201 "$(txn $AGT "{\"accountId\":\"$CA\",\"service\":\"PREMIUM\",\"countryCode\":\"IN\",\"direction\":\"GIVE\",\"amount\":5}")"
check "two ledger rows (out + in)" 2 "$(jq '.transactions|length' /tmp/body.json)"
check "agencyx 49995" 49995 "$(bal $AGT $AG)"
check "cust_a 5" 5 "$(bal $AGT $CA)"

check "cannot give to grandchild" 403 "$(txn $AGT "{\"accountId\":\"$CB\",\"service\":\"PREMIUM\",\"countryCode\":\"IN\",\"direction\":\"GIVE\",\"amount\":1}")"
check "cannot give more than balance" 400 "$(txn $AGT "{\"accountId\":\"$CA\",\"service\":\"PREMIUM\",\"countryCode\":\"IN\",\"direction\":\"GIVE\",\"amount\":60000}")"
check "error says not enough credits" true "$(jq -r .message /tmp/body.json | grep -q 'Not enough credits' && echo true)"
check "balance unchanged after failure" 49995 "$(bal $AGT $AG)"

check "agencyx takes 2 back" 201 "$(txn $AGT "{\"accountId\":\"$CA\",\"service\":\"PREMIUM\",\"countryCode\":\"IN\",\"direction\":\"TAKE\",\"amount\":2}")"
check "cust_a 3" 3 "$(bal $AGT $CA)"
check "agencyx 49997" 49997 "$(bal $AGT $AG)"
check "cannot take more than child has" 400 "$(txn $AGT "{\"accountId\":\"$CA\",\"service\":\"PREMIUM\",\"countryCode\":\"IN\",\"direction\":\"TAKE\",\"amount\":10}")"

check "branded credits are separate" 400 "$(txn $AGT "{\"accountId\":\"$CA\",\"service\":\"BRANDED\",\"countryCode\":\"IN\",\"direction\":\"GIVE\",\"amount\":1}")"
check "amount 0 rejected" 400 "$(txn $AGT "{\"accountId\":\"$CA\",\"service\":\"PREMIUM\",\"countryCode\":\"IN\",\"direction\":\"GIVE\",\"amount\":0}")"
check "fraction rejected" 400 "$(txn $AGT "{\"accountId\":\"$CA\",\"service\":\"PREMIUM\",\"countryCode\":\"IN\",\"direction\":\"GIVE\",\"amount\":1.5}")"
check "cannot transfer to self" 400 "$(txn $AGT "{\"accountId\":\"$AG\",\"service\":\"PREMIUM\",\"countryCode\":\"IN\",\"direction\":\"GIVE\",\"amount\":1}")"
check "customer cannot transfer" 403 "$(txn $CAT "{\"accountId\":\"$CA\",\"service\":\"PREMIUM\",\"countryCode\":\"IN\",\"direction\":\"GIVE\",\"amount\":1}")"
check "sub-reseller cannot touch parent" 404 "$(txn $SUBT "{\"accountId\":\"$AG\",\"service\":\"PREMIUM\",\"countryCode\":\"IN\",\"direction\":\"TAKE\",\"amount\":1}")"

AE=$(curl -s "$API/countries?search=United%20Arab" -H "authorization: Bearer $ADMIN" | jq -r '.items[0].id')
curl -s -X PATCH "$API/countries/$AE" -H "authorization: Bearer $ADMIN" -H 'content-type: application/json' -d '{"isActive":false}' >/dev/null
check "inactive country rejected" 400 "$(txn $ADMIN "{\"accountId\":\"$AG\",\"service\":\"PREMIUM\",\"countryCode\":\"AE\",\"direction\":\"GIVE\",\"amount\":1}")"
curl -s -X PATCH "$API/countries/$AE" -H "authorization: Bearer $ADMIN" -H 'content-type: application/json' -d '{"isActive":true}' >/dev/null
check "admin removes credits" 201 "$(txn $ADMIN "{\"accountId\":\"$CA\",\"service\":\"PREMIUM\",\"countryCode\":\"IN\",\"direction\":\"TAKE\",\"amount\":1}")"
check "row type DEBIT" DEBIT "$(jq -r '.transactions[0].type' /tmp/body.json)"
check "cust_a 2" 2 "$(bal $AGT $CA)"

check "customer sees only own transactions" 3 "$(curl -s "$API/credits/transactions" -H "authorization: Bearer $CAT" | jq .total)"
check "customer sees own balance only" 1 "$(curl -s "$API/credits/balances" -H "authorization: Bearer $CAT" | jq .total)"
check "sub-reseller sees nothing of agencyx" 0 "$(curl -s "$API/credits/transactions" -H "authorization: Bearer $SUBT" | jq .total)"
check "transfers category (4 rows)" 4 "$(curl -s "$API/credits/transactions?category=transfers" -H "authorization: Bearer $AGT" | jq .total)"
check "platform category (2 rows)" 2 "$(curl -s "$API/credits/transactions?category=platform" -H "authorization: Bearer $AGT" | jq .total)"
check "counterparty shown" cust_a "$(curl -s "$API/credits/transactions?accountId=$AG&category=transfers" -H "authorization: Bearer $AGT" | jq -r '.items[0].counterpartyUsername')"
check "search by remark" 1 "$(curl -s "$API/credits/transactions?search=opening" -H "authorization: Bearer $AGT" | jq .total)"
check "summary premium total" 49997 "$(curl -s "$API/credits/summary" -H "authorization: Bearer $AGT" | jq .totals.PREMIUM)"
check "csv export header" "Date,Account,Service" "$(curl -s "$API/credits/transactions/export" -H "authorization: Bearer $AGT" | head -1 | tr -d '\r\357\273\277' | cut -d, -f1-3)"
check "csv export rows" 7 "$(curl -s "$API/credits/transactions/export" -H "authorization: Bearer $AGT" | grep -c '')"

check "cannot delete account holding credits" 400 "$(code -X DELETE "$API/accounts/$CA" -H "authorization: Bearer $AGT")"

# 20 transfers of 2,500 at the same moment; agencyx has 49,997 so exactly 19 must succeed
for i in $(seq 1 20); do
  curl -s -o /dev/null -w '%{http_code}\n' -X POST $API/credits/transactions -H "authorization: Bearer $AGT" -H 'content-type: application/json' \
    -d "{\"accountId\":\"$CA\",\"service\":\"PREMIUM\",\"countryCode\":\"IN\",\"direction\":\"GIVE\",\"amount\":2500}" &
done > /tmp/par.txt; wait
check "parallel: 19 succeeded" 19 "$(grep -c 201 /tmp/par.txt)"
check "parallel: 1 refused" 1 "$(grep -c 400 /tmp/par.txt)"
check "agencyx left with 2497" 2497 "$(bal $AGT $AG)"
check "cust_a has 47502" 47502 "$(bal $AGT $CA)"
check "ledger matches balances" true "$(curl -s "$API/credits/reconcile" -H "authorization: Bearer $ADMIN" | jq .ok)"
check "reseller cannot run reconcile" 403 "$(code "$API/credits/reconcile" -H "authorization: Bearer $AGT")"

echo; echo "$pass passed, $fail failed"
