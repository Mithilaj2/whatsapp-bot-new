import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  isNull,
  lte,
  or,
  SQL,
  sql,
  sum,
} from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { inTreeOf } from '../accounts/scope';
import { AuthUser } from '../auth/decorators';
import { Db, InjectDb } from '../db/db.module';
import {
  accounts,
  countries,
  creditBalances,
  creditTransactions,
  CreditTxnType,
  Service,
  users,
} from '../db/schema';
import { BalancesQuery, CreateTransactionDto, TransactionsQuery, TxnCategory } from './credits.dto';

/** Anything that can run queries: the db itself or an open transaction. */
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

export interface Movement {
  accountId: string;
  service: Service;
  countryId: string;
  type: CreditTxnType;
  /** Positive adds, negative removes. */
  amount: number;
  counterpartyId?: string | null;
  groupId?: string;
  campaignId?: string | null;
  campaignNo?: string | null;
  recipients?: number | null;
  remarks?: string | null;
  createdByUserId?: string | null;
}

export const categoryTypes: Record<TxnCategory, CreditTxnType[]> = {
  platform: ['CREDIT', 'DEBIT'],
  transfers: ['TRANSFER_IN', 'TRANSFER_OUT'],
  campaign: ['SPENT', 'REFUND'],
};

export class InsufficientCreditsError extends BadRequestException {}

const counterparty = alias(accounts, 'counterparty');

@Injectable()
export class CreditsService {
  constructor(@InjectDb() private readonly db: Db) {}

  /**
   * The only way credits ever change. Locks the affected balance rows, checks none goes below
   * zero, updates them and writes one ledger row per movement, all in one transaction.
   * Movements sharing a groupId are all-or-nothing.
   */
  async applyMovements(tx: Tx, movements: Movement[]) {
    const key = (m: { accountId: string; service: string; countryId: string }) =>
      `${m.accountId}|${m.service}|${m.countryId}`;

    // Lock in a fixed order so two transfers in opposite directions can't deadlock
    const keys = [...new Map(movements.map((m) => [key(m), m])).values()].sort((a, b) =>
      key(a).localeCompare(key(b)),
    );
    const balances = new Map<string, number>();
    for (const k of keys) {
      await tx
        .insert(creditBalances)
        .values({ accountId: k.accountId, service: k.service, countryId: k.countryId, balance: 0 })
        .onConflictDoNothing();
      const [row] = await tx
        .select({ balance: creditBalances.balance })
        .from(creditBalances)
        .where(
          and(
            eq(creditBalances.accountId, k.accountId),
            eq(creditBalances.service, k.service),
            eq(creditBalances.countryId, k.countryId),
          ),
        )
        .for('update');
      balances.set(key(k), row.balance);
    }

    const written = [];
    for (const m of movements) {
      const after = balances.get(key(m))! + m.amount;
      if (after < 0) {
        const [acc] = await tx
          .select({ username: accounts.username })
          .from(accounts)
          .where(eq(accounts.id, m.accountId));
        throw new InsufficientCreditsError(
          `Not enough credits: ${acc?.username ?? 'account'} has ${balances.get(key(m))!.toLocaleString('en-IN')}, needs ${(-m.amount).toLocaleString('en-IN')}`,
        );
      }
      balances.set(key(m), after);
      const [row] = await tx
        .insert(creditTransactions)
        .values({
          accountId: m.accountId,
          service: m.service,
          countryId: m.countryId,
          type: m.type,
          amount: m.amount,
          balanceAfter: after,
          counterpartyId: m.counterpartyId ?? null,
          groupId: m.groupId,
          campaignId: m.campaignId ?? null,
          campaignNo: m.campaignNo ?? null,
          recipients: m.recipients ?? null,
          remarks: m.remarks ?? null,
          createdByUserId: m.createdByUserId ?? null,
        })
        .returning();
      written.push(row);
    }

    for (const k of keys) {
      await tx
        .update(creditBalances)
        .set({ balance: balances.get(key(k))!, updatedAt: new Date() })
        .where(
          and(
            eq(creditBalances.accountId, k.accountId),
            eq(creditBalances.service, k.service),
            eq(creditBalances.countryId, k.countryId),
          ),
        );
    }
    return written;
  }

