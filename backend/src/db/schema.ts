// We Brand 360 - database schema
// Phase 1: accounts, users, countries. Phase 2: credits ledger and balances.
// Phase 3: sender numbers, message templates, messages (also the sending queue), webhook log.
// Phase 4: campaigns, opt-outs, uploaded media.
// Phase 5: brands (onboarding), auto responders.
import { relations, sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  uniqueIndex,
  text,
  timestamp,
  uuid,
  varchar,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';

export interface CampaignDefaults {
  message?: string;
  callNumber?: string;
  visitUrl?: string;
}

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
    /** "Set as default values" in the campaign composer. */
    campaignDefaults: jsonb('campaign_defaults').$type<CampaignDefaults>(),
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

// ---------------------------------------------------------------------------
// Phase 3: sending gateway
// ---------------------------------------------------------------------------

/** META = official WhatsApp Cloud API. TEST = simulated, for demos and development. */
export const provider = pgEnum('provider', ['META', 'TEST']);
export type Provider = (typeof provider.enumValues)[number];

export const senderStatus = pgEnum('sender_status', ['ACTIVE', 'DISABLED']);

/**
 * WhatsApp numbers messages are sent from. ownerAccountId null = a shared platform number
 * (Premium); otherwise the number belongs to that customer (Branded).
 */
export const senderNumbers = pgTable(
  'sender_numbers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    label: varchar('label', { length: 120 }).notNull(),
    provider: provider('provider').notNull(),
    service: service('service').notNull(),
    ownerAccountId: uuid('owner_account_id').references(() => accounts.id),
    phoneNumber: varchar('phone_number', { length: 20 }).notNull(), // digits with country code
    displayName: varchar('display_name', { length: 120 }),
    phoneNumberId: varchar('phone_number_id', { length: 64 }).notNull(), // Meta's id for the number
    wabaId: varchar('waba_id', { length: 64 }).notNull(), // WhatsApp Business Account id
    accessTokenEnc: text('access_token_enc'), // encrypted; null = use the platform token
    status: senderStatus('status').notNull().default('ACTIVE'),
    isDefault: boolean('is_default').notNull().default(false),
    /** Messages per second this number may send. Meta allows about 80 by default. */
    ratePerSecond: integer('rate_per_second').notNull().default(20),
    qualityRating: varchar('quality_rating', { length: 16 }),
    messagingLimit: varchar('messaging_limit', { length: 32 }),
    lastError: text('last_error'),
    ...timestamps,
  },
  (t) => [uniqueIndex('sender_numbers_provider_phone_id_uq').on(t.provider, t.phoneNumberId)],
);

export const templateCategory = pgEnum('template_category', ['MARKETING', 'UTILITY']);
export const templateStatus = pgEnum('template_status', [
  'DRAFT',
  'PENDING',
  'APPROVED',
  'REJECTED',
  'PAUSED',
  'DISABLED',
]);
export type TemplateStatus = (typeof templateStatus.enumValues)[number];

export interface TemplateButton {
  type: 'PHONE_NUMBER' | 'URL' | 'QUICK_REPLY';
  text: string;
  phone?: string;
  url?: string;
}

/** What a template looks like. {{1}}, {{2}}... in the body are filled in when sending. */
export interface TemplateContent {
  header?: { type: 'IMAGE'; exampleUrl: string } | { type: 'TEXT'; text: string };
  body: string;
  bodyExamples?: string[];
  footer?: string;
  buttons?: TemplateButton[];
}

/** Message templates. Meta must approve a template before it can start a conversation. */
export const messageTemplates = pgTable(
  'message_templates',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    senderNumberId: uuid('sender_number_id')
      .notNull()
      .references(() => senderNumbers.id),
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id),
    name: varchar('name', { length: 512 }).notNull(),
    language: varchar('language', { length: 10 }).notNull().default('en'),
    category: templateCategory('category').notNull().default('MARKETING'),
    content: jsonb('content').$type<TemplateContent>().notNull(),
    status: templateStatus('status').notNull().default('DRAFT'),
    providerTemplateId: varchar('provider_template_id', { length: 64 }),
    rejectionReason: text('rejection_reason'),
    ...timestamps,
  },
  (t) => [uniqueIndex('templates_number_name_lang_uq').on(t.senderNumberId, t.name, t.language)],
);

export const messageDirection = pgEnum('message_direction', ['OUT', 'IN']);
export const messageStatus = pgEnum('message_status', [
  'QUEUED',
  'SENDING',
  'SENT',
  'DELIVERED',
  'READ',
  'FAILED',
  'RECEIVED',
  'CANCELLED',
]);
export type MessageStatus = (typeof messageStatus.enumValues)[number];
export const messageKind = pgEnum('message_kind', ['TEMPLATE', 'TEXT', 'IMAGE', 'INTERACTIVE', 'OTHER']);

