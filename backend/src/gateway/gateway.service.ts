import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AppEvents } from '../common/events';
import { randomUUID } from 'crypto';
import { and, count, desc, eq, inArray, isNull, ne, or, SQL, sql } from 'drizzle-orm';
import { AuthUser } from '../auth/decorators';
import { decrypt, encrypt, maskSecret } from '../common/crypto';
import { parsePhone } from '../common/phone';
import { Db, InjectDb } from '../db/db.module';
import {
  accounts,
  messages,
  MessageStatus,
  messageTemplates,
  Provider,
  senderNumbers,
  TemplateContent,
  RichMessage,
  TemplatePayload,
  TemplateStatus,
} from '../db/schema';
import {
  CreateNumberDto,
  CreateTemplateDto,
  MessagesQuery,
  TemplatesQuery,
  TestSendDto,
  UpdateNumberDto,
} from './gateway.dto';
import { MetaProvider } from './providers/meta.provider';
import { TestProvider } from './providers/test.provider';
import { MessagingProvider, ProviderError, ProviderEvent, SenderCreds } from './providers/types';

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
export type SenderNumber = typeof senderNumbers.$inferSelect;
export type MessageRow = typeof messages.$inferSelect;

/** Events other modules (campaigns, inbox, opt-outs) listen to. */
export const GatewayEvents = {
  /** A message's delivery status changed. Payload: { message: MessageRow; status } */
  STATUS: 'gateway.message.status',
  /** A contact sent us a message. Payload: { message: MessageRow } */
  RECEIVED: 'gateway.message.received',
  /** Meta approved/rejected a template. Payload: { templateId; status } */
  TEMPLATE: 'gateway.template.status',
} as const;

/** Order of delivery statuses: a status only moves forward, never back. */
const RANK: Record<MessageStatus, number> = {
  QUEUED: 0,
  SENDING: 1,
  SENT: 2,
  DELIVERED: 3,
  READ: 4,
  FAILED: 5,
  CANCELLED: 6,
  RECEIVED: 0,
};

export interface EnqueueItem {
  accountId: string;
  senderNumberId: string;
  /** Digits with country code. Validate with parsePhone before calling. */
  to: string;
  templateId?: string;
  payload?: TemplatePayload;
  text?: string;
  /** Buttons, list or image (free-form, inside the 24-hour window). Put it in payload.rich. */
  campaignId?: string;
  /** ISO country of the contact. */
  countryCode?: string;
}

/** Text shown in the inbox for a buttons / list / image message. */
export function richBody(m: RichMessage) {
  if (m.kind === 'image') return m.caption ?? '';
  if (m.kind === 'buttons') return `${m.body}\n${m.buttons.map((b) => `[${b.title}]`).join(' ')}`;
  return `${m.body}\n${m.rows.map((r) => `- ${r.title}`).join('\n')}`;
}

/** Fills {{1}}, {{2}}... with values, for showing the message in the inbox. */
export function renderBody(body: string, params: string[] = []) {
  return body.replace(/\{\{(\d+)\}\}/g, (m, n) => params[Number(n) - 1] ?? m);
}

@Injectable()
export class GatewayService implements OnModuleInit {
  private readonly log = new Logger('Gateway');

  constructor(
    @InjectDb() private readonly db: Db,
    private readonly config: ConfigService,
    private readonly meta: MetaProvider,
    private readonly test: TestProvider,
    private readonly events: EventEmitter2,
  ) {}

  onModuleInit() {
    this.test.onEvents((e) => this.handleEvents('TEST', e));
  }

  provider(p: Provider): MessagingProvider {
    return p === 'META' ? this.meta : this.test;
  }

  creds(n: SenderNumber): SenderCreds {
    const token = n.accessTokenEnc ? decrypt(n.accessTokenEnc) : this.config.get<string>('META_ACCESS_TOKEN');
    if (n.provider === 'META' && !token) {
      throw new ProviderError('No access token: add one to this number or set META_ACCESS_TOKEN', 'CONFIG', false, undefined, true);
    }
    return { phoneNumberId: n.phoneNumberId, wabaId: n.wabaId, accessToken: token ?? 'test' };
  }

