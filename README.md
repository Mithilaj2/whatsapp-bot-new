# We Brand 360: WhatsApp messaging panel

White-label panel for sending WhatsApp campaigns, with a reseller → customer hierarchy and credits.

| Folder | What it is | Built with |
| --- | --- | --- |
| `backend/` | API server | NestJS, Drizzle ORM, PostgreSQL |
| `frontend/` | Web panel | Next.js 15, Material UI |

## Status

**Phase 1 (done):** login, roles (Admin / Reseller / Customer), unlimited reseller hierarchy with
tree view, white-label domain and brand per reseller, countries master.

**Phase 2 (done):** credits per account, service (Premium / Branded) and country; ledger of every
movement; admin adds/removes credits; resellers give credits to, or take them back from, accounts
directly under them; balances and transactions pages with filters and CSV export.

**Phase 3 (done):** sending gateway. WhatsApp numbers (Meta Cloud API or test mode), message
templates with approval tracking, a sending queue with per-number speed limits and retries, signed
webhooks for delivery/read/failed and replies, admin pages for numbers, templates, test messages and
the message log.

**Phase 4 (done):** Premium Campaigns. Composer with live number check (valid, invalid,
duplicate, opted out, country switched off), image upload, message, Call and Website buttons, saved
defaults, live WhatsApp preview and credits per country; campaigns for yourself or any account
below you; reports with live delivery, failure reasons, recipient list, CSV download and stop;
incoming-messages inbox with campaign tags and 24-hour replies; automatic STOP opt-outs.

**Phase 5 (done):** Branded Campaigns. Onboarding form (business details, logo, number to use)
with admin review: send back with a note, or approve and link the customer's own WhatsApp number.
Branded composer with brand selector, preview under the brand's name, Branded credits and a lower
minimum; branded reports, incoming messages, auto responder (normal reply and STOP reply) and an
opt-outs page with manual blocking.

Next phases: Bot Studio → dashboard charts. Menu items for these show "Soon" until built.

## Run on your computer

You need Node.js 20 or newer and PostgreSQL 16 (or Docker).

```bash
# 1. Database (skip if you already have PostgreSQL)
docker compose up -d

# 2. Backend
cd backend
cp .env.example .env        # then edit .env: set JWT_SECRET and SEED_ADMIN_PASSWORD
npm install
npm run db:migrate          # creates the tables
npm run seed                # adds 252 countries and the first admin login
npm run dev                 # API on http://localhost:4000/api

# 3. Frontend (new terminal)
cd frontend
cp .env.example .env.local
npm install
npm run dev                 # panel on http://localhost:3000
```

Log in with the `SEED_ADMIN_USERNAME` and `SEED_ADMIN_PASSWORD` from `backend/.env`.

## Rules the API enforces

- Every account sees only itself and the accounts below it. A reseller never sees its parent or
  other resellers' customers.
- Admins and resellers can add resellers or customers under themselves or under any reseller below
  them. Customers cannot add accounts.
- Suspending or deleting an account blocks its login immediately, even if it is already logged in.
- An account with accounts under it cannot be deleted until they are moved or deleted. Deletes are
  soft: history is kept.
- Only the platform admin can switch countries on or off.
- A reseller's domain shows that reseller's brand name and logo on the login page.

### Credits

- 1 credit = 1 message. Premium and Branded credits are separate, and kept per country.
- The platform admin creates credits (it has no balance of its own). Resellers can only pass on
  credits they hold, and only to accounts directly under them; they can also take credits back.
- A balance can never go below zero, even when several transfers happen at the same moment
  (balance rows are locked during each change).
- Every change writes a ledger row with the balance after it. `GET /api/credits/reconcile` (admin)
  checks that every balance equals the sum of its ledger rows.
- An account that still holds credits cannot be deleted.
- `CreditsService.spend()` and `refund()` are ready for the campaign module (Phase 4).

### Sending (gateway)

- Every message goes through one provider interface (`backend/src/gateway/providers`). `META` is
  the official WhatsApp Cloud API; `TEST` simulates sent → delivered → read without sending
  anything (numbers ending in `0000` fail), so the panel can be demoed before Meta is ready.
- The `messages` table is also the queue: no Redis needed. The worker claims due rows with
  `FOR UPDATE SKIP LOCKED`, sends each number's messages at its own speed limit, retries temporary
  WhatsApp errors (rate limits, outages) up to 5 times with growing waits, and fails permanent ones
  at once. A message interrupted by a crash is marked failed rather than sent twice.
- Delivery statuses only move forward (a late "delivered" never overwrites "read").
- Webhooks are accepted only with a valid `X-Hub-Signature-256` from your app secret; every call
  is logged in `webhook_events`.
