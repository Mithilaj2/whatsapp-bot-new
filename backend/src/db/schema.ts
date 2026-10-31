// We Brand 360 - database schema
// Phase 1: accounts, users, countries. Phase 2: credits ledger and balances.
import { relations, sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
  varchar,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';

/** ADMIN = platform owner, RESELLER = can create accounts below it, CUSTOMER = end business. */
export const accountType = pgEnum('account_type', ['ADMIN', 'RESELLER', 'CUSTOMER']);
export const accountStatus = pgEnum('account_status', ['ACTIVE', 'SUSPENDED']);

export type AccountType = (typeof accountType.enumValues)[number];
export type AccountStatus = (typeof accountStatus.enumValues)[number];

const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};

/** An organisation in the reseller tree: admin -> resellers -> sub-resellers -> customers. */
export const accounts = pgTable(
  'accounts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    username: varchar('username', { length: 30 }).notNull().unique(),
    name: varchar('name', { length: 120 }).notNull(),
    type: accountType('type').notNull(),
    status: accountStatus('status').notNull().default('ACTIVE'),
    email: varchar('email', { length: 254 }),
    phone: varchar('phone', { length: 20 }),
    parentId: uuid('parent_id').references((): AnyPgColumn => accounts.id),
    // White-label branding (resellers): their own panel domain, name and logo
    domain: varchar('domain', { length: 253 }).unique(),
    brandName: varchar('brand_name', { length: 120 }),
    logoUrl: text('logo_url'),
    ...timestamps,
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [index('accounts_parent_idx').on(t.parentId), index('accounts_type_idx').on(t.type)],
);

/**
 * Closure table: one row for every (ancestor, descendant) pair, including (self, self) at depth 0.
 * Lets us fetch "me and everyone below me" with one indexed query.
 */
export const accountClosure = pgTable(
  'account_closure',
  {
    ancestorId: uuid('ancestor_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    descendantId: uuid('descendant_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    depth: integer('depth').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.ancestorId, t.descendantId] }),
    index('account_closure_descendant_idx').on(t.descendantId),
  ],
);

/** A person who logs in. Each account has at least one user (its owner). */
export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    username: varchar('username', { length: 30 }).notNull().unique(),
    passwordHash: text('password_hash').notNull(),
    name: varchar('name', { length: 120 }).notNull(),
    isActive: boolean('is_active').notNull().default(true),
    lastLoginAt: timestamp('last_login_at', { withTimezone: true }),
    ...timestamps,
  },
  (t) => [index('users_account_idx').on(t.accountId)],
);

/** Masters > Countries. Credit rates per country and service come in Phase 2. */
export const countries = pgTable(
  'countries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    code: varchar('code', { length: 2 }).notNull().unique(), // ISO alpha-2, e.g. IN
    name: varchar('name', { length: 100 }).notNull(),
    isd: varchar('isd', { length: 6 }).notNull(), // dialling code without +, e.g. 91
    slug: varchar('slug', { length: 100 }).notNull().unique(),
    isActive: boolean('is_active').notNull().default(true),
    ...timestamps,
  },
  (t) => [index('countries_isd_idx').on(t.isd)],
);

export const accountsRelations = relations(accounts, ({ one, many }) => ({
  parent: one(accounts, { fields: [accounts.parentId], references: [accounts.id], relationName: 'tree' }),
  children: many(accounts, { relationName: 'tree' }),
  users: many(users),
}));

export const usersRelations = relations(users, ({ one }) => ({
  account: one(accounts, { fields: [users.accountId], references: [accounts.id] }),
}));

// ---------------------------------------------------------------------------
// Phase 2: credits
// ---------------------------------------------------------------------------

/** The two products. Credits for one cannot be used for the other. */
export const service = pgEnum('service', ['PREMIUM', 'BRANDED']);
export type Service = (typeof service.enumValues)[number];

/**
 * CREDIT / DEBIT     platform admin adds or removes credits (category "platform")
 * TRANSFER_IN / OUT  credits moved between a parent and a direct child ("transfers")
 * SPENT / REFUND     a campaign uses credits, failed messages are refunded ("campaign")
 */
export const creditTxnType = pgEnum('credit_txn_type', [
  'CREDIT',
  'DEBIT',
  'TRANSFER_IN',
  'TRANSFER_OUT',
  'SPENT',
  'REFUND',
]);
export type CreditTxnType = (typeof creditTxnType.enumValues)[number];

/**
 * Current balance per account x service x country. Only ever changed by CreditsService in the
 * same database transaction that writes the ledger row, so it always equals the ledger sum.
 */
export const creditBalances = pgTable(
  'credit_balances',
  {
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    service: service('service').notNull(),
    countryId: uuid('country_id')
      .notNull()
      .references(() => countries.id),
    balance: integer('balance').notNull().default(0),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.accountId, t.service, t.countryId] }),
    check('credit_balances_not_negative', sql`${t.balance} >= 0`),
  ],
);

/** Ledger: one row per credit movement. Never updated or deleted. */
export const creditTransactions = pgTable(
  'credit_transactions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    service: service('service').notNull(),
    countryId: uuid('country_id')
      .notNull()
      .references(() => countries.id),
    type: creditTxnType('type').notNull(),
    /** Positive adds credits, negative removes them. */
    amount: integer('amount').notNull(),
    balanceAfter: integer('balance_after').notNull(),
    /** The other side of a transfer, or the admin account for CREDIT/DEBIT. */
    counterpartyId: uuid('counterparty_id').references(() => accounts.id),
    /** Links the OUT and IN rows of one transfer. */
    groupId: uuid('group_id').notNull().defaultRandom(),
    campaignId: uuid('campaign_id'),
    campaignNo: varchar('campaign_no', { length: 12 }),
    recipients: integer('recipients'),
    remarks: varchar('remarks', { length: 255 }),
    createdByUserId: uuid('created_by_user_id').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('credit_txn_account_idx').on(t.accountId, t.createdAt),
    index('credit_txn_campaign_idx').on(t.campaignId),
    check('credit_txn_amount_not_zero', sql`${t.amount} <> 0`),
  ],
);