  // ------------------------------------------------------------ sender numbers

  /** Safe to send to the browser: the token is never returned. */
  private publicNumber(n: SenderNumber & { ownerUsername?: string | null }) {
    const { accessTokenEnc, ...rest } = n;
    let token: string | null = null;
    try {
      token = accessTokenEnc ? maskSecret(decrypt(accessTokenEnc)) : null;
    } catch {
      token = 'unreadable';
    }
    return { ...rest, accessToken: token, usesPlatformToken: !accessTokenEnc && n.provider === 'META' };
  }

  async listNumbers() {
    const rows = await this.db
      .select({ n: senderNumbers, ownerUsername: accounts.username })
      .from(senderNumbers)
      .leftJoin(accounts, eq(accounts.id, senderNumbers.ownerAccountId))
      .orderBy(senderNumbers.service, desc(senderNumbers.isDefault), senderNumbers.label);
    return rows.map((r) => this.publicNumber({ ...r.n, ownerUsername: r.ownerUsername }));
  }

  async getNumber(id: string) {
    const [n] = await this.db.select().from(senderNumbers).where(eq(senderNumbers.id, id));
    if (!n) throw new NotFoundException('Sender number not found');
    return n;
  }

  async createNumber(dto: CreateNumberDto) {
    const isTest = dto.provider === 'TEST';
    const phoneNumberId = isTest ? `test-${dto.phoneNumber}` : dto.phoneNumberId!;
    const [exists] = await this.db
      .select({ id: senderNumbers.id })
      .from(senderNumbers)
      .where(and(eq(senderNumbers.provider, dto.provider), eq(senderNumbers.phoneNumberId, phoneNumberId)));
    if (exists) throw new ConflictException('This number is already added');

    const id = await this.db.transaction(async (tx) => {
      if (dto.isDefault) await this.clearDefault(tx, dto.service, dto.ownerAccountId ?? null);
      const [row] = await tx
        .insert(senderNumbers)
        .values({
          label: dto.label,
          provider: dto.provider,
          service: dto.service,
          ownerAccountId: dto.ownerAccountId ?? null,
          phoneNumber: dto.phoneNumber,
          phoneNumberId,
          wabaId: isTest ? 'test-waba' : dto.wabaId!,
          accessTokenEnc: dto.accessToken ? encrypt(dto.accessToken.trim()) : null,
          ratePerSecond: dto.ratePerSecond ?? 20,
          isDefault: dto.isDefault ?? false,
        })
        .returning({ id: senderNumbers.id });
      return row.id;
    });
    // Check the connection right away so mistakes show up now, not during a campaign
    await this.refreshNumber(id).catch(() => {});
    return this.publicNumber(await this.getNumber(id));
  }

  async updateNumber(id: string, dto: UpdateNumberDto) {
    const n = await this.getNumber(id);
    await this.db.transaction(async (tx) => {
      if (dto.isDefault) await this.clearDefault(tx, n.service, n.ownerAccountId);
      await tx
        .update(senderNumbers)
        .set({
          ...(dto.label !== undefined && { label: dto.label }),
          ...(dto.status !== undefined && { status: dto.status }),
          ...(dto.ratePerSecond !== undefined && { ratePerSecond: dto.ratePerSecond }),
          ...(dto.isDefault !== undefined && { isDefault: dto.isDefault }),
          ...(dto.accessToken && { accessTokenEnc: encrypt(dto.accessToken.trim()), lastError: null }),
        })
        .where(eq(senderNumbers.id, id));
    });
    return this.publicNumber(await this.getNumber(id));
  }

