/**
 * Applies database migrations (the SQL files in drizzle/). Runs on every API start in production,
 * so a new version updates the database by itself. Safe to run any number of times.
 */
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { join } from 'path';
import { Pool } from 'pg';

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    // Waits for the database to come up (the container may start first)
    for (let i = 1; ; i++) {
      try {
        await pool.query('select 1');
        break;
      } catch (e) {
        if (i >= 30) throw e;
        await new Promise((r) => setTimeout(r, 2000));
      }
    }
    await migrate(drizzle(pool), { migrationsFolder: join(__dirname, '..', '..', 'drizzle') });
    console.log('Database is up to date');
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error(`Database migration failed: ${e.message ?? e}`);
  process.exit(1);
});
