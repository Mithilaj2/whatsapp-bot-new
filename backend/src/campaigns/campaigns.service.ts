import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OnEvent } from '@nestjs/event-emitter';
import { createHash, randomInt } from 'crypto';
import { and, count, desc, eq, ilike, inArray, isNull, or, sql, SQL } from 'drizzle-orm';
import { inTreeOf } from '../accounts/scope';
import { AuthUser } from '../auth/decorators';
import { parsePhone } from '../common/phone';
import { CreditsService } from '../credits/credits.service';
import { Db, InjectDb } from '../db/db.module';
import {
  accounts,
  brands,
  CampaignContent,
  CampaignCountry,
  campaigns,
  countries,
  media,
  messages,
  messageTemplates,
  senderNumbers,
  TemplateButton,
  users,
} from '../db/schema';
import { GatewayEvents, GatewayService, SenderNumber } from '../gateway/gateway.service';
import { OptOutsService } from '../optouts/optouts.service';
import {
  CampaignDefaultsDto,
  CampaignsQuery,
  CheckRecipientsDto,
  CreateCampaignDto,
  RecipientsQuery,
} from './campaigns.dto';

type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
type Campaign = typeof campaigns.$inferSelect;
type Service = 'PREMIUM' | 'BRANDED';
interface Limits {
  demoMax: number;
  min: number;
  max: number;
}

const FOOTER = 'Reply STOP to unsubscribe';
/** No 0/O or 1/I so campaign numbers are easy to read out. */
const NO_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export interface RecipientSummary {
  total: number;
  valid: number;
  invalid: number;
  duplicates: number;
  optedOut: number;
  countryOff: number;
  recipients: number;
  invalidSamples: string[];
  byCountry: CampaignCountry[];
}

@Injectable()
export class CampaignsService {
  private readonly log = new Logger('Campaigns');
  private readonly limits: Record<Service, Limits>;

  constructor(
    @InjectDb() private readonly db: Db,
    private readonly config: ConfigService,
    private readonly gateway: GatewayService,
    private readonly credits: CreditsService,
    private readonly optOuts: OptOutsService,
  ) {
    const demoMax = Number(config.get('CAMPAIGN_DEMO_MAX', 10));
    const max = Number(config.get('CAMPAIGN_MAX_RECIPIENTS', 100000));
    this.limits = {
      PREMIUM: { demoMax, max, min: Number(config.get('CAMPAIGN_MIN_RECIPIENTS', 1000)) },
      // Customers send from their own number, so small lists are fine
      BRANDED: { demoMax, max, min: Number(config.get('CAMPAIGN_BRANDED_MIN', 11)) },
    };
  }

  limitsFor(service: Service): Limits {
    return this.limits[service];
  }

  // ------------------------------------------------------------ who and from where

  /** The account the campaign is for: me, or an account below me. */
  private async resolveAccount(actor: AuthUser, accountId?: string) {
    const id = accountId ?? actor.accountId;
    const [acc] = await this.db
      .select({ id: accounts.id, username: accounts.username, type: accounts.type, status: accounts.status })
      .from(accounts)
      .where(and(eq(accounts.id, id), isNull(accounts.deletedAt), inTreeOf(this.db, accounts.id, actor.accountId, 0)));
    if (!acc) throw new NotFoundException('Account not found');
    if (acc.status !== 'ACTIVE') throw new BadRequestException(`${acc.username} is suspended`);
    return acc;
  }

  /** Premium: the platform's shared number. Branded: the number of the account's approved brand. */
  private async senderFor(service: Service, accountId: string, brandId?: string): Promise<{ number: SenderNumber; brandId: string | null }> {
    if (service === 'PREMIUM') {
      const n = await this.gateway.defaultNumber(service);
      if (!n) throw new BadRequestException('Sending is not set up yet: no WhatsApp number for Premium Campaigns. Contact your provider.');
      return { number: n, brandId: null };
    }
    if (!brandId) throw new BadRequestException('Pick a brand');
    const [row] = await this.db
      .select({ brand: brands, number: senderNumbers })
      .from(brands)
      .leftJoin(senderNumbers, eq(senderNumbers.id, brands.senderNumberId))
      .where(and(eq(brands.id, brandId), eq(brands.accountId, accountId)));
    if (!row) throw new NotFoundException('Brand not found for this account');
    if (row.brand.status !== 'APPROVED' || !row.number) throw new BadRequestException('This brand is not approved yet');
    if (row.number.status !== 'ACTIVE') {
      throw new BadRequestException(`The WhatsApp number of ${row.brand.displayName} can't send right now. Contact your provider.`);
    }
    return { number: row.number, brandId: row.brand.id };
  }