- A reply to a shared number is filed under the account (and campaign) that last messaged that
  contact from it.
- Access tokens are stored encrypted with `ENCRYPTION_KEY`.
- Other modules react to `gateway.message.status`, `gateway.message.received` and
  `gateway.template.status` events (campaign refunds and opt-outs hook in here in Phase 4).

### Campaigns

- WhatsApp only lets a business start a chat with an approved template, so each new message text
  is turned into a template automatically (`wb_<hash>`) and submitted. The campaign waits as
  *Waiting for approval* and starts by itself when WhatsApp approves. A message already approved
  is reused and sends at once; the image changes per campaign without new approval.
- Credits are taken when the campaign is submitted (1 per recipient, per country) in the same
  transaction that queues the messages: not enough credits = nothing saved.
- Failed and stopped messages get their credit back automatically (one ledger row per country,
  never twice). A rejected message returns every credit.
- Limits (in `.env`): up to `CAMPAIGN_DEMO_MAX` (10) recipients is a demo; full campaigns need
  `CAMPAIGN_MIN_RECIPIENTS` (1,000) to `CAMPAIGN_MAX_RECIPIENTS` (1,00,000).
- Replies like STOP / unsubscribe add the contact to the number's opt-out list; they are left out
  of every later campaign from that number, and not charged.
- Images are stored in `UPLOAD_DIR` and served at `/api/media/...` because WhatsApp downloads them
  by link. Back that folder up with the database.
- Inbox replies are free-form text and only possible within 24 hours of the contact's last
  message (WhatsApp rule). They are not charged in credits.

### Branded Campaigns

- A customer (or their reseller) fills in the **Onboarding form**. The platform admin registers that
  number in Meta (WhatsApp Manager → add phone number, or under the customer's own WhatsApp
  account), adds it under **Masters → WhatsApp numbers** as a *Branded* number, then opens the
  brand and **Approves**, picking that number. The number is then owned by the customer's account.
- A number can belong to only one live brand. A live brand's details are locked; a brand that was
  sent back can be fixed and sent again.
- Branded campaigns send from the brand's number, take **Branded** credits, and each number gets its
  own templates (WhatsApp approves templates per business account). Minimum recipients for a full
  campaign: `CAMPAIGN_BRANDED_MIN` (11).
- **Auto responder** (per number): a reply when someone writes, at most once a day per person so it
  never loops with another bot; and a reply when someone sends STOP. Both are free-form messages
  inside the 24-hour window, so no credits.
- **Opt-outs**: customers can block contacts on their own numbers and on the shared Premium number;
  not on numbers that belong to someone else.
- Later: once We Brand 360 is a Meta *Tech Provider*, customers can connect their own number with
  Embedded Signup instead of the admin doing it.

## Connecting WhatsApp (Meta)

Do this once your Meta business portfolio is verified.

1. **developers.facebook.com → Create app** → type *Business* → link it to your business portfolio
   → add the **WhatsApp** product.
2. **App settings → Basic**: copy the *App ID* and *App secret* into `META_APP_ID` and
   `META_APP_SECRET`.
3. **Business settings → Users → System users**: add an admin system user, assign it your app and
   your WhatsApp account with full control, then *Generate token* with
   `whatsapp_business_messaging` and `whatsapp_business_management`, expiry *Never*. Put it in
   `META_ACCESS_TOKEN`.
4. **WhatsApp Manager → Phone numbers**: add your number, set the display name, verify it by SMS.
5. Pick any long random string for `META_VERIFY_TOKEN`, restart the API.
6. **App → WhatsApp → Configuration → Webhook**: callback URL
   `https://<your api domain>/api/webhooks/meta`, verify token = `META_VERIFY_TOKEN`; subscribe to
   `messages`, `message_template_status_update`, `phone_number_quality_update`.
7. In the panel: **Masters → WhatsApp numbers → Add number**, paste the *Phone number ID* and
   *WhatsApp Business Account ID* (App → WhatsApp → API Setup). The panel checks the connection
   straight away.
8. **Masters → Templates → New template**, wait for approval, then **Send test** to your own phone.

The webhook URL must be public HTTPS, so this last part works once the API is on a server.

## Changing the database

1. Edit `backend/src/db/schema.ts`
2. `npm run db:generate -- --name short_description` (creates a SQL file in `backend/drizzle/`)
3. `npm run db:migrate`
4. Commit the new SQL file together with the schema change.

## Deploying to a server

A VPS (Ubuntu, 2 vCPU / 4 GB) is enough to start. A full step-by-step guide comes with the first
deployment. In short: install Node.js 20 and PostgreSQL 16, run
the backend with `npm run build && npm start` and the frontend with `npm run build && npm start`
under PM2, and put Nginx with HTTPS in front of both.
