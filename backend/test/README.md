# End-to-end API tests

Plain bash + curl + jq scripts that run against a real API and database.

1. Use an empty database, seeded with `SEED_ADMIN_USERNAME=admin` and `SEED_ADMIN_PASSWORD=TestAdmin#2026`.
2. For the gateway tests, start the fake WhatsApp API and point the API at it in `.env`:
   ```
   node test/fake-meta.js            # listens on :4900
   META_GRAPH_URL="http://localhost:4900"
   META_APP_SECRET="testsecret"
   META_VERIFY_TOKEN="verify123"
   META_APP_ID="999"
   TEST_PROVIDER_SPEED=3
   CAMPAIGN_MIN_RECIPIENTS=20
   ```
3. Start the API (`npm run build && npm start`), then run:
   ```
   bash test/accounts.e2e.sh
   bash test/credits.e2e.sh
   bash test/gateway.e2e.sh
   bash test/campaigns.e2e.sh
   ```
   Run `accounts` first on a fresh database: it counts all accounts the admin can see.