  // ------------------------------------------------------------ recipients

  /** Splits pasted numbers and sorts them into valid, invalid, duplicate, opted out, country off. */
  async parseRecipients(numbersText: string, senderNumberId: string) {
    const tokens = numbersText
      .split(/[\n\r,;\t]+/)
      .map((t) => t.trim())
      .filter(Boolean);

    const activeCountries = new Map(
      (await this.db.select().from(countries).where(eq(countries.isActive, true))).map((c) => [c.code, c]),
    );

    const seen = new Set<string>();
    const invalidSamples: string[] = [];
    let invalid = 0;
    let duplicates = 0;
    let countryOff = 0;
    const valid: { digits: string; country: string }[] = [];

    for (const t of tokens) {
      const p = parsePhone(t);
      if (!p) {
        invalid++;
        if (invalidSamples.length < 10) invalidSamples.push(t.slice(0, 40));
        continue;
      }
      if (seen.has(p.digits)) {
        duplicates++;
        continue;
      }
      seen.add(p.digits);
      if (!activeCountries.has(p.country)) {
        countryOff++;
        continue;
      }
      valid.push(p);
    }

    const opted = await this.optOuts.optedOut(senderNumberId, valid.map((v) => v.digits));
    const recipients = valid.filter((v) => !opted.has(v.digits));

    const perCountry = new Map<string, number>();
    for (const r of recipients) perCountry.set(r.country, (perCountry.get(r.country) ?? 0) + 1);
    const byCountry: CampaignCountry[] = [...perCountry.entries()]
      .map(([code, n]) => ({ code, name: activeCountries.get(code)!.name, recipients: n, credits: n }))
      .sort((a, b) => b.recipients - a.recipients);

    const summary: RecipientSummary = {
      total: tokens.length,
      valid: valid.length,
      invalid,
      duplicates,
      optedOut: valid.length - recipients.length,
      countryOff,
      recipients: recipients.length,
      invalidSamples,
      byCountry,
    };
    return { summary, recipients, countryIds: new Map([...activeCountries].map(([k, v]) => [k, v.id])) };
  }

  /** What's wrong with this many recipients, if anything. */
  private limitProblem(service: Service, n: number): string | null {
    const { demoMax, min, max } = this.limits[service];
    if (n === 0) return 'No valid numbers to send to';
    if (n <= demoMax) return null;
    if (n < min) return `A full campaign needs at least ${min.toLocaleString('en-IN')} numbers (up to ${demoMax} counts as a demo)`;
    if (n > max) return `Maximum ${max.toLocaleString('en-IN')} numbers per campaign`;
    return null;
  }

  /** Live check for the composer: counts, credits needed per country, and whether there's enough. */
  async check(actor: AuthUser, dto: CheckRecipientsDto) {
    const account = await this.resolveAccount(actor, dto.accountId);
    const { number } = await this.senderFor(dto.service, account.id, dto.brandId);
    const { summary } = await this.parseRecipients(dto.numbers, number.id);
    const charged = account.type !== 'ADMIN';
    const balances = charged ? await this.credits.summary({ ...actor, accountId: account.id }) : null;

    const countries = summary.byCountry.map((c) => {
      const balance = balances?.byCountry.find((b) => b.service === dto.service && b.countryCode === c.code)?.balance ?? 0;
      return { ...c, balance: charged ? balance : null, enough: !charged || balance >= c.credits };
    });
    return {
      ...summary,
      byCountry: countries,
      creditsNeeded: charged ? summary.recipients : 0,
      enoughCredits: countries.every((c) => c.enough),
      isDemo: summary.recipients > 0 && summary.recipients <= this.limits[dto.service].demoMax,
      problem: this.limitProblem(dto.service, summary.recipients),
      limits: this.limits[dto.service],
    };
  }