  private async clearDefault(tx: Tx, service: 'PREMIUM' | 'BRANDED', ownerAccountId: string | null) {
    await tx
      .update(senderNumbers)
      .set({ isDefault: false })
      .where(
        and(
          eq(senderNumbers.service, service),
          ownerAccountId ? eq(senderNumbers.ownerAccountId, ownerAccountId) : isNull(senderNumbers.ownerAccountId),
        ),
      );
  }

  /** Asks WhatsApp for the number's name, quality and limit. Saves any error on the number. */
  async refreshNumber(id: string) {
    const n = await this.getNumber(id);
    try {
      const info = await this.provider(n.provider).getNumberInfo(this.creds(n));
      await this.db
        .update(senderNumbers)
        .set({
          displayName: info.verifiedName ?? n.displayName,
          qualityRating: info.qualityRating ?? n.qualityRating,
          messagingLimit: info.messagingLimit ?? n.messagingLimit,
          lastError: null,
        })
        .where(eq(senderNumbers.id, id));
    } catch (e) {
      await this.db.update(senderNumbers).set({ lastError: (e as Error).message }).where(eq(senderNumbers.id, id));
      throw new BadRequestException(`WhatsApp said: ${(e as Error).message}`);
    }
    return this.publicNumber(await this.getNumber(id));
  }

  /** The active default number for a service (shared platform number unless an owner is given). */
  async defaultNumber(service: 'PREMIUM' | 'BRANDED', ownerAccountId?: string) {
    const [n] = await this.db
      .select()
      .from(senderNumbers)
      .where(
        and(
          eq(senderNumbers.service, service),
          eq(senderNumbers.status, 'ACTIVE'),
          ownerAccountId ? eq(senderNumbers.ownerAccountId, ownerAccountId) : isNull(senderNumbers.ownerAccountId),
        ),
      )
      .orderBy(desc(senderNumbers.isDefault), senderNumbers.createdAt)
      .limit(1);
    return n ?? null;
  }

  // ------------------------------------------------------------ templates

  async listTemplates(q: TemplatesQuery) {
    const f: (SQL | undefined)[] = [];
    if (q.senderNumberId) f.push(eq(messageTemplates.senderNumberId, q.senderNumberId));
    if (q.status) f.push(eq(messageTemplates.status, q.status as TemplateStatus));
    if (q.search?.trim()) f.push(sql`${messageTemplates.name} ilike ${'%' + q.search.trim() + '%'}`);
    const where = and(...f);
    const [items, [{ total }]] = await Promise.all([
      this.db
        .select({
          t: messageTemplates,
          numberLabel: senderNumbers.label,
          provider: senderNumbers.provider,
        })
        .from(messageTemplates)
        .innerJoin(senderNumbers, eq(senderNumbers.id, messageTemplates.senderNumberId))
        .where(where)
        .orderBy(desc(messageTemplates.createdAt))
        .limit(q.pageSize)
        .offset((q.page - 1) * q.pageSize),
      this.db.select({ total: count() }).from(messageTemplates).where(where),
    ]);
    return {
      items: items.map((r) => ({ ...r.t, numberLabel: r.numberLabel, provider: r.provider })),
      total,
      page: q.page,
      pageSize: q.pageSize,
    };
  }

  async getTemplate(id: string) {
    const [t] = await this.db.select().from(messageTemplates).where(eq(messageTemplates.id, id));
    if (!t) throw new NotFoundException('Template not found');
    return t;
  }