/**
 * A free-form message with buttons, a list menu or an image. Only allowed inside the 24-hour
 * window after the contact wrote (bots and replies).
 */
export type RichMessage =
  | { kind: 'buttons'; body: string; imageUrl?: string; footer?: string; buttons: { id: string; title: string }[] }
  | {
      kind: 'list';
      body: string;
      footer?: string;
      button: string;
      rows: { id: string; title: string; description?: string }[];
    }
  | { kind: 'image'; imageUrl: string; caption?: string };

/** What to send for an outgoing message, plus a few markers. */
export interface TemplatePayload {
  bodyParams?: string[];
  headerImageUrl?: string;
  /** Set on automatic replies, so we know what was already sent to a contact. */
  auto?: 'normal' | 'optout';
  /** Buttons, list or image message. */
  rich?: RichMessage;
  /** Sent by this bot. */
  bot?: string;
  /** Incoming: the id of the button or list row the contact tapped. */
  replyId?: string;
  /** Answer written by AI. */
  ai?: boolean;
}

/**
 * Every WhatsApp message in or out. Outgoing rows are also the sending queue: the worker picks
 * rows with status QUEUED whose next_attempt_at has passed.
 */
export const messages = pgTable(
  'messages',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id),
    senderNumberId: uuid('sender_number_id')
      .notNull()
      .references(() => senderNumbers.id),
    direction: messageDirection('direction').notNull(),
    contactPhone: varchar('contact_phone', { length: 20 }).notNull(), // digits with country code
    contactName: varchar('contact_name', { length: 120 }),
    kind: messageKind('kind').notNull(),
    templateId: uuid('template_id').references(() => messageTemplates.id),
    payload: jsonb('payload').$type<TemplatePayload | Record<string, unknown>>(),
    body: text('body'),
    status: messageStatus('status').notNull(),
    providerMessageId: varchar('provider_message_id', { length: 128 }),
    errorCode: varchar('error_code', { length: 32 }),
    errorMessage: text('error_message'),
    attempts: integer('attempts').notNull().default(0),
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }),
    lockedAt: timestamp('locked_at', { withTimezone: true }),
    campaignId: uuid('campaign_id'),
    /** ISO country of the contact, for per-country credits and reports. */
    countryCode: varchar('country_code', { length: 2 }),
    /** Set when the credit for this message was given back (failed or cancelled). */
    refundedAt: timestamp('refunded_at', { withTimezone: true }),
    /** For replies: the outgoing message this one answers, when WhatsApp tells us. */
    replyToProviderId: varchar('reply_to_provider_id', { length: 128 }),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),
    readAt: timestamp('read_at', { withTimezone: true }),
    failedAt: timestamp('failed_at', { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('messages_provider_message_id_uq').on(t.providerMessageId),
    index('messages_queue_idx').on(t.nextAttemptAt).where(sql`${t.status} = 'QUEUED'`),
    index('messages_campaign_idx').on(t.campaignId),
    index('messages_conversation_idx').on(t.senderNumberId, t.contactPhone, t.createdAt),
    index('messages_account_idx').on(t.accountId, t.createdAt),
  ],
);

/** Raw webhook calls, kept for troubleshooting. */
export const webhookEvents = pgTable(
  'webhook_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    provider: provider('provider').notNull(),
    signatureValid: boolean('signature_valid').notNull(),
    payload: jsonb('payload').notNull(),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
    processedAt: timestamp('processed_at', { withTimezone: true }),
    error: text('error'),
  },
  (t) => [index('webhook_events_received_idx').on(t.receivedAt)],
);

// ---------------------------------------------------------------------------
// Phase 4: campaigns
// ---------------------------------------------------------------------------

