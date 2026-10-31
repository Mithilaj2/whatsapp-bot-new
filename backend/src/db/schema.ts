// We Brand 360 - database schema (Phase 1: accounts, users, countries)
import { relations } from 'drizzle-orm';
import {
  boolean,
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