  /** Saves the template and submits it to WhatsApp for approval. */
  async createTemplate(actor: AuthUser, dto: CreateTemplateDto) {
    const n = await this.getNumber(dto.senderNumberId);
    const placeholders = [...dto.body.matchAll(/\{\{(\d+)\}\}/g)].map((m) => Number(m[1]));
    const needed = placeholders.length ? Math.max(...placeholders) : 0;
    if (needed && (dto.bodyExamples?.length ?? 0) < needed) {
      throw new BadRequestException(`Add sample values for all ${needed} placeholders ({{1}} to {{${needed}}})`);
    }
    const content: TemplateContent = {
      ...(dto.header?.type === 'IMAGE' ? { header: { type: 'IMAGE', exampleUrl: dto.header.exampleUrl! } } : {}),
      ...(dto.header?.type === 'TEXT' ? { header: { type: 'TEXT', text: dto.header.text! } } : {}),
      body: dto.body,
      ...(needed ? { bodyExamples: dto.bodyExamples!.slice(0, needed) } : {}),
      ...(dto.footer ? { footer: dto.footer } : {}),
      ...(dto.buttons?.length ? { buttons: dto.buttons } : {}),
    };
    const language = dto.language ?? 'en';

    const [dup] = await this.db
      .select({ id: messageTemplates.id })
      .from(messageTemplates)
      .where(
        and(
          eq(messageTemplates.senderNumberId, n.id),
          eq(messageTemplates.name, dto.name),
          eq(messageTemplates.language, language),
        ),
      );
    if (dup) throw new ConflictException('A template with this name and language already exists for this number');

    const [row] = await this.db
      .insert(messageTemplates)
      .values({
        senderNumberId: n.id,
        accountId: actor.accountId,
        name: dto.name,
        language,
        category: dto.category,
        content,
        status: 'DRAFT',
      })
      .returning();

    try {
      const res = await this.provider(n.provider).createTemplate(this.creds(n), {
        name: row.name,
        language: row.language,
        category: row.category,
        content,
      });
      const status = this.mapTemplateStatus(res.status);
      await this.db
        .update(messageTemplates)
        .set({ providerTemplateId: res.id, status })
        .where(eq(messageTemplates.id, row.id));
    } catch (e) {
      await this.db
        .update(messageTemplates)
        .set({ status: 'REJECTED', rejectionReason: (e as Error).message })
        .where(eq(messageTemplates.id, row.id));
    }
    return this.getTemplate(row.id);
  }

  private mapTemplateStatus(s: string): TemplateStatus {
    const v = s.toUpperCase();
    if (v === 'APPROVED') return 'APPROVED';
    if (v === 'REJECTED') return 'REJECTED';
    if (v === 'PAUSED' || v === 'FLAGGED') return 'PAUSED';
    if (v === 'DISABLED' || v === 'PENDING_DELETION') return 'DISABLED';
    return 'PENDING';
  }

  /** Asks WhatsApp for the latest approval status (webhooks normally do this automatically). */
  async syncTemplate(id: string) {
    const t = await this.getTemplate(id);
    if (!t.providerTemplateId) throw new BadRequestException('This template was never accepted by WhatsApp');
    const n = await this.getNumber(t.senderNumberId);
    const res = await this.provider(n.provider).getTemplateStatus(this.creds(n), t.providerTemplateId);
    await this.db
      .update(messageTemplates)
      .set({ status: this.mapTemplateStatus(res.status), rejectionReason: res.reason ?? null })
      .where(eq(messageTemplates.id, id));
    return this.getTemplate(id);
  }

  // ------------------------------------------------------------ queue

