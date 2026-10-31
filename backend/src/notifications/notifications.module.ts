import {
  Controller,
  Get,
  Injectable,
  Logger,
  Module,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OnEvent } from '@nestjs/event-emitter';
import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional } from 'class-validator';
import { and, count, desc, eq, isNull, lt, sql } from 'drizzle-orm';
import { AuthUser, CurrentUser } from '../auth/decorators';
import { AppEvents } from '../common/events';
import { PageQuery } from '../common/pagination';
import { Db, InjectDb } from '../db/db.module';
import {
  accounts,
  bots,
  brands,
  campaigns,
  countries,
  creditBalances,
  creditTransactions,
  notifications,
  senderNumbers,
  Service,
  users,
} from '../db/schema';

type Level = 'INFO' | 'SUCCESS' | 'WARNING' | 'ERROR';
interface NewNotification {
  type: string;
  level?: Level;
  title: string;
  body?: string | null;
  link?: string | null;
  dedupeKey?: string;
}

const fmt = (n: number) => n.toLocaleString('en-IN');
const phone = (d: string) => (d.startsWith('91') && d.length === 12 ? `+91 ${d.slice(2, 7)} ${d.slice(7)}` : `+${d}`);
const serviceName = (s: Service) => (s === 'PREMIUM' ? 'Premium' : 'Branded');
const campaignLink = (service: Service, id: string) => `/campaigns/${service.toLowerCase()}/reports/${id}`;

/** Today's date in the panel's time zone, for once-a-day alerts. */
const today = (tz: string) => new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date());

