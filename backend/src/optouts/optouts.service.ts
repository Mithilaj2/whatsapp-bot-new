import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { and, count, desc, eq, inArray, isNull, or, SQL, sql } from 'drizzle-orm';
import { inTreeOf } from '../accounts/scope';
import { AuthUser } from '../auth/decorators';
import { parsePhone } from '../common/phone';
import { Db, InjectDb } from '../db/db.module';
import { accounts, brands, optOuts, senderNumbers } from '../db/schema';
import { GatewayEvents, MessageRow } from '../gateway/gateway.service';

/** Replies that mean "don't message me again" (English and common Indian replies). */
const STOP_WORDS = /^\s*(stop|stop all|stopall|unsubscribe|unsub|opt ?out|cancel|end|quit|block|band karo|bandh karo|band)\s*[.!]*\s*$/i;

export const isStopReply = (text?: string | null) => Boolean(text && STOP_WORDS.test(text));

@Injectable()
export class OptOutsService {
  private readonly log = new Logger('OptOuts');

  constructor(@InjectDb() private readonly db: Db) {}

  /** A contact replied STOP: never message them from this number again. */
  @OnEvent(GatewayEvents.RECEIVED, { async: true })
  async onReply({ message }: { message: MessageRow }) {
    if (!isStopReply(message.body)) return;
    await this.db
      .insert(optOuts)
      .values({
        senderNumberId: message.senderNumberId,
        contactPhone: message.contactPhone,
        contactName: message.contactName,
        accountId: message.accountId,
        mode: 'AUTO',
      })
      .onConflictDoNothing();
    this.log.log(`Opt-out from ${message.contactPhone}`);
  }

  /** Which of these phone numbers opted out of this sender number. */
  async optedOut(senderNumberId: string, phones: string[]): Promise<Set<string>> {
    const found = new Set<string>();
    for (let i = 0; i < phones.length; i += 5000) {
      const rows = await this.db
        .select({ p: optOuts.contactPhone })
        .from(optOuts)
        .where(and(eq(optOuts.senderNumberId, senderNumberId), inArray(optOuts.contactPhone, phones.slice(i, i + 5000))));
      rows.forEach((r) => found.add(r.p));
    }
    return found;
  }

  async list(actor: AuthUser, q: { service?: 'PREMIUM' | 'BRANDED'; search?: string; page: number; pageSize: number }) {
    const f: (SQL | undefined)[] = [
      actor.accountType === 'ADMIN' ? undefined : inTreeOf(this.db, optOuts.accountId, actor.accountId, 0),
    ];
    if (q.service) f.push(eq(senderNumbers.service, q.service));
    if (q.search?.trim()) {
      const s = q.search.trim().replace(/[^\d]/g, '');
      f.push(or(s ? sql`${optOuts.contactPhone} like ${'%' + s + '%'}` : undefined, sql`${optOuts.contactName} ilike ${'%' + q.search.trim() + '%'}`));
    }
    const where = and(...f);
    const base = () =>
      this.db
        .select({
          id: optOuts.id,
          contactPhone: optOuts.contactPhone,
          contactName: optOuts.contactName,
          mode: optOuts.mode,
          remarks: optOuts.remarks,
          createdAt: optOuts.createdAt,
          numberLabel: senderNumbers.label,
          numberPhone: senderNumbers.phoneNumber,
          service: senderNumbers.service,
          brandName: brands.displayName,
          accountUsername: accounts.username,
        })
        .from(optOuts)
        .innerJoin(senderNumbers, eq(senderNumbers.id, optOuts.senderNumberId))
        .leftJoin(brands, and(eq(brands.senderNumberId, senderNumbers.id), eq(brands.status, 'APPROVED')))
        .leftJoin(accounts, eq(accounts.id, optOuts.accountId));
    const [items, [{ total }]] = await Promise.all([
      base().where(where).orderBy(desc(optOuts.createdAt)).limit(q.pageSize).offset((q.page - 1) * q.pageSize),
      this.db
        .select({ total: count() })
        .from(optOuts)
        .innerJoin(senderNumbers, eq(senderNumbers.id, optOuts.senderNumberId))
        .where(where),
    ]);
    return { items, total, page: q.page, pageSize: q.pageSize };
  }

  /**
   * WhatsApp numbers I can block contacts for: the shared Premium number, plus the numbers of
   * brands in my part of the tree. The platform admin: every number.
   */
  async numbers(actor: AuthUser, service?: 'PREMIUM' | 'BRANDED') {
    return this.db
      .select({
        id: senderNumbers.id,
        service: senderNumbers.service,
        label: senderNumbers.label,
        phoneNumber: senderNumbers.phoneNumber,
        brandName: brands.displayName,
      })
      .from(senderNumbers)
      .leftJoin(brands, and(eq(brands.senderNumberId, senderNumbers.id), eq(brands.status, 'APPROVED')))
      .where(and(this.numberScope(actor), service ? eq(senderNumbers.service, service) : undefined))
      .orderBy(senderNumbers.service, senderNumbers.label);
  }

  private numberScope(actor: AuthUser) {
    if (actor.accountType === 'ADMIN') return undefined;
    return or(
      and(eq(senderNumbers.service, 'PREMIUM'), isNull(senderNumbers.ownerAccountId), eq(senderNumbers.isDefault, true)),
      sql`${senderNumbers.ownerAccountId} in (select descendant_id from account_closure where ancestor_id = ${actor.accountId})`,
    );
  }

  /** Manually block a number (e.g. someone asked by phone not to be messaged). */
  async add(actor: AuthUser, senderNumberId: string, phone: string, remarks?: string) {
    const p = parsePhone(phone);
    if (!p) throw new BadRequestException('That phone number does not look right');
    const [n] = await this.db
      .select({ id: senderNumbers.id })
      .from(senderNumbers)
      .where(and(eq(senderNumbers.id, senderNumberId), this.numberScope(actor)));
    if (!n) throw new NotFoundException('Sender number not found');
    const [row] = await this.db
      .insert(optOuts)
      .values({ senderNumberId, contactPhone: p.digits, accountId: actor.accountId, mode: 'MANUAL', remarks })
      .onConflictDoNothing()
      .returning();
    return row ?? { alreadyOptedOut: true };
  }

  /** Lets messages reach the contact again. */
  async remove(actor: AuthUser, id: string) {
    const where = and(
      eq(optOuts.id, id),
      actor.accountType === 'ADMIN' ? undefined : inTreeOf(this.db, optOuts.accountId, actor.accountId, 0),
    );
    const [row] = await this.db.delete(optOuts).where(where).returning({ id: optOuts.id });
    if (!row) throw new NotFoundException('Opt-out not found');
    return { ok: true };
  }
}