  // ------------------------------------------------------------ template

  /** The composer's content as a WhatsApp template. Same text and buttons = same template. */
  private templateFor(content: CampaignContent) {
    const buttons: TemplateButton[] = [];
    if (content.callNumber) buttons.push({ type: 'PHONE_NUMBER', text: 'Call now', phone: content.callNumber });
    if (content.visitUrl) buttons.push({ type: 'URL', text: 'Visit website', url: content.visitUrl });
    buttons.push({ type: 'QUICK_REPLY', text: 'Stop' });
    const hash = createHash('sha256')
      .update(JSON.stringify({ body: content.message, footer: FOOTER, buttons }))
      .digest('hex')
      .slice(0, 20);
    return { name: `wb_${hash}`, body: content.message, buttons };
  }

  private async ensureTemplate(actor: AuthUser, number: SenderNumber, content: CampaignContent) {
    const t = this.templateFor(content);
    const find = () =>
      this.db
        .select()
        .from(messageTemplates)
        .where(
          and(
            eq(messageTemplates.senderNumberId, number.id),
            eq(messageTemplates.name, t.name),
            eq(messageTemplates.language, 'en'),
          ),
        )
        .then((r) => r[0]);
    const existing = await find();
    if (existing) return existing;
    try {
      return await this.gateway.createTemplate(actor, {
        senderNumberId: number.id,
        name: t.name,
        language: 'en',
        category: 'MARKETING',
        header: { type: 'IMAGE', exampleUrl: content.imageUrl },
        body: t.body,
        footer: FOOTER,
        buttons: t.buttons,
      });
    } catch (e) {
      // Someone submitted the same message at the same moment
      if (e instanceof ConflictException) return (await find())!;
      throw e;
    }
  }

  // ------------------------------------------------------------ create

  private async newCampaignNo(): Promise<string> {
    for (let i = 0; i < 10; i++) {
      const no = Array.from({ length: 6 }, () => NO_ALPHABET[randomInt(NO_ALPHABET.length)]).join('');
      const [taken] = await this.db.select({ id: campaigns.id }).from(campaigns).where(eq(campaigns.campaignNo, no));
      if (!taken) return no;
    }
    throw new Error('Could not pick a campaign number');
  }