  /**
   * Adds outgoing messages to the sending queue. Pass `tx` to save them together with a campaign.
   * `held`: the template is still waiting for approval; the messages wait until release() is called.
   * Returns the new message ids in the same order.
   */
  async enqueue(items: EnqueueItem[], tx: Tx | Db = this.db, opts: { held?: boolean } = {}): Promise<string[]> {
    if (items.length === 0) return [];
    const templateIds = [...new Set(items.map((i) => i.templateId).filter(Boolean))] as string[];
    const templates = templateIds.length
      ? await tx.select().from(messageTemplates).where(inArray(messageTemplates.id, templateIds))
      : [];
    const byId = new Map(templates.map((t) => [t.id, t]));
    for (const t of templates) {
      const ok = t.status === 'APPROVED' || (opts.held && (t.status === 'PENDING' || t.status === 'DRAFT'));
      if (!ok) throw new BadRequestException(`Template "${t.name}" is not approved yet`);
    }

    const now = new Date();
    const ids: string[] = [];
    // A few messages at once (a bot's reply) keep their order: each is due 1 ms after the last
    const ordered = items.length <= 20;
    for (let i = 0; i < items.length; i += 1000) {
      const rows = items.slice(i, i + 1000).map((it, j) => {
        const t = it.templateId ? byId.get(it.templateId) : undefined;
        const id = randomUUID();
        ids.push(id);
        return {
          id,
          accountId: it.accountId,
          senderNumberId: it.senderNumberId,
          direction: 'OUT' as const,
          contactPhone: it.to,
          kind: t
            ? ('TEMPLATE' as const)
            : it.payload?.rich
              ? it.payload.rich.kind === 'image'
                ? ('IMAGE' as const)
                : ('INTERACTIVE' as const)
              : ('TEXT' as const),
          templateId: t?.id ?? null,
          payload: it.payload ?? null,
          body: t
            ? renderBody(t.content.body, it.payload?.bodyParams)
            : it.payload?.rich
              ? richBody(it.payload.rich)
              : (it.text ?? ''),
          status: 'QUEUED' as const,
          // Held messages have no send time, so the worker leaves them alone
          nextAttemptAt: opts.held ? null : ordered ? new Date(now.getTime() + i + j) : now,
          // Same for the time shown in the inbox, so a bot's replies list in the order sent
          ...(ordered ? { createdAt: new Date(now.getTime() + i + j) } : {}),
          campaignId: it.campaignId ?? null,
          countryCode: it.countryCode ?? null,
        };
      });
      await tx.insert(messages).values(rows);
    }
    return ids;
  }

  /** Starts sending held messages of a campaign (its template was approved). */
  async releaseCampaign(campaignId: string, tx: Tx | Db = this.db) {
    const rows = await tx
      .update(messages)
      .set({ nextAttemptAt: new Date() })
      .where(and(eq(messages.campaignId, campaignId), eq(messages.status, 'QUEUED'), isNull(messages.nextAttemptAt)))
      .returning({ id: messages.id });
    return rows.length;
  }

  /** Stops messages of a campaign that haven't gone out yet. Returns how many. */
  async cancelQueued(campaignId: string, reason: string, tx: Tx | Db = this.db) {
    const rows = await tx
      .update(messages)
      .set({ status: 'CANCELLED', errorCode: 'CANCELLED', errorMessage: reason, nextAttemptAt: null })
      .where(and(eq(messages.campaignId, campaignId), eq(messages.status, 'QUEUED')))
      .returning({ id: messages.id });
    return rows.length;
  }

  /** Admin "send a test message" from one number. Not charged. */
  async sendTest(actor: AuthUser, numberId: string, dto: TestSendDto) {
    const n = await this.getNumber(numberId);
    if (n.status !== 'ACTIVE') throw new BadRequestException('This number is switched off');
    const to = parsePhone(dto.to);
    if (!to) throw new BadRequestException('That phone number does not look right. Include the country code.');
    if (dto.templateId) {
      const t = await this.getTemplate(dto.templateId);
      if (t.senderNumberId !== n.id) throw new BadRequestException('This template belongs to another number');
    }
    const [id] = await this.enqueue([
      {
        accountId: actor.accountId,
        senderNumberId: n.id,
        to: to.digits,
        templateId: dto.templateId,
        payload: dto.templateId ? { bodyParams: dto.bodyParams } : undefined,
        text: dto.text,
      },
    ]);
    return this.getMessage(id);
  }

  async getMessage(id: string) {
    const [m] = await this.db.select().from(messages).where(eq(messages.id, id));
    if (!m) throw new NotFoundException('Message not found');
    return m;
  }

