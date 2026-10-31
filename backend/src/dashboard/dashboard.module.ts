import { BadRequestException, Controller, Get, Injectable, Module, Query } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IsIn, IsOptional, Matches } from 'class-validator';
import { sql } from 'drizzle-orm';
import { AuthUser, CurrentUser } from '../auth/decorators';
import { Db, InjectDb } from '../db/db.module';

class DashboardQuery {
  @IsOptional()
  @IsIn(['PREMIUM', 'BRANDED'])
  service?: 'PREMIUM' | 'BRANDED';

  /** First day, YYYY-MM-DD in the panel's time zone. Default: 29 days before `to`. */
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  from?: string;

  /** Last day (included). Default: today. */
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  to?: string;
}

type Unit = 'day' | 'week' | 'month';
const DAY = 86_400_000;
const n = (v: unknown) => Number(v ?? 0);

/**
 * Numbers and chart data for the dashboard. Everything covers the person's own account and every
 * account below it, filtered by service and dates (days are counted in the panel's time zone).
 */
@Injectable()
export class DashboardService {
  private readonly tz: string;

  constructor(
    @InjectDb() private readonly db: Db,
    config: ConfigService,
  ) {
    this.tz = config.get<string>('APP_TIMEZONE', 'Asia/Kolkata');
  }

  private range(q: DashboardQuery) {
    const todayStr = new Intl.DateTimeFormat('en-CA', { timeZone: this.tz }).format(new Date());
    const to = q.to ?? todayStr;
    const toMs = Date.parse(`${to}T00:00:00Z`);
    const from = q.from ?? new Date(toMs - 29 * DAY).toISOString().slice(0, 10);
    const fromMs = Date.parse(`${from}T00:00:00Z`);
    if (Number.isNaN(fromMs) || Number.isNaN(toMs)) throw new BadRequestException('Dates are not valid');
    if (fromMs > toMs) throw new BadRequestException('The start date is after the end date');
    const days = Math.round((toMs - fromMs) / DAY) + 1;
    if (days > 731) throw new BadRequestException('Pick at most two years');
    // Enough bars to read, never hundreds
    const unit: Unit = days <= 62 ? 'day' : days <= 200 ? 'week' : 'month';
    return { from, to, days, unit };
  }