  async create(actor: AuthUser, dto: CreateCampaignDto) {
    const account = await this.resolveAccount(actor, dto.accountId);
    const { number, brandId } = await this.senderFor(dto.service, account.id, dto.brandId);

    const { summary, recipients, countryIds } = await this.parseRecipients(dto.numbers, number.id);
    const problem = this.limitProblem(dto.service, summary.recipients);
    if (problem) throw new BadRequestException(problem);

    const [img] = await this.db.select().from(media).where(eq(media.id, dto.mediaId));
    if (!img) throw new BadRequestException('Upload the image again');

    let callNumber: string | undefined;
    if (dto.callNumber) {
      const p = parsePhone(dto.callNumber);
      if (!p) throw new BadRequestException('Call number does not look right');
      callNumber = `+${p.digits}`;
    }
    const imageUrl = `${this.config.get<string>('PUBLIC_API_URL', 'http://localhost:4000/api').replace(/\/$/, '')}/media/${img.fileName}`;
    const content: CampaignContent = { imageUrl, message: dto.message, callNumber, visitUrl: dto.visitUrl };

    const template = await this.ensureTemplate(actor, number, content);
    if (['REJECTED', 'DISABLED'].includes(template.status)) {
      throw new BadRequestException(
        `WhatsApp did not accept this message${template.rejectionReason ? ` (${template.rejectionReason})` : ''}. Change the text and try again.`,
      );
    }
    const approved = template.status === 'APPROVED';
    const charged = account.type !== 'ADMIN';
    const campaignNo = await this.newCampaignNo();

    const id = await this.db.transaction(async (tx) => {
      const [c] = await tx
        .insert(campaigns)
        .values({
          campaignNo,
          accountId: account.id,
          createdByUserId: actor.userId,
          service: dto.service,
          title: dto.title,
          senderNumberId: number.id,
          brandId,
          templateId: template.id,
          content,
          status: approved ? 'SENDING' : 'PENDING_APPROVAL',
          isDemo: summary.recipients <= this.limits[dto.service].demoMax,
          totalNumbers: summary.total,
          invalidNumbers: summary.invalid + summary.countryOff,
          duplicateNumbers: summary.duplicates,
          optedOutNumbers: summary.optedOut,
          recipients: summary.recipients,
          byCountry: summary.byCountry,
          creditsCharged: charged ? summary.recipients : 0,
          startedAt: approved ? new Date() : null,
        })
        .returning({ id: campaigns.id });

      if (charged) {
        // Throws "Not enough credits" and undoes everything
        await this.credits.spend(tx, {
          accountId: account.id,
          service: dto.service,
          byCountry: summary.byCountry.map((b) => ({
            countryId: countryIds.get(b.code)!,
            credits: b.credits,
            recipients: b.recipients,
          })),
          campaignId: c.id,
          campaignNo,
          userId: actor.userId,
        });
      }

      await this.gateway.enqueue(
        recipients.map((r) => ({
          accountId: account.id,
          senderNumberId: number.id,
          to: r.digits,
          countryCode: r.country,
          templateId: template.id,
          payload: { headerImageUrl: imageUrl },
          campaignId: c.id,
        })),
        tx,
        { held: !approved },
      );
      return c.id;
    });

    // The template may have been approved while we were saving
    if (!approved) await this.applyTemplateStatus(template.id);
    this.log.log(`Campaign ${campaignNo}: ${summary.recipients} recipients${approved ? '' : ', waiting for approval'}`);
    return this.detail(actor, id);
  }

  // ------------------------------------------------------------ lifecycle

  @OnEvent(GatewayEvents.TEMPLATE, { async: true })
  async onTemplateStatus({ templateId }: { templateId: string }) {
    await this.applyTemplateStatus(templateId);
  }

  /** Starts or rejects campaigns waiting for this template. */
  async applyTemplateStatus(templateId: string) {
    const [t] = await this.db.select().from(messageTemplates).where(eq(messageTemplates.id, templateId));
    if (!t) return;
    const waiting = await this.db
      .select({ id: campaigns.id })
      .from(campaigns)
      .where(and(eq(campaigns.templateId, templateId), eq(campaigns.status, 'PENDING_APPROVAL')));

    for (const { id } of waiting) {
      if (t.status === 'APPROVED') {
        await this.db.transaction(async (tx) => {
          const [c] = await tx
            .update(campaigns)
            .set({ status: 'SENDING', startedAt: new Date() })
            .where(and(eq(campaigns.id, id), eq(campaigns.status, 'PENDING_APPROVAL')))
            .returning();
          if (c) {
            const n = await this.gateway.releaseCampaign(id, tx);
            this.log.log(`Campaign ${c.campaignNo} approved, sending ${n} messages`);
          }
        });
      } else if (t.status === 'REJECTED' || t.status === 'DISABLED') {
        const reason = `WhatsApp did not approve the message${t.rejectionReason ? `: ${t.rejectionReason}` : ''}`;
        await this.db.transaction(async (tx) => {
          const [c] = await tx
            .update(campaigns)
            .set({ status: 'REJECTED', rejectionReason: reason, completedAt: new Date() })
            .where(and(eq(campaigns.id, id), eq(campaigns.status, 'PENDING_APPROVAL')))
            .returning();
          if (c) await this.gateway.cancelQueued(id, reason, tx);
        });
        await this.refundCampaign(id);
      }
    }
  }