/** Images people upload (campaign pictures). Files live in UPLOAD_DIR; WhatsApp fetches them by link. */
export const media = pgTable('media', {
  id: uuid('id').primaryKey().defaultRandom(),
  accountId: uuid('account_id')
    .notNull()
    .references(() => accounts.id),
  fileName: varchar('file_name', { length: 80 }).notNull(), // stored name: <id>.<ext>
  originalName: varchar('original_name', { length: 255 }),
  mimeType: varchar('mime_type', { length: 50 }).notNull(),
  size: integer('size').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const campaignStatus = pgEnum('campaign_status', [
  'PENDING_APPROVAL', // waiting for WhatsApp to approve the message
  'SENDING',
  'COMPLETED',
  'CANCELLED',
  'REJECTED', // WhatsApp did not approve the message; credits returned
]);
export type CampaignStatus = (typeof campaignStatus.enumValues)[number];

export interface CampaignContent {
  imageUrl?: string;
  message: string;
  callNumber?: string;
  visitUrl?: string;
}

export interface CampaignCountry {
  code: string;
  name: string;
  recipients: number;
  credits: number;
}

export const campaigns = pgTable(
  'campaigns',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    campaignNo: varchar('campaign_no', { length: 8 }).notNull().unique(),
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id),
    createdByUserId: uuid('created_by_user_id').references(() => users.id),
    service: service('service').notNull(),
    title: varchar('title', { length: 150 }).notNull(),
    senderNumberId: uuid('sender_number_id')
      .notNull()
      .references(() => senderNumbers.id),
    templateId: uuid('template_id')
      .notNull()
      .references(() => messageTemplates.id),
    /** Branded campaigns: the customer's brand (and so their own number). */
    brandId: uuid('brand_id'),
    content: jsonb('content').$type<CampaignContent>().notNull(),
    status: campaignStatus('status').notNull(),
    isDemo: boolean('is_demo').notNull().default(false),
    /** What was pasted, and what happened to it. */
    totalNumbers: integer('total_numbers').notNull(),
    invalidNumbers: integer('invalid_numbers').notNull(),
    duplicateNumbers: integer('duplicate_numbers').notNull(),
    optedOutNumbers: integer('opted_out_numbers').notNull(),
    recipients: integer('recipients').notNull(),
    byCountry: jsonb('by_country').$type<CampaignCountry[]>().notNull(),
    creditsCharged: integer('credits_charged').notNull(),
    creditsRefunded: integer('credits_refunded').notNull().default(0),
    rejectionReason: text('rejection_reason'),
    submittedAt: timestamp('submitted_at', { withTimezone: true }).notNull().defaultNow(),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    index('campaigns_account_idx').on(t.accountId, t.submittedAt),
    index('campaigns_status_idx').on(t.status),
  ],
);

/** Contacts who said STOP. Nothing more is sent to them from that number. */
export const optOuts = pgTable(
  'opt_outs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    senderNumberId: uuid('sender_number_id')
      .notNull()
      .references(() => senderNumbers.id),
    contactPhone: varchar('contact_phone', { length: 20 }).notNull(),
    contactName: varchar('contact_name', { length: 120 }),
    /** The account whose message they were answering (for listing). */
    accountId: uuid('account_id').references(() => accounts.id),
    mode: varchar('mode', { length: 10 }).notNull(), // AUTO | MANUAL
    remarks: varchar('remarks', { length: 255 }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('opt_outs_number_contact_uq').on(t.senderNumberId, t.contactPhone)],
);

// ---------------------------------------------------------------------------
// Phase 5: branded campaigns
// ---------------------------------------------------------------------------

export const brandStatus = pgEnum('brand_status', ['SUBMITTED', 'APPROVED', 'REJECTED']);
export type BrandStatus = (typeof brandStatus.enumValues)[number];

/**
 * A customer's own WhatsApp brand, from the onboarding form. Once the platform admin has set up
 * the customer's number with WhatsApp, approving the brand links that number and the customer
 * can send Branded campaigns from it.
 */
export const brands = pgTable(
  'brands',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id),
    organizationName: varchar('organization_name', { length: 150 }).notNull(),
    displayName: varchar('display_name', { length: 100 }).notNull(), // name shown on WhatsApp
    category: varchar('category', { length: 60 }).notNull(),
    description: text('description'),
    website: varchar('website', { length: 255 }),
    email: varchar('email', { length: 254 }).notNull(),
    phoneNumber: varchar('phone_number', { length: 20 }).notNull(), // number to register, digits
    address: text('address').notNull(),
    taxId: varchar('tax_id', { length: 30 }),
    contactName: varchar('contact_name', { length: 120 }).notNull(),
    logoMediaId: uuid('logo_media_id').references(() => media.id),
    status: brandStatus('status').notNull().default('SUBMITTED'),
    reviewNote: text('review_note'),
    senderNumberId: uuid('sender_number_id').references(() => senderNumbers.id),
    submittedByUserId: uuid('submitted_by_user_id').references(() => users.id),
    reviewedByUserId: uuid('reviewed_by_user_id').references(() => users.id),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    ...timestamps,
  },
  (t) => [index('brands_account_idx').on(t.accountId)],
);

/** Automatic replies for a WhatsApp number. */
export const autoResponders = pgTable('auto_responders', {
  id: uuid('id').primaryKey().defaultRandom(),
  senderNumberId: uuid('sender_number_id')
    .notNull()
    .unique()
    .references(() => senderNumbers.id),
  accountId: uuid('account_id')
    .notNull()
    .references(() => accounts.id),
  name: varchar('name', { length: 120 }).notNull(),
  /** Sent when someone writes (at most once a day per person). Empty = off. */
  normalMessage: text('normal_message'),
  /** Sent when someone replies STOP. Empty = off. */
  optOutMessage: text('opt_out_message'),
  isActive: boolean('is_active').notNull().default(true),
  ...timestamps,
});