  async summary(actor: AuthUser, q: DashboardQuery) {
    const { from, to, days, unit } = this.range(q);
    const tz = this.tz;
    const me = actor.accountId;
    const isAdmin = actor.accountType === 'ADMIN';
    const tree = sql`(select descendant_id from account_closure where ancestor_id = ${me})`;
    // Timestamps inside the chosen days, in the panel's time zone
    const inRange = (col: ReturnType<typeof sql.raw>) =>
      sql`${col} >= (${from}::date::timestamp at time zone ${tz}) and ${col} < ((${to}::date + 1)::timestamp at time zone ${tz})`;
    const bucket = (col: ReturnType<typeof sql.raw>) => sql`date_trunc(${unit}, ${col} at time zone ${tz})`;
    const buckets = sql`select generate_series(date_trunc(${unit}, ${from}::date::timestamp), date_trunc(${unit}, ${to}::date::timestamp), ${'1 ' + unit}::interval) as b`;
    const svc = (col: ReturnType<typeof sql.raw>) => (q.service ? sql`and ${col} = ${q.service}` : sql``);

    const [credit, camp, status, growth, services, delivery, totals, balances, bots] = await Promise.all([
      // Credits in and out of my account, and used on campaigns by everyone below me
      this.db.execute(sql`
        with bk as (${buckets}),
        t as (
          select ${bucket(sql.raw('t.created_at'))} as b, t.account_id, t.type, t.amount
          from credit_transactions t
          where t.account_id in ${tree} and ${inRange(sql.raw('t.created_at'))} ${svc(sql.raw('t.service'))}
        )
        select to_char(bk.b, 'YYYY-MM-DD') as bucket,
          coalesce(sum(case when t.account_id = ${me} and t.type in ('CREDIT','TRANSFER_IN') then t.amount end), 0)::int as received,
          coalesce(sum(case when t.account_id = ${me} and t.type = 'TRANSFER_OUT' then -t.amount end), 0)::int as given,
          coalesce(sum(case when t.type = 'CREDIT' then t.amount end), 0)::int as created,
          coalesce(sum(case when t.type = 'DEBIT' then -t.amount end), 0)::int as removed,
          coalesce(sum(case when t.type in ('SPENT','REFUND') then -t.amount end), 0)::int as used
        from bk left join t on t.b = bk.b
        group by bk.b order by bk.b`),
      // Campaigns and messages per period, per service
      this.db.execute(sql`
        with bk as (${buckets}),
        c as (
          select ${bucket(sql.raw('c.submitted_at'))} as b, c.service, c.recipients
          from campaigns c
          where c.account_id in ${tree} and ${inRange(sql.raw('c.submitted_at'))} ${svc(sql.raw('c.service'))}
        )
        select to_char(bk.b, 'YYYY-MM-DD') as bucket,
          count(c.service) filter (where c.service = 'PREMIUM')::int as premium_campaigns,
          count(c.service) filter (where c.service = 'BRANDED')::int as branded_campaigns,
          coalesce(sum(c.recipients) filter (where c.service = 'PREMIUM'), 0)::int as premium_messages,
          coalesce(sum(c.recipients) filter (where c.service = 'BRANDED'), 0)::int as branded_messages
        from bk left join c on c.b = bk.b
        group by bk.b order by bk.b`),
      this.db.execute(sql`
        select status, count(*)::int as n from campaigns c
        where c.account_id in ${tree} and ${inRange(sql.raw('c.submitted_at'))} ${svc(sql.raw('c.service'))}
        group by status`),
      // New resellers and customers per period
      this.db.execute(sql`
        with bk as (${buckets}),
        a as (
          select ${bucket(sql.raw('a.created_at'))} as b, a.type from accounts a
          where a.id in ${tree} and a.id <> ${me} and a.deleted_at is null and ${inRange(sql.raw('a.created_at'))}
        )
        select to_char(bk.b, 'YYYY-MM-DD') as bucket,
          count(a.type) filter (where a.type = 'RESELLER')::int as resellers,
          count(a.type) filter (where a.type = 'CUSTOMER')::int as customers
        from bk left join a on a.b = bk.b
        group by bk.b order by bk.b`),
      this.db.execute(sql`
        select c.service, count(*)::int as campaigns, coalesce(sum(c.recipients), 0)::int as messages,
          coalesce(sum(c.credits_charged - c.credits_refunded), 0)::int as credits
        from campaigns c
        where c.account_id in ${tree} and ${inRange(sql.raw('c.submitted_at'))} ${svc(sql.raw('c.service'))}
        group by c.service`),
      // What happened to campaign messages sent in the period
      this.db.execute(sql`
        select
          count(*) filter (where m.status = 'READ')::int as read,
          count(*) filter (where m.status = 'DELIVERED')::int as delivered,
          count(*) filter (where m.status = 'SENT')::int as sent,
          count(*) filter (where m.status in ('QUEUED','SENDING'))::int as waiting,
          count(*) filter (where m.status = 'FAILED')::int as failed,
          count(*) filter (where m.status = 'CANCELLED')::int as cancelled
        from messages m join campaigns c on c.id = m.campaign_id
        where m.direction = 'OUT' and m.account_id in ${tree} and ${inRange(sql.raw('m.created_at'))} ${svc(sql.raw('c.service'))}`),
      this.db.execute(sql`
        select
          (select count(*)::int from accounts a where a.id in ${tree} and a.id <> ${me} and a.deleted_at is null and a.type = 'RESELLER') as resellers,
          (select count(*)::int from accounts a where a.id in ${tree} and a.id <> ${me} and a.deleted_at is null and a.type = 'CUSTOMER') as customers,
          (select count(distinct m.contact_phone)::int from messages m join campaigns c on c.id = m.campaign_id
            where m.direction = 'IN' and m.account_id in ${tree} and ${inRange(sql.raw('m.created_at'))} ${svc(sql.raw('c.service'))}) as replies`),
      this.db.execute(sql`
        select service, coalesce(sum(balance), 0)::int as balance from credit_balances
        where account_id = ${me} group by service`),
      this.db.execute(sql`
        select count(*)::int as chats,
          count(*) filter (where s.status = 'HANDOFF' and s.handoff_until > now())::int as waiting
        from bot_sessions s join bots b on b.id = s.bot_id
        where b.account_id in ${tree} and ${inRange(sql.raw('s.started_at'))}`),
    ]);

    const label = (d: unknown) => String(d);
    const d = delivery.rows[0] ?? {};
    const outcome = { read: n(d.read), delivered: n(d.delivered), sent: n(d.sent), waiting: n(d.waiting), failed: n(d.failed), cancelled: n(d.cancelled) };
    const reached = outcome.read + outcome.delivered;
    const finished = reached + outcome.sent + outcome.failed;
    const svcRows = services.rows.map((r) => ({ service: r.service as string, campaigns: n(r.campaigns), messages: n(r.messages), credits: n(r.credits) }));
    const t = totals.rows[0] ?? {};
    const bal = Object.fromEntries(balances.rows.map((r) => [r.service as string, n(r.balance)]));

    return {
      range: { from, to, days, unit, timezone: tz },
      tiles: {
        balance: isAdmin ? null : { PREMIUM: bal.PREMIUM ?? 0, BRANDED: bal.BRANDED ?? 0 },
        resellers: n(t.resellers),
        customers: n(t.customers),
        campaigns: svcRows.reduce((a, r) => a + r.campaigns, 0),
        messages: svcRows.reduce((a, r) => a + r.messages, 0),
        creditsUsed: svcRows.reduce((a, r) => a + r.credits, 0),
        deliveryRate: finished ? reached / finished : null,
        readRate: reached ? outcome.read / reached : null,
        replies: n(t.replies),
        botChats: n(bots.rows[0]?.chats),
        waitingForTeam: n(bots.rows[0]?.waiting),
      },
      creditActivity: credit.rows.map((r) => ({
        date: label(r.bucket),
        received: n(r.received),
        given: n(r.given),
        created: n(r.created),
        removed: n(r.removed),
        used: n(r.used),
      })),
      campaignVolume: camp.rows.map((r) => ({
        date: label(r.bucket),
        premiumCampaigns: n(r.premium_campaigns),
        brandedCampaigns: n(r.branded_campaigns),
        premiumMessages: n(r.premium_messages),
        brandedMessages: n(r.branded_messages),
      })),
      campaignStatus: Object.fromEntries(status.rows.map((r) => [r.status as string, n(r.n)])),
      accountGrowth: growth.rows.map((r) => ({ date: label(r.bucket), resellers: n(r.resellers), customers: n(r.customers) })),
      byService: svcRows,
      delivery: outcome,
    };
  }
}

@Controller('dashboard')
class DashboardController {
  constructor(private readonly svc: DashboardService) {}

  @Get()
  summary(@CurrentUser() user: AuthUser, @Query() q: DashboardQuery) {
    return this.svc.summary(user, q);
  }
}

@Module({
  controllers: [DashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}