  /**
   * Gives back one credit per failed or cancelled message that hasn't been refunded yet, as one
   * ledger row per country. Safe to run any number of times.
   */
  async refundCampaign(campaignId: string) {
    const [c] = await this.db.select().from(campaigns).where(eq(campaigns.id, campaignId));
    if (!c) return 0;
    return this.db.transaction(async (tx) => {
      const rows = await tx
        .update(messages)
        .set({ refundedAt: new Date() })
        .where(
          and(
            eq(messages.campaignId, campaignId),
            inArray(messages.status, ['FAILED', 'CANCELLED']),
            isNull(messages.refundedAt),
          ),
        )
        .returning({ country: messages.countryCode });
      if (!rows.length || c.creditsCharged === 0) return 0;

      const perCountry = new Map<string, number>();
      for (const r of rows) perCountry.set(r.country ?? '', (perCountry.get(r.country ?? '') ?? 0) + 1);
      const codes = [...perCountry.keys()].filter(Boolean);
      const ids = new Map(
        (await tx.select({ id: countries.id, code: countries.code }).from(countries).where(inArray(countries.code, codes))).map(
          (x) => [x.code, x.id],
        ),
      );
      for (const [code, n] of perCountry) {
        const countryId = ids.get(code);
        if (!countryId) continue;
        await this.credits.refund(tx, {
          accountId: c.accountId,
          service: c.service,
          countryId,
          credits: n,
          campaignId: c.id,
          campaignNo: c.campaignNo,
          reason: `Refund: ${n} message${n === 1 ? '' : 's'} not delivered`,
        });
      }
      await tx
        .update(campaigns)
        .set({ creditsRefunded: sql`${campaigns.creditsRefunded} + ${rows.length}` })
        .where(eq(campaigns.id, campaignId));
      return rows.length;
    });
  }

  /** Runs every few seconds: refunds, missed approvals, and finishing campaigns. */
  async sweep() {
    const toRefund = await this.db
      .selectDistinct({ id: messages.campaignId })
      .from(messages)
      .where(
        and(
          sql`${messages.campaignId} is not null`,
          inArray(messages.status, ['FAILED', 'CANCELLED']),
          isNull(messages.refundedAt),
        ),
      )
      .limit(100);
    for (const r of toRefund) await this.refundCampaign(r.id!);

    const pending = await this.db
      .selectDistinct({ templateId: campaigns.templateId })
      .from(campaigns)
      .innerJoin(messageTemplates, eq(messageTemplates.id, campaigns.templateId))
      .where(
        and(eq(campaigns.status, 'PENDING_APPROVAL'), inArray(messageTemplates.status, ['APPROVED', 'REJECTED', 'DISABLED'])),
      );
    for (const p of pending) await this.applyTemplateStatus(p.templateId);

    // Finished: nothing left waiting or in flight
    const done = await this.db
      .update(campaigns)
      .set({ status: 'COMPLETED', completedAt: new Date() })
      .where(
        and(
          eq(campaigns.status, 'SENDING'),
          sql`not exists (select 1 from ${messages} m where m.campaign_id = ${campaigns.id} and m.status in ('QUEUED','SENDING'))`,
        ),
      )
      .returning({ id: campaigns.id, no: campaigns.campaignNo });
    for (const d of done) {
      await this.refundCampaign(d.id);
      this.log.log(`Campaign ${d.no} completed`);
    }
  }

  async cancel(actor: AuthUser, id: string) {
    const c = await this.getInScope(actor, id);
    if (!['PENDING_APPROVAL', 'SENDING'].includes(c.status)) {
      throw new BadRequestException('Only campaigns that are waiting or sending can be stopped');
    }
    let stopped = 0;
    await this.db.transaction(async (tx) => {
      const [row] = await tx
        .update(campaigns)
        .set({ status: 'CANCELLED', completedAt: new Date() })
        .where(and(eq(campaigns.id, id), inArray(campaigns.status, ['PENDING_APPROVAL', 'SENDING'])))
        .returning();
      if (!row) throw new ConflictException('The campaign just finished');
      stopped = await this.gateway.cancelQueued(id, 'Campaign stopped', tx);
    });
    const refunded = await this.refundCampaign(id);
    return { stopped, refunded, campaign: await this.detail(actor, id) };
  }

  // ------------------------------------------------------------ reading

