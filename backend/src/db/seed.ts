/**
 * Seed script: loads all countries and creates the first platform admin.
 * Safe to run more than once (it only adds what is missing).
 *   npm run seed
 */
import * as bcrypt from 'bcryptjs';
import { countries as countryList } from 'countries-list';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const db = drizzle(pool, { schema });

async function seedCountries() {
  const rows = Object.entries(countryList)
    .filter(([, info]) => info.phone && info.phone.length > 0)
    .map(([code, info]) => ({
      code,
      name: info.name,
      isd: String(info.phone[0]),
      slug: code.toLowerCase(),
    }));
  const inserted = await db
    .insert(schema.countries)
    .values(rows)
    .onConflictDoNothing({ target: schema.countries.code })
    .returning({ id: schema.countries.id });
  const total = await db.$count(schema.countries);
  console.log(`Countries: ${inserted.length} added, ${total} in total`);
}

async function seedAdmin() {
  const username = (process.env.SEED_ADMIN_USERNAME || 'admin').trim().toLowerCase();
  const password = process.env.SEED_ADMIN_PASSWORD;
  const name = process.env.SEED_ADMIN_NAME || 'We Brand 360';

  const existing = await db.query.users.findFirst({ where: eq(schema.users.username, username) });
  if (existing) {
    console.log(`Admin "${username}" already exists, skipped`);
    return;
  }
  const min = process.env.NODE_ENV === 'production' ? 12 : 8;
  if (!password || password === 'change-me' || password.length < min) {
    throw new Error(`Set SEED_ADMIN_PASSWORD in .env (at least ${min} characters) before seeding`);
  }

  const passwordHash = await bcrypt.hash(password, 12);
  await db.transaction(async (tx) => {
    const [account] = await tx
      .insert(schema.accounts)
      .values({ username, name, type: 'ADMIN', brandName: name })
      .returning();
    await tx
      .insert(schema.accountClosure)
      .values({ ancestorId: account.id, descendantId: account.id, depth: 0 });
    await tx.insert(schema.users).values({ accountId: account.id, username, name, passwordHash });
  });
  console.log(`Admin "${username}" created`);
}

async function main() {
  await seedCountries();
  await seedAdmin();
}

main()
  .catch((e) => {
    console.error(e.message ?? e);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