@Injectable()
export class NotificationsService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('Notifications');
  private readonly lowCredits: number;
  private readonly tz: string;
  private readonly keepDays: number;
  private timer?: NodeJS.Timeout;

  constructor(
    @InjectDb() private readonly db: Db,
    config: ConfigService,
  ) {
    this.lowCredits = Number(config.get('LOW_CREDIT_THRESHOLD', 100));
    this.tz = config.get<string>('APP_TIMEZONE', 'Asia/Kolkata');
    this.keepDays = Number(config.get('NOTIFICATION_KEEP_DAYS', 90));
  }

  onModuleInit() {
    // Old notifications are cleared out once an hour
    this.timer = setInterval(() => void this.cleanup().catch(() => {}), 3_600_000);
    this.timer.unref();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  private async cleanup() {
    await this.db.delete(notifications).where(lt(notifications.createdAt, new Date(Date.now() - this.keepDays * 86_400_000)));
  }

  /** Adds a notification for these accounts (each once). Never throws: a failed alert must not break anything. */
  async notify(accountIds: (string | null | undefined)[], n: NewNotification) {
    const ids = [...new Set(accountIds.filter(Boolean))] as string[];
    if (!ids.length) return;
    try {
      await this.db
        .insert(notifications)
        .values(
          ids.map((accountId) => ({
            accountId,
            type: n.type,
            level: n.level ?? 'INFO',
            title: n.title.slice(0, 200),
            body: n.body ?? null,
            link: n.link ?? null,
            dedupeKey: n.dedupeKey ?? null,
          })),
        )
        .onConflictDoNothing();
    } catch (e) {
      this.log.error(`Could not save notification: ${(e as Error).message}`);
    }
  }

  private async adminIds() {
    return (await this.db.select({ id: accounts.id }).from(accounts).where(and(eq(accounts.type, 'ADMIN'), isNull(accounts.deletedAt)))).map(
      (a) => a.id,
    );
  }

  /** The account of the user who did something (when it acted for an account below it). */
  private async accountOfUser(userId?: string | null) {
    if (!userId) return null;
    const [u] = await this.db.select({ accountId: users.accountId }).from(users).where(eq(users.id, userId));
    return u?.accountId ?? null;
  }

  // ------------------------------------------------------------ campaigns

  @OnEvent(AppEvents.CAMPAIGN_FINISHED, { async: true })
  async onCampaignFinished({ campaignId }: { campaignId: string }) {
    const [c] = await this.db.select().from(campaigns).where(eq(campaigns.id, campaignId));
    if (!c) return;
    const [s] = (
      await this.db.execute<{ delivered: number; failed: number }>(sql`
        select count(*) filter (where status in ('DELIVERED','READ'))::int as delivered,
               count(*) filter (where status = 'FAILED')::int as failed
        from messages where campaign_id = ${campaignId} and direction = 'OUT'`)
    ).rows;
    const failed = s?.failed ?? 0;
    await this.notify([c.accountId, await this.accountOfUser(c.createdByUserId)], {
      type: 'CAMPAIGN_FINISHED',
      level: failed > 0 && failed >= c.recipients / 2 ? 'WARNING' : 'SUCCESS',
      title: `Campaign ${c.campaignNo} finished`,
      body: `${c.title}: ${fmt(c.recipients)} sent${failed ? `, ${fmt(failed)} failed (credits returned)` : ''}.`,
      link: campaignLink(c.service, c.id),
    });
  }

  @OnEvent(AppEvents.CAMPAIGN_REJECTED, { async: true })
  async onCampaignRejected({ campaignId, reason }: { campaignId: string; reason: string }) {
    const [c] = await this.db.select().from(campaigns).where(eq(campaigns.id, campaignId));
    if (!c) return;
    await this.notify([c.accountId, await this.accountOfUser(c.createdByUserId)], {
      type: 'CAMPAIGN_REJECTED',
      level: 'ERROR',
      title: `WhatsApp did not approve campaign ${c.campaignNo}`,
      body: `${c.title}. ${reason}. All credits were returned.`,
      link: campaignLink(c.service, c.id),
    });
  }

  // ------------------------------------------------------------ credits

  @OnEvent(AppEvents.CREDITS_MOVED, { async: true })
  async onCreditsMoved({ groupId }: { groupId: string }) {
    const rows = await this.db
      .select({
        accountId: creditTransactions.accountId,
        type: creditTransactions.type,
        amount: creditTransactions.amount,
        service: creditTransactions.service,
        country: countries.name,
        counterparty: accounts.name,
      })
      .from(creditTransactions)
      .innerJoin(countries, eq(countries.id, creditTransactions.countryId))
      .leftJoin(accounts, eq(accounts.id, creditTransactions.counterpartyId))
      .where(eq(creditTransactions.groupId, groupId));
    const what = (r: (typeof rows)[number]) => `${fmt(Math.abs(r.amount))} ${serviceName(r.service)} credits (${r.country})`;
    const out = rows.find((r) => r.type === 'TRANSFER_OUT');
    const inn = rows.find((r) => r.type === 'TRANSFER_IN');
    // A transfer going up the tree means the provider took credits back
    let takenBack = false;
    if (out && inn) {
      const [o] = await this.db.select({ parentId: accounts.parentId }).from(accounts).where(eq(accounts.id, out.accountId));
      takenBack = o?.parentId === inn.accountId;
    }
    for (const r of rows) {
      if (r.type === 'CREDIT' || (r.type === 'TRANSFER_IN' && !takenBack)) {
        await this.notify([r.accountId], {
          type: 'CREDITS_RECEIVED',
          level: 'SUCCESS',
          title: `You received ${what(r)}`,
          body: r.type === 'TRANSFER_IN' && r.counterparty ? `From ${r.counterparty}.` : null,
          link: '/credits/balances',
        });
      } else if (r.type === 'DEBIT' || (r.type === 'TRANSFER_OUT' && takenBack)) {
        await this.notify([r.accountId], {
          type: 'CREDITS_REMOVED',
          title: `${what(r)} were taken back`,
          body: r.counterparty ? `By ${r.counterparty}.` : null,
          link: '/credits/transactions',
        });
      }
    }
  }

  @OnEvent(AppEvents.CREDITS_SPENT, { async: true })
  async onCreditsSpent({ accountId, service }: { accountId: string; service: Service }) {
    if (this.lowCredits <= 0) return;
    const low = await this.db
      .select({ balance: creditBalances.balance, country: countries.name, code: countries.code })
      .from(creditBalances)
      .innerJoin(countries, eq(countries.id, creditBalances.countryId))
      .where(
        and(
          eq(creditBalances.accountId, accountId),
          eq(creditBalances.service, service),
          lt(creditBalances.balance, this.lowCredits),
        ),
      );
    if (!low.length) return;
    const [acc] = await this.db
      .select({ name: accounts.name, username: accounts.username, parentId: accounts.parentId, type: accounts.type })
      .from(accounts)
      .where(eq(accounts.id, accountId));
    if (!acc || acc.type === 'ADMIN') return;
    const day = today(this.tz);
    for (const l of low) {
      const key = `low:${service}:${l.code}:${day}`;
      await this.notify([accountId], {
        type: 'CREDITS_LOW',
        level: 'WARNING',
        title: `${serviceName(service)} credits are running low`,
        body: `${fmt(l.balance)} left for ${l.country}. Ask your provider to add more before your next campaign.`,
        link: '/credits/balances',
        dedupeKey: key,
      });
      // The reseller above is told too, so they can top up their customer
      if (acc.parentId) {
        await this.notify([acc.parentId], {
          type: 'CREDITS_LOW',
          level: 'WARNING',
          title: `${acc.name} is low on ${serviceName(service)} credits`,
          body: `${fmt(l.balance)} left for ${l.country} (${acc.username}).`,
          link: '/credits/balances',
          dedupeKey: `${key}:${accountId}`,
        });
      }
    }
  }

  // ------------------------------------------------------------ brands

  @OnEvent(AppEvents.BRAND_SUBMITTED, { async: true })
  async onBrandSubmitted({ brandId }: { brandId: string }) {
    const [b] = await this.db
      .select({ name: brands.displayName, account: accounts.username })
      .from(brands)
      .innerJoin(accounts, eq(accounts.id, brands.accountId))
      .where(eq(brands.id, brandId));
    if (!b) return;
    await this.notify(await this.adminIds(), {
      type: 'BRAND_SUBMITTED',
      title: `New brand to review: ${b.name}`,
      body: `Submitted for ${b.account}. Set up the number in Meta, then approve it.`,
      link: '/campaigns/branded/onboarding',
    });
  }

  @OnEvent(AppEvents.BRAND_REVIEWED, { async: true })
  async onBrandReviewed({ brandId }: { brandId: string }) {
    const [b] = await this.db.select().from(brands).where(eq(brands.id, brandId));
    if (!b) return;
    const approved = b.status === 'APPROVED';
    await this.notify([b.accountId, await this.accountOfUser(b.submittedByUserId)], {
      type: approved ? 'BRAND_APPROVED' : 'BRAND_REJECTED',
      level: approved ? 'SUCCESS' : 'WARNING',
      title: approved ? `${b.displayName} is live` : `${b.displayName} was sent back`,
      body: approved ? 'You can now send Branded campaigns and run bots on this number.' : `To fix: ${b.reviewNote}`,
      link: approved ? '/campaigns/branded/new' : '/campaigns/branded/onboarding',
    });
  }

  // ------------------------------------------------------------ bots and numbers

  @OnEvent(AppEvents.BOT_HANDOFF, { async: true })
  async onBotHandoff(e: { botId: string; contactPhone: string; contactName?: string | null }) {
    const [b] = await this.db.select({ accountId: bots.accountId, name: bots.name }).from(bots).where(eq(bots.id, e.botId));
    if (!b) return;
    const who = e.contactName ? `${e.contactName} (${phone(e.contactPhone)})` : phone(e.contactPhone);
    await this.notify([b.accountId], {
      type: 'BOT_HANDOFF',
      level: 'WARNING',
      title: `${who} wants to talk to a person`,
      body: `From your bot "${b.name}". Reply in Incoming messages.`,
      link: '/campaigns/branded/inbox',
    });
  }

  @OnEvent(AppEvents.NUMBER_ALERT, { async: true })
  async onNumberAlert(e: { senderNumberId: string; qualityRating?: string; error?: string }) {
    const [n] = await this.db.select().from(senderNumbers).where(eq(senderNumbers.id, e.senderNumberId));
    if (!n) return;
    const label = `${n.label} (${phone(n.phoneNumber)})`;
    const admins = await this.adminIds();
    if (e.error) {
      await this.notify(admins, {
        type: 'NUMBER_ERROR',
        level: 'ERROR',
        title: `WhatsApp number ${label} can't send`,
        body: e.error,
        link: '/setup/numbers',
        dedupeKey: `number-error:${n.id}:${today(this.tz)}`,
      });
      return;
    }
    const red = e.qualityRating === 'RED';
    const n2: NewNotification = {
      type: 'NUMBER_QUALITY',
      level: red ? 'ERROR' : 'WARNING',
      title: `Quality of ${label} is ${red ? 'low' : 'medium'}`,
      body: red
        ? 'Many people blocked or reported recent messages. Pause campaigns from this number and check what was sent, or WhatsApp may limit it.'
        : 'Some people blocked or reported recent messages. Check that recipients agreed to hear from you.',
    };
    await this.notify(admins, { ...n2, link: '/setup/numbers' });
    if (n.ownerAccountId) await this.notify([n.ownerAccountId], { ...n2, link: '/campaigns/branded/reports' });
  }

  // ------------------------------------------------------------ reading

  async list(actor: AuthUser, q: { unread?: boolean; page: number; pageSize: number }) {
    const where = and(eq(notifications.accountId, actor.accountId), q.unread ? isNull(notifications.readAt) : undefined);
    const [items, [{ total }], unread] = await Promise.all([
      this.db
        .select()
        .from(notifications)
        .where(where)
        .orderBy(desc(notifications.createdAt))
        .limit(q.pageSize)
        .offset((q.page - 1) * q.pageSize),
      this.db.select({ total: count() }).from(notifications).where(where),
      this.unreadCount(actor),
    ]);
    return { items, total, page: q.page, pageSize: q.pageSize, unread: unread.unread };
  }

  async unreadCount(actor: AuthUser) {
    const [{ n }] = await this.db
      .select({ n: count() })
      .from(notifications)
      .where(and(eq(notifications.accountId, actor.accountId), isNull(notifications.readAt)));
    return { unread: n };
  }

  async markRead(actor: AuthUser, id: string) {
    const [row] = await this.db
      .update(notifications)
      .set({ readAt: new Date() })
      .where(and(eq(notifications.id, id), eq(notifications.accountId, actor.accountId)))
      .returning({ id: notifications.id });
    if (!row) throw new NotFoundException('Notification not found');
    return { ok: true };
  }

  async markAllRead(actor: AuthUser) {
    const rows = await this.db
      .update(notifications)
      .set({ readAt: new Date() })
      .where(and(eq(notifications.accountId, actor.accountId), isNull(notifications.readAt)))
      .returning({ id: notifications.id });
    return { marked: rows.length };
  }
}

class NotificationsQuery extends PageQuery {
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true' || value === '1')
  @IsBoolean()
  unread?: boolean;
}

@Controller('notifications')
class NotificationsController {
  constructor(private readonly svc: NotificationsService) {}

  @Get()
  list(@CurrentUser() user: AuthUser, @Query() q: NotificationsQuery) {
    return this.svc.list(user, q);
  }

  @Get('unread-count')
  unread(@CurrentUser() user: AuthUser) {
    return this.svc.unreadCount(user);
  }

  @Post('read-all')
  readAll(@CurrentUser() user: AuthUser) {
    return this.svc.markAllRead(user);
  }

  @Post(':id/read')
  read(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.markRead(user, id);
  }
}

@Module({
  controllers: [NotificationsController],
  providers: [NotificationsService],
})
export class NotificationsModule {}