  /** Manual transaction from the panel: admin adds/removes, reseller transfers to a direct child. */
  async createTransaction(actor: AuthUser, dto: CreateTransactionDto) {
    if (actor.accountType === 'CUSTOMER') {
      throw new ForbiddenException('Customers cannot transfer credits');
    }
    if (dto.accountId === actor.accountId) {
      throw new BadRequestException('Choose a reseller or customer under you');
    }

    const [target] = await this.db
      .select({ id: accounts.id, username: accounts.username, parentId: accounts.parentId })
      .from(accounts)
      .where(
        and(
          eq(accounts.id, dto.accountId),
          isNull(accounts.deletedAt),
          inTreeOf(this.db, accounts.id, actor.accountId, 1),
        ),
      );
    if (!target) throw new NotFoundException('Account not found');

    const [country] = await this.db
      .select({ id: countries.id, isActive: countries.isActive, name: countries.name })
      .from(countries)
      .where(eq(countries.code, dto.countryCode));
    if (!country) throw new BadRequestException('Unknown country');
    if (!country.isActive) throw new BadRequestException(`${country.name} is switched off in Countries`);

    const base = {
      service: dto.service,
      countryId: country.id,
      remarks: dto.remarks ?? null,
      createdByUserId: actor.userId,
      groupId: randomUUID(),
    };
    let movements: Movement[];

    if (actor.accountType === 'ADMIN') {
      // The platform creates or removes credits; the admin has no balance of its own
      const give = dto.direction === 'GIVE';
      movements = [
        {
          ...base,
          accountId: target.id,
          type: give ? 'CREDIT' : 'DEBIT',
          amount: give ? dto.amount : -dto.amount,
          counterpartyId: actor.accountId,
        },
      ];
    } else {
      if (target.parentId !== actor.accountId) {
        throw new ForbiddenException(
          'You can only transfer credits to resellers and customers directly under you',
        );
      }
      const [from, to] =
        dto.direction === 'GIVE' ? [actor.accountId, target.id] : [target.id, actor.accountId];
      movements = [
        { ...base, accountId: from, type: 'TRANSFER_OUT', amount: -dto.amount, counterpartyId: to },
        { ...base, accountId: to, type: 'TRANSFER_IN', amount: dto.amount, counterpartyId: from },
      ];
    }

    const rows = await this.db.transaction((tx) => this.applyMovements(tx, movements));
    return { groupId: base.groupId, transactions: rows };
  }

  /**
   * Campaign charge, used by the campaign module (Phase 4). Pass the open transaction so the
   * campaign and its charge are saved together. Throws InsufficientCreditsError.
   */
  spend(
    tx: Tx,
    args: {
      accountId: string;
      service: Service;
      byCountry: { countryId: string; credits: number; recipients: number }[];
      campaignId: string;
      campaignNo: string;
      userId?: string;
    },
  ) {
    return this.applyMovements(
      tx,
      args.byCountry
        .filter((c) => c.credits > 0)
        .map((c) => ({
          accountId: args.accountId,
          service: args.service,
          countryId: c.countryId,
          type: 'SPENT' as const,
          amount: -c.credits,
          recipients: c.recipients,
          campaignId: args.campaignId,
          campaignNo: args.campaignNo,
          remarks: `Campaign charge (${c.recipients} recipients)`,
          createdByUserId: args.userId ?? null,
        })),
    );
  }

  /** Gives credits back for messages that failed. */
  refund(
    tx: Tx,
    args: {
      accountId: string;
      service: Service;
      countryId: string;
      credits: number;
      campaignId: string;
      campaignNo: string;
      reason: string;
    },
  ) {
    if (args.credits <= 0) return Promise.resolve([]);
    return this.applyMovements(tx, [
      {
        accountId: args.accountId,
        service: args.service,
        countryId: args.countryId,
        type: 'REFUND',
        amount: args.credits,
        campaignId: args.campaignId,
        campaignNo: args.campaignNo,
        remarks: args.reason,
      },
    ]);
  }

  // ------------------------------------------------------------------ reading

  private balanceFilters(actor: AuthUser, q: Partial<BalancesQuery>) {
    const f: (SQL | undefined)[] = [inTreeOf(this.db, creditBalances.accountId, actor.accountId, 0)];
    if (q.service) f.push(eq(creditBalances.service, q.service));
    if (q.accountId) f.push(eq(creditBalances.accountId, q.accountId));
    if (q.search?.trim()) {
      const s = `%${q.search.trim()}%`;
      f.push(or(ilike(accounts.username, s), ilike(accounts.name, s), ilike(countries.name, s), ilike(countries.code, s)));
    }
    return and(...f);
  }

  private balanceQuery(where: SQL | undefined) {
    return this.db
      .select({
        accountId: creditBalances.accountId,
        username: accounts.username,
        accountName: accounts.name,
        accountType: accounts.type,
        service: creditBalances.service,
        countryCode: countries.code,
        countryName: countries.name,
        balance: creditBalances.balance,
        updatedAt: creditBalances.updatedAt,
      })
      .from(creditBalances)
      .innerJoin(accounts, eq(accounts.id, creditBalances.accountId))
      .innerJoin(countries, eq(countries.id, creditBalances.countryId))
      .where(where);
  }

  async balances(actor: AuthUser, q: BalancesQuery) {
    const where = this.balanceFilters(actor, q);
    const [items, [{ total }]] = await Promise.all([
      this.balanceQuery(where)
        .orderBy(desc(creditBalances.updatedAt))
        .limit(q.pageSize)
        .offset((q.page - 1) * q.pageSize),
      this.db
        .select({ total: count() })
        .from(creditBalances)
        .innerJoin(accounts, eq(accounts.id, creditBalances.accountId))
        .innerJoin(countries, eq(countries.id, creditBalances.countryId))
        .where(where),
    ]);
    return { items, total, page: q.page, pageSize: q.pageSize };
  }

