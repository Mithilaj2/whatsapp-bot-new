import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { AuthUser } from '../auth/decorators';
import { Db, InjectDb } from '../db/db.module';
import { campaigns, messages, senderNumbers } from '../db/schema';
import { GatewayService } from '../gateway/gateway.service';

/** WhatsApp only allows free-form replies within 24 hours of the contact's last message. */
const REPLY_WINDOW_MS = 24 * 60 * 60 * 1000;

export interface Conversation {
  senderNumberId: string;
  contactPhone: string;
  contactName: string | null;
  lastAt: string;
  lastBody: string | null;
  lastDirection: 'IN' | 'OUT';
  inbound: number;
  lastInboundAt: string | null;
  numberLabel: string;
}

@Injectable()
export class InboxService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly gateway: GatewayService,
  ) {}

  /** Messages the actor may see: their own account's and every account below it. */
  private scope(actor: AuthUser) {
    return sql`m.account_id in (select descendant_id from account_closure where ancestor_id = ${actor.accountId})`;
  }

  /** People who wrote to us, newest first. */
  async conversations(actor: AuthUser, q: { service: 'PREMIUM' | 'BRANDED'; search?: string; page: number; pageSize: number }) {
    const s = q.search?.trim();
    const digits = s?.replace(/[^\d]/g, '');
    const search = s
      ? sql`and (${digits ? sql`m.contact_phone like ${'%' + digits + '%'} or` : sql``} m.contact_name ilike ${'%' + s + '%'})`
      : sql``;
    const grouped = sql`
      select m.sender_number_id, m.contact_phone,
        max(m.created_at) as last_at,
        count(*) filter (where m.direction = 'IN')::int as inbound,
        max(m.created_at) filter (where m.direction = 'IN') as last_inbound_at,
        (array_agg(m.body order by m.created_at desc))[1] as last_body,
        (array_agg(m.direction order by m.created_at desc))[1] as last_direction,
        (array_agg(m.contact_name order by m.created_at desc) filter (where m.contact_name is not null))[1] as contact_name
      from ${messages} m
      join ${senderNumbers} n on n.id = m.sender_number_id
      where ${this.scope(actor)} and n.service = ${q.service} ${search}
      group by m.sender_number_id, m.contact_phone
      having count(*) filter (where m.direction = 'IN') > 0`;

    const [rows, total] = await Promise.all([
      this.db.execute<Record<string, unknown>>(sql`
        select g.*, n.label as number_label from (${grouped}) g
        join ${senderNumbers} n on n.id = g.sender_number_id
        order by g.last_at desc
        limit ${q.pageSize} offset ${(q.page - 1) * q.pageSize}`),
      this.db.execute<{ total: number }>(sql`select count(*)::int as total from (${grouped}) g`),
    ]);

    const items: Conversation[] = rows.rows.map((r) => ({
      senderNumberId: r.sender_number_id as string,
      contactPhone: r.contact_phone as string,
      contactName: (r.contact_name as string) ?? null,
      lastAt: new Date(r.last_at as string).toISOString(),
      lastBody: (r.last_body as string) ?? null,
      lastDirection: r.last_direction as 'IN',
      inbound: r.inbound as number,
      lastInboundAt: r.last_inbound_at ? new Date(r.last_inbound_at as string).toISOString() : null,
      numberLabel: r.number_label as string,
    }));
    return { items, total: total.rows[0]?.total ?? 0, page: q.page, pageSize: q.pageSize };
  }

  /** The full chat with one contact on one number (latest 500 messages). */
  async thread(actor: AuthUser, senderNumberId: string, contactPhone: string) {
    const rows = await this.db
      .select({
        id: messages.id,
        direction: messages.direction,
        body: messages.body,
        kind: messages.kind,
        status: messages.status,
        contactName: messages.contactName,
        createdAt: messages.createdAt,
        errorMessage: messages.errorMessage,
        campaignId: messages.campaignId,
        campaignNo: campaigns.campaignNo,
        imageUrl: sql<string | null>`${messages.payload}->>'headerImageUrl'`,
        auto: sql<'normal' | 'optout' | null>`${messages.payload}->>'auto'`,
      })
      .from(messages)
      .leftJoin(campaigns, eq(campaigns.id, messages.campaignId))
      .where(
        and(
          eq(messages.senderNumberId, senderNumberId),
          eq(messages.contactPhone, contactPhone),
          sql`${messages.accountId} in (select descendant_id from account_closure where ancestor_id = ${actor.accountId})`,
        ),
      )
      .orderBy(desc(messages.createdAt))
      .limit(500);
    if (!rows.length) throw new NotFoundException('Conversation not found');

    const lastInbound = rows.find((r) => r.direction === 'IN');
    const windowEndsAt = lastInbound ? new Date(lastInbound.createdAt.getTime() + REPLY_WINDOW_MS) : null;
    return {
      contactPhone,
      contactName: rows.find((r) => r.contactName)?.contactName ?? null,
      canReply: Boolean(windowEndsAt && windowEndsAt > new Date()),
      replyWindowEndsAt: windowEndsAt,
      messages: rows.reverse(),
    };
  }

  /** Free-form reply. Only inside the 24-hour window WhatsApp allows. Not charged. */
  async reply(actor: AuthUser, senderNumberId: string, contactPhone: string, text: string) {
    const t = await this.thread(actor, senderNumberId, contactPhone);
    if (!t.canReply) {
      throw new BadRequestException(
        'More than 24 hours since this person last wrote. WhatsApp only allows a template message now, for example a new campaign.',
      );
    }
    // The reply belongs to the account that owns the conversation
    const [owner] = await this.db
      .select({ accountId: messages.accountId })
      .from(messages)
      .where(and(eq(messages.senderNumberId, senderNumberId), eq(messages.contactPhone, contactPhone), eq(messages.direction, 'IN')))
      .orderBy(desc(messages.createdAt))
      .limit(1);
    const [id] = await this.gateway.enqueue([
      { accountId: owner.accountId, senderNumberId, to: contactPhone, text },
    ]);
    return this.gateway.getMessage(id);
  }

  async exportRows(actor: AuthUser, service: 'PREMIUM' | 'BRANDED') {
    return this.db
      .select({
        createdAt: messages.createdAt,
        contactPhone: messages.contactPhone,
        contactName: messages.contactName,
        direction: messages.direction,
        body: messages.body,
        campaignNo: campaigns.campaignNo,
        numberLabel: senderNumbers.label,
      })
      .from(messages)
      .innerJoin(senderNumbers, eq(senderNumbers.id, messages.senderNumberId))
      .leftJoin(campaigns, eq(campaigns.id, messages.campaignId))
      .where(
        and(
          eq(messages.direction, 'IN'),
          eq(senderNumbers.service, service),
          sql`${messages.accountId} in (select descendant_id from account_closure where ancestor_id = ${actor.accountId})`,
        ),
      )
      .orderBy(asc(messages.createdAt))
      .limit(50_000);
  }
}