  async listMessages(q: MessagesQuery) {
    const f: (SQL | undefined)[] = [];
    if (q.senderNumberId) f.push(eq(messages.senderNumberId, q.senderNumberId));
    if (q.direction) f.push(eq(messages.direction, q.direction));
    if (q.status) f.push(eq(messages.status, q.status as MessageStatus));
    if (q.search?.trim()) {
      const s = q.search.trim().replace(/[^\d]/g, '');
      if (s) f.push(sql`${messages.contactPhone} like ${'%' + s + '%'}`);
    }
    const where = and(...f);
    const [items, [{ total }]] = await Promise.all([
      this.db
        .select({
          m: messages,
          numberLabel: senderNumbers.label,
          accountUsername: accounts.username,
          templateName: messageTemplates.name,
        })
        .from(messages)
        .innerJoin(senderNumbers, eq(senderNumbers.id, messages.senderNumberId))
        .innerJoin(accounts, eq(accounts.id, messages.accountId))
        .leftJoin(messageTemplates, eq(messageTemplates.id, messages.templateId))
        .where(where)
        .orderBy(desc(messages.createdAt))
        .limit(q.pageSize)
        .offset((q.page - 1) * q.pageSize),
      this.db.select({ total: count() }).from(messages).where(where),
    ]);
    return {
      items: items.map((r) => ({ ...r.m, numberLabel: r.numberLabel, accountUsername: r.accountUsername, templateName: r.templateName })),
      total,
      page: q.page,
      pageSize: q.pageSize,
    };
  }

  // ------------------------------------------------------------ incoming events

  /** Applies webhook events. Called by the webhook controller and the test provider. */
  async handleEvents(provider: Provider, events: ProviderEvent[]) {
    for (const e of events) {
      try {
        if (e.kind === 'status') await this.applyStatus(provider, e);
        else if (e.kind === 'inbound') await this.applyInbound(provider, e);
        else if (e.kind === 'template') await this.applyTemplate(e);
        else if (e.kind === 'number') await this.applyNumberUpdate(provider, e);
      } catch (err) {
        this.log.error(`Could not apply ${e.kind} event: ${(err as Error).message}`);
      }
    }
  }

  private async applyStatus(
    provider: Provider,
    e: Extract<ProviderEvent, { kind: 'status' }>,
    attempt = 0,
  ): Promise<void> {
    const [m] = await this.db.select().from(messages).where(eq(messages.providerMessageId, e.providerMessageId));
    if (!m) {
      // WhatsApp can report a status before our send call has saved the message id
      if (attempt < 3) {
        setTimeout(() => void this.applyStatus(provider, e, attempt + 1).catch(() => {}), [2000, 5000, 15000][attempt]).unref();
      } else {
        this.log.warn(`Status for unknown message ${e.providerMessageId}`);
      }
      return;
    }
    if (m.direction !== 'OUT') return;

    const isFailure = e.status === 'FAILED';
    // Statuses only move forward. A failure counts unless the message was already delivered or read.
    if (isFailure ? RANK[m.status] >= RANK.DELIVERED : RANK[e.status] <= RANK[m.status]) return;

    const [updated] = await this.db
      .update(messages)
      .set({
        status: e.status,
        ...(e.status === 'SENT' && { sentAt: m.sentAt ?? e.at }),
        ...(e.status === 'DELIVERED' && { deliveredAt: e.at, sentAt: m.sentAt ?? e.at }),
        ...(e.status === 'READ' && { readAt: e.at, deliveredAt: m.deliveredAt ?? e.at, sentAt: m.sentAt ?? e.at }),
        ...(isFailure && { failedAt: e.at, errorCode: e.errorCode ?? null, errorMessage: e.errorMessage ?? null }),
      })
      .where(and(eq(messages.id, m.id), eq(messages.status, m.status)))
      .returning();
    if (updated) this.events.emit(GatewayEvents.STATUS, { message: updated, status: e.status });
  }