  private async getInScope(actor: AuthUser, id: string): Promise<Campaign> {
    const [c] = await this.db
      .select()
      .from(campaigns)
      .where(and(eq(campaigns.id, id), inTreeOf(this.db, campaigns.accountId, actor.accountId, 0)));
    if (!c) throw new NotFoundException('Campaign not found');
    return c;
  }

  /** Live counts per campaign, from the messages themselves. */
  private async stats(ids: string[]) {
    if (!ids.length) return new Map<string, Record<string, number>>();
    const res = await this.db.execute<{
      campaign_id: string;
      queued: number;
      sent: number;
      delivered: number;
      read: number;
      failed: number;
      cancelled: number;
      replies: number;
    }>(sql`
      select campaign_id,
        count(*) filter (where direction = 'OUT' and status in ('QUEUED','SENDING'))::int as queued,
        count(*) filter (where direction = 'OUT' and status in ('SENT','DELIVERED','READ'))::int as sent,
        count(*) filter (where direction = 'OUT' and status in ('DELIVERED','READ'))::int as delivered,
        count(*) filter (where direction = 'OUT' and status = 'READ')::int as read,
        count(*) filter (where direction = 'OUT' and status = 'FAILED')::int as failed,
        count(*) filter (where direction = 'OUT' and status = 'CANCELLED')::int as cancelled,
        count(distinct contact_phone) filter (where direction = 'IN')::int as replies
      from ${messages}
      where campaign_id in (${sql.join(ids.map((i) => sql`${i}`), sql`, `)})
      group by campaign_id`);
    return new Map(res.rows.map(({ campaign_id, ...rest }) => [campaign_id, rest]));
  }

  private columns = {
    id: campaigns.id,
    campaignNo: campaigns.campaignNo,
    accountId: campaigns.accountId,
    accountUsername: accounts.username,
    accountName: accounts.name,
    service: campaigns.service,
    brandName: brands.displayName,
    title: campaigns.title,
    status: campaigns.status,
    isDemo: campaigns.isDemo,
    recipients: campaigns.recipients,
    creditsCharged: campaigns.creditsCharged,
    creditsRefunded: campaigns.creditsRefunded,
    submittedAt: campaigns.submittedAt,
    startedAt: campaigns.startedAt,
    completedAt: campaigns.completedAt,
  };

  async list(actor: AuthUser, q: CampaignsQuery) {
    const f: (SQL | undefined)[] = [inTreeOf(this.db, campaigns.accountId, actor.accountId, 0)];
    if (q.service) f.push(eq(campaigns.service, q.service));
    if (q.status) f.push(eq(campaigns.status, q.status as Campaign['status']));
    if (q.accountId) f.push(eq(campaigns.accountId, q.accountId));
    if (q.search?.trim()) {
      const s = `%${q.search.trim()}%`;
      f.push(
        or(
          ilike(campaigns.campaignNo, s),
          ilike(campaigns.title, s),
          ilike(accounts.username, s),
          sql`exists (select 1 from ${brands} b where b.id = ${campaigns.brandId} and b.display_name ilike ${s})`,
        ),
      );
    }
    const where = and(...f);
    const [rows, [{ total }]] = await Promise.all([
      this.db
        .select(this.columns)
        .from(campaigns)
        .innerJoin(accounts, eq(accounts.id, campaigns.accountId))
        .leftJoin(brands, eq(brands.id, campaigns.brandId))
        .where(where)
        .orderBy(desc(campaigns.submittedAt))
        .limit(q.pageSize)
        .offset((q.page - 1) * q.pageSize),
      this.db.select({ total: count() }).from(campaigns).innerJoin(accounts, eq(accounts.id, campaigns.accountId)).where(where),
    ]);
    const stats = await this.stats(rows.map((r) => r.id));
    return {
      items: rows.map((r) => ({ ...r, stats: stats.get(r.id) ?? null })),
      total,
      page: q.page,
      pageSize: q.pageSize,
    };
  }

