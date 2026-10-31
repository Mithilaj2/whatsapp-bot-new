# We Brand 360: WhatsApp messaging panel

White-label panel for sending WhatsApp campaigns, with a reseller → customer hierarchy and credits.

| Folder | What it is | Built with |
| --- | --- | --- |
| `backend/` | API server | NestJS, Drizzle ORM, PostgreSQL |
| `frontend/` | Web panel | Next.js 15, Material UI |

## Status

**Phase 1 (done):** login, roles (Admin / Reseller / Customer), unlimited reseller hierarchy with
tree view, white-label domain and brand per reseller, countries master.

Next phases: credits ledger → sending gateway (Meta Cloud API) → Premium Campaigns → Branded
Campaigns → Bot Studio → dashboard charts. Menu items for these show "Soon" until built.

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

## Changing the database

1. Edit `backend/src/db/schema.ts`
2. `npm run db:generate -- --name short_description` (creates a SQL file in `backend/drizzle/`)
3. `npm run db:migrate`
4. Commit the new SQL file together with the schema change.

## Deploying to a server

A VPS (Ubuntu, 2 vCPU / 4 GB) is enough to start. Full step-by-step server instructions come with
Phase 3, when the sending queue is added. In short: install Node.js 20, PostgreSQL 16 and Redis, run
the backend with `npm run build && npm start` and the frontend with `npm run build && npm start`
under PM2, and put Nginx with HTTPS in front of both.