  private async applyInbound(provider: Provider, e: Extract<ProviderEvent, { kind: 'inbound' }>) {
    const [n] = await this.db
      .select()
      .from(senderNumbers)
      .where(and(eq(senderNumbers.provider, provider), eq(senderNumbers.phoneNumberId, e.phoneNumberId)));
    if (!n) {
      this.log.warn(`Message for unknown number ${e.phoneNumberId}`);
      return;
    }

    // Which account and campaign the reply belongs to: the message it answers, else the latest
    // message we sent this contact from this number, else the number's owner / the platform.
    let accountId = n.ownerAccountId;
    let campaignId: string | null = null;
    const [answered] = e.replyToProviderId
      ? await this.db.select().from(messages).where(eq(messages.providerMessageId, e.replyToProviderId))
      : [];
    const [latest] = answered
      ? [answered]
      : await this.db
          .select()
          .from(messages)
          .where(
            and(
              eq(messages.senderNumberId, n.id),
              eq(messages.contactPhone, e.from),
              eq(messages.direction, 'OUT'),
              ne(messages.status, 'FAILED'),
            ),
          )
          .orderBy(desc(messages.createdAt))
          .limit(1);
    if (latest) {
      accountId = latest.accountId;
      campaignId = latest.campaignId;
    }
    if (!accountId) {
      const [admin] = await this.db.select({ id: accounts.id }).from(accounts).where(eq(accounts.type, 'ADMIN')).limit(1);
      accountId = admin.id;
    }

    const [row] = await this.db
      .insert(messages)
      .values({
        accountId,
        senderNumberId: n.id,
        direction: 'IN',
        contactPhone: e.from,
        contactName: e.contactName ?? null,
        kind: e.type,
        body: e.text ?? null,
        status: 'RECEIVED',
        providerMessageId: e.providerMessageId,
        replyToProviderId: e.replyToProviderId ?? null,
        payload: e.replyId ? { replyId: e.replyId } : null,
        campaignId,
        createdAt: e.at,
      })
      .onConflictDoNothing({ target: messages.providerMessageId })
      .returning();
    if (row) this.events.emit(GatewayEvents.RECEIVED, { message: row });
  }

  private async applyTemplate(e: Extract<ProviderEvent, { kind: 'template' }>) {
    const [t] = await this.db
      .update(messageTemplates)
      .set({ status: e.status === 'PENDING' ? 'PENDING' : e.status, rejectionReason: e.reason ?? null })
      .where(eq(messageTemplates.providerTemplateId, e.providerTemplateId))
      .returning();
    if (t) this.events.emit(GatewayEvents.TEMPLATE, { templateId: t.id, status: t.status });
  }

  private async applyNumberUpdate(provider: Provider, e: Extract<ProviderEvent, { kind: 'number' }>) {
    const digits = e.displayPhoneNumber?.replace(/[^\d]/g, '');
    const match = [
      e.phoneNumberId ? eq(senderNumbers.phoneNumberId, e.phoneNumberId) : undefined,
      digits ? eq(senderNumbers.phoneNumber, digits) : undefined,
    ].filter(Boolean) as SQL[];
    if (!match.length) return;
    const where = and(eq(senderNumbers.provider, provider), or(...match));
    const before = await this.db.select({ id: senderNumbers.id, q: senderNumbers.qualityRating }).from(senderNumbers).where(where);
    await this.db
      .update(senderNumbers)
      .set({
        ...(e.qualityRating && { qualityRating: e.qualityRating }),
        ...(e.messagingLimit && { messagingLimit: e.messagingLimit }),
      })
      .where(where);
    // Quality going down puts the number at risk of being limited: tell people
    const q = e.qualityRating?.toUpperCase();
    for (const b of before) {
      if (q && q !== b.q?.toUpperCase() && (q === 'YELLOW' || q === 'RED')) {
        this.events.emit(AppEvents.NUMBER_ALERT, { senderNumberId: b.id, qualityRating: q, previousQuality: b.q });
      }
    }
  }
}