  async detail(actor: AuthUser, id: string) {
    const c = await this.getInScope(actor, id);
    const [[acc], stats, reasons, [creator], [tpl], [brand], [num]] = await Promise.all([
      this.db.select({ username: accounts.username, name: accounts.name }).from(accounts).where(eq(accounts.id, c.accountId)),
      this.stats([id]),
      this.db
        .select({ reason: messages.errorMessage, code: messages.errorCode, n: count() })
        .from(messages)
        .where(and(eq(messages.campaignId, id), eq(messages.status, 'FAILED')))
        .groupBy(messages.errorMessage, messages.errorCode)
        .orderBy(desc(count()))
        .limit(10),
      c.createdByUserId
        ? this.db.select({ username: users.username }).from(users).where(eq(users.id, c.createdByUserId))
        : Promise.resolve([undefined]),
      this.db.select({ status: messageTemplates.status }).from(messageTemplates).where(eq(messageTemplates.id, c.templateId)),
      c.brandId
        ? this.db.select({ displayName: brands.displayName }).from(brands).where(eq(brands.id, c.brandId))
        : Promise.resolve([undefined]),
      this.db.select({ phoneNumber: senderNumbers.phoneNumber }).from(senderNumbers).where(eq(senderNumbers.id, c.senderNumberId)),
    ]);
    return {
      ...c,
      accountUsername: acc?.username,
      accountName: acc?.name,
      createdBy: creator?.username ?? null,
      templateStatus: tpl?.status,
      brandName: brand?.displayName ?? null,
      // Branded campaigns go from the customer's own number, so show it
      senderPhone: c.service === 'BRANDED' ? (num?.phoneNumber ?? null) : null,
      stats: stats.get(id) ?? null,
      failureReasons: reasons,
    };
  }

  async recipients(actor: AuthUser, id: string, q: RecipientsQuery) {
    await this.getInScope(actor, id);
    const f: (SQL | undefined)[] = [eq(messages.campaignId, id), eq(messages.direction, 'OUT')];
    if (q.status === 'SENT') f.push(eq(messages.status, 'SENT'));
    else if (q.status === 'QUEUED') f.push(inArray(messages.status, ['QUEUED', 'SENDING']));
    else if (q.status) f.push(eq(messages.status, q.status as 'FAILED'));
    if (q.search?.trim()) {
      const s = q.search.replace(/[^\d]/g, '');
      if (s) f.push(sql`${messages.contactPhone} like ${'%' + s + '%'}`);
    }
    const where = and(...f);
    const cols = {
      id: messages.id,
      contactPhone: messages.contactPhone,
      countryCode: messages.countryCode,
      status: messages.status,
      sentAt: messages.sentAt,
      deliveredAt: messages.deliveredAt,
      readAt: messages.readAt,
      failedAt: messages.failedAt,
      errorCode: messages.errorCode,
      errorMessage: messages.errorMessage,
    };
    const [items, [{ total }]] = await Promise.all([
      this.db.select(cols).from(messages).where(where).orderBy(messages.contactPhone).limit(q.pageSize).offset((q.page - 1) * q.pageSize),
      this.db.select({ total: count() }).from(messages).where(where),
    ]);
    return { items, total, page: q.page, pageSize: q.pageSize };
  }

  async reportRows(actor: AuthUser, id: string) {
    const c = await this.getInScope(actor, id);
    const rows = await this.db
      .select({
        contactPhone: messages.contactPhone,
        countryCode: messages.countryCode,
        status: messages.status,
        sentAt: messages.sentAt,
        deliveredAt: messages.deliveredAt,
        readAt: messages.readAt,
        errorMessage: messages.errorMessage,
        refunded: messages.refundedAt,
      })
      .from(messages)
      .where(and(eq(messages.campaignId, id), eq(messages.direction, 'OUT')))
      .orderBy(messages.contactPhone);
    return { campaign: c, rows };
  }

  // ------------------------------------------------------------ defaults

  async getDefaults(actor: AuthUser) {
    const [a] = await this.db.select({ d: accounts.campaignDefaults }).from(accounts).where(eq(accounts.id, actor.accountId));
    return a?.d ?? {};
  }

  async setDefaults(actor: AuthUser, dto: CampaignDefaultsDto) {
    await this.db.update(accounts).set({ campaignDefaults: dto }).where(eq(accounts.id, actor.accountId));
    return dto;
  }
}