  balancesForExport(actor: AuthUser, q: BalancesQuery) {
    return this.balanceQuery(this.balanceFilters(actor, q))
      .orderBy(asc(accounts.username), asc(creditBalances.service))
      .limit(50_000);
  }

  /** My own balances, per service and country, for the dashboard and campaign screens. */
  async summary(actor: AuthUser) {
    const rows = await this.balanceQuery(eq(creditBalances.accountId, actor.accountId)).orderBy(
      asc(creditBalances.service),
      asc(countries.name),
    );
    const totals = { PREMIUM: 0, BRANDED: 0 } as Record<Service, number>;
    for (const r of rows) totals[r.service] += r.balance;
    return { totals, byCountry: rows };
  }

  private txnFilters(actor: AuthUser, q: Partial<TransactionsQuery>) {
    const f: (SQL | undefined)[] = [
      inTreeOf(this.db, creditTransactions.accountId, actor.accountId, 0),
    ];
    if (q.service) f.push(eq(creditTransactions.service, q.service));
    if (q.category) f.push(inArray(creditTransactions.type, categoryTypes[q.category]));
    if (q.accountId) f.push(eq(creditTransactions.accountId, q.accountId));
    if (q.from) f.push(gte(creditTransactions.createdAt, new Date(q.from)));
    if (q.to) f.push(lte(creditTransactions.createdAt, new Date(q.to)));
    if (q.search?.trim()) {
      const s = `%${q.search.trim()}%`;
      f.push(
        or(
          ilike(accounts.username, s),
          ilike(accounts.name, s),
          ilike(counterparty.username, s),
          ilike(creditTransactions.campaignNo, s),
          ilike(creditTransactions.remarks, s),
        ),
      );
    }
    return and(...f);
  }

  private txnQuery(where: SQL | undefined) {
    return this.db
      .select({
        id: creditTransactions.id,
        createdAt: creditTransactions.createdAt,
        accountId: creditTransactions.accountId,
        username: accounts.username,
        accountName: accounts.name,
        service: creditTransactions.service,
        type: creditTransactions.type,
        amount: creditTransactions.amount,
        balanceAfter: creditTransactions.balanceAfter,
        countryCode: countries.code,
        counterpartyUsername: counterparty.username,
        counterpartyName: counterparty.name,
        campaignId: creditTransactions.campaignId,
        campaignNo: creditTransactions.campaignNo,
        recipients: creditTransactions.recipients,
        remarks: creditTransactions.remarks,
        createdBy: users.username,
      })
      .from(creditTransactions)
      .innerJoin(accounts, eq(accounts.id, creditTransactions.accountId))
      .innerJoin(countries, eq(countries.id, creditTransactions.countryId))
      .leftJoin(counterparty, eq(counterparty.id, creditTransactions.counterpartyId))
      .leftJoin(users, eq(users.id, creditTransactions.createdByUserId))
      .where(where);
  }

  async transactions(actor: AuthUser, q: TransactionsQuery) {
    const where = this.txnFilters(actor, q);
    const [items, [{ total }]] = await Promise.all([
      this.txnQuery(where)
        .orderBy(desc(creditTransactions.createdAt), desc(creditTransactions.id))
        .limit(q.pageSize)
        .offset((q.page - 1) * q.pageSize),
      this.db
        .select({ total: count() })
        .from(creditTransactions)
        .innerJoin(accounts, eq(accounts.id, creditTransactions.accountId))
        .leftJoin(counterparty, eq(counterparty.id, creditTransactions.counterpartyId))
        .where(where),
    ]);
    return { items, total, page: q.page, pageSize: q.pageSize };
  }

  transactionsForExport(actor: AuthUser, q: TransactionsQuery) {
    return this.txnQuery(this.txnFilters(actor, q))
      .orderBy(desc(creditTransactions.createdAt))
      .limit(50_000);
  }

  /**
   * Safety check: every balance must equal the sum of its ledger rows. Returns mismatches
   * (should always be empty). Admin only.
   */
  async reconcile() {
    const sums = this.db
      .select({
        accountId: creditTransactions.accountId,
        service: creditTransactions.service,
        countryId: creditTransactions.countryId,
        total: sum(creditTransactions.amount).mapWith(Number).as('total'),
      })
      .from(creditTransactions)
      .groupBy(creditTransactions.accountId, creditTransactions.service, creditTransactions.countryId)
      .as('sums');
    return this.db
      .select({
        accountId: creditBalances.accountId,
        service: creditBalances.service,
        balance: creditBalances.balance,
        ledger: sql<number>`coalesce(${sums.total}, 0)`.mapWith(Number),
      })
      .from(creditBalances)
      .leftJoin(
        sums,
        and(
          eq(sums.accountId, creditBalances.accountId),
          eq(sums.service, creditBalances.service),
          eq(sums.countryId, creditBalances.countryId),
        ),
      )
      .where(sql`${creditBalances.balance} <> coalesce(${sums.total}, 0)`);
  }
}
