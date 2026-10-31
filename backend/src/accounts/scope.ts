import { and, eq, exists, gte, sql, SQL } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';
import type { Db } from '../db/db.module';
import { accountClosure } from '../db/schema';

/**
 * Condition: `accountIdColumn` is `rootId` itself (minDepth 0) or anywhere below it (minDepth 1 = below only).
 * Used everywhere data must be limited to "me and the accounts under me".
 */
export function inTreeOf(db: Db, accountIdColumn: PgColumn, rootId: string, minDepth: 0 | 1): SQL {
  return exists(
    db
      .select({ one: sql`1` })
      .from(accountClosure)
      .where(
        and(
          eq(accountClosure.descendantId, accountIdColumn),
          eq(accountClosure.ancestorId, rootId),
          gte(accountClosure.depth, minDepth),
        ),
      ),
  );
}