// ---------------------------------------------------------------------------
// Phase 6: Bot Studio
// ---------------------------------------------------------------------------

export type BotNodeType = 'MESSAGE' | 'BUTTONS' | 'LIST' | 'QUESTION' | 'HANDOFF';

/** One step of a bot. */
export interface BotNode {
  id: string;
  type: BotNodeType;
  /** Shown in the editor only. */
  name: string;
  /** What the bot says. {{name}} and {{variable}} are filled in. */
  text: string;
  /** MESSAGE: optional image; BUTTONS: optional image header. */
  imageUrl?: string;
  /** BUTTONS (1 to 3) and LIST (1 to 10): the choices, each leading to a step. */
  options?: { id: string; title: string; description?: string; next?: string }[];
  /** LIST: label of the button that opens the menu. */
  listButton?: string;
  /** QUESTION: where the answer is saved. */
  variable?: string;
  validation?: 'TEXT' | 'NUMBER' | 'EMAIL' | 'PHONE';
  /** MESSAGE and QUESTION: the step after this one. None = the chat ends. */
  next?: string;
}

export interface BotTrigger {
  id: string;
  keywords: string[];
  match: 'EXACT' | 'CONTAINS';
  startNodeId: string;
}

export interface BotFlow {
  nodes: BotNode[];
  triggers: BotTrigger[];
  /** When a message matches no keyword and no chat is going on. */
  fallback: { mode: 'START' | 'MESSAGE' | 'AI' | 'NONE'; startNodeId?: string; text?: string };
  ai: {
    /** What the business wants the AI to know: products, prices, timings, address, policies. */
    knowledge: string;
    /** Said when the AI can't answer from the knowledge. */
    noAnswerText?: string;
  };
}

export const bots = pgTable(
  'bots',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id),
    name: varchar('name', { length: 120 }).notNull(),
    senderNumberId: uuid('sender_number_id').references(() => senderNumbers.id),
    isActive: boolean('is_active').notNull().default(false),
    flow: jsonb('flow').$type<BotFlow>().notNull(),
    createdByUserId: uuid('created_by_user_id').references(() => users.id),
    ...timestamps,
  },
  (t) => [
    index('bots_account_idx').on(t.accountId),
    // One live bot per WhatsApp number
    uniqueIndex('bots_active_number_uq').on(t.senderNumberId).where(sql`${t.isActive}`),
  ],
);

export const botSessionStatus = pgEnum('bot_session_status', ['ACTIVE', 'COMPLETED', 'HANDOFF', 'ENDED']);

/** One person's chat with a bot: where they are and what they answered. */
export const botSessions = pgTable(
  'bot_sessions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    botId: uuid('bot_id')
      .notNull()
      .references(() => bots.id, { onDelete: 'cascade' }),
    senderNumberId: uuid('sender_number_id')
      .notNull()
      .references(() => senderNumbers.id),
    contactPhone: varchar('contact_phone', { length: 20 }).notNull(),
    contactName: varchar('contact_name', { length: 120 }),
    status: botSessionStatus('status').notNull().default('ACTIVE'),
    /** The step waiting for the person's answer. */
    nodeId: varchar('node_id', { length: 40 }),
    variables: jsonb('variables').$type<Record<string, string>>().notNull().default({}),
    handoffUntil: timestamp('handoff_until', { withTimezone: true }),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    lastActivityAt: timestamp('last_activity_at', { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (t) => [
    index('bot_sessions_contact_idx').on(t.senderNumberId, t.contactPhone, t.lastActivityAt),
    index('bot_sessions_bot_idx').on(t.botId, t.lastActivityAt),
  ],
);

// ---------------------------------------------------------------------------
// Phase 7: notifications
// ---------------------------------------------------------------------------

export const notificationLevel = pgEnum('notification_level', ['INFO', 'SUCCESS', 'WARNING', 'ERROR']);

/** Bell notifications. Shared by everyone who logs in to the account. */
export const notifications = pgTable(
  'notifications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    accountId: uuid('account_id')
      .notNull()
      .references(() => accounts.id, { onDelete: 'cascade' }),
    type: varchar('type', { length: 40 }).notNull(),
    level: notificationLevel('level').notNull().default('INFO'),
    title: varchar('title', { length: 200 }).notNull(),
    body: text('body'),
    /** Panel page to open, e.g. /campaigns/premium/reports/<id>. */
    link: varchar('link', { length: 300 }),
    /** Stops the same alert twice (e.g. low credits once a day). */
    dedupeKey: varchar('dedupe_key', { length: 200 }),
    readAt: timestamp('read_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('notifications_account_idx').on(t.accountId, t.createdAt),
    uniqueIndex('notifications_dedupe_uq').on(t.accountId, t.dedupeKey),
  ],
);
