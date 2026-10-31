import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AppEvents } from '../common/events';
import { and, count, desc, eq, ilike, isNull, ne, or, SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { inTreeOf } from '../accounts/scope';
import { AuthUser } from '../auth/decorators';
import { parsePhone } from '../common/phone';
import { Db, InjectDb } from '../db/db.module';
import { accounts, brands, media, senderNumbers, users } from '../db/schema';
import { BrandDto, BrandsQuery, ReviewBrandDto } from './brands.dto';

type Brand = typeof brands.$inferSelect;

@Injectable()
export class BrandsService {
  constructor(
    @InjectDb() private readonly db: Db,
    private readonly config: ConfigService,
    private readonly events: EventEmitter2,
  ) {}

  private mediaUrl(fileName: string) {
    return `${this.config.get<string>('PUBLIC_API_URL', 'http://localhost:4000/api').replace(/\/$/, '')}/media/${fileName}`;
  }

  /** The account a brand is for: mine or one below me, active, and not the platform itself. */
  private async resolveAccount(actor: AuthUser, accountId?: string) {
    const [acc] = await this.db
      .select({ id: accounts.id, username: accounts.username, type: accounts.type })
      .from(accounts)
      .where(
        and(
          eq(accounts.id, accountId ?? actor.accountId),
          isNull(accounts.deletedAt),
          inTreeOf(this.db, accounts.id, actor.accountId, 0),
        ),
      );
    if (!acc) throw new NotFoundException('Account not found');
    if (acc.type === 'ADMIN') throw new BadRequestException('Pick the customer this brand is for');
    return acc;
  }

  private async clean(actor: AuthUser, dto: BrandDto) {
    const p = parsePhone(dto.phoneNumber);
    if (!p) throw new BadRequestException('WhatsApp number does not look right. Include the country code.');
    if (dto.logoMediaId) {
      const [m] = await this.db.select({ id: media.id }).from(media).where(eq(media.id, dto.logoMediaId));
      if (!m) throw new BadRequestException('Upload the logo again');
    }
    return {
      organizationName: dto.organizationName,
      displayName: dto.displayName,
      category: dto.category,
      description: dto.description ?? null,
      website: dto.website ?? null,
      email: dto.email.toLowerCase(),
      phoneNumber: p.digits,
      address: dto.address,
      taxId: dto.taxId?.toUpperCase() ?? null,
      contactName: dto.contactName,
      logoMediaId: dto.logoMediaId ?? null,
    };
  }

  async submit(actor: AuthUser, dto: BrandDto) {
    const account = await this.resolveAccount(actor, dto.accountId);
    const values = await this.clean(actor, dto);
    const [row] = await this.db
      .insert(brands)
      .values({ ...values, accountId: account.id, submittedByUserId: actor.userId })
      .returning({ id: brands.id });
    this.events.emit(AppEvents.BRAND_SUBMITTED, { brandId: row.id });
    return this.detail(actor, row.id);
  }

  /** Fix and send again. An approved brand's details are locked: its number is live. */
  async update(actor: AuthUser, id: string, dto: BrandDto) {
    const b = await this.getInScope(actor, id);
    if (b.status === 'APPROVED') {
      throw new BadRequestException('This brand is live. Contact your provider to change its details.');
    }
    const values = await this.clean(actor, dto);
    await this.db
      .update(brands)
      .set({ ...values, status: 'SUBMITTED', updatedAt: new Date() })
      .where(eq(brands.id, id));
    this.events.emit(AppEvents.BRAND_SUBMITTED, { brandId: id });
    return this.detail(actor, id);
  }

  /** Platform admin: approve (linking the customer's WhatsApp number) or send back with a note. */
  async review(actor: AuthUser, id: string, dto: ReviewBrandDto) {
    const b = await this.getInScope(actor, id);
    if (dto.decision === 'REJECT') {
      if (!dto.note) throw new BadRequestException('Tell the customer what to fix');
      if (b.status === 'APPROVED') throw new BadRequestException('This brand is already live');
      await this.db
        .update(brands)
        .set({ status: 'REJECTED', reviewNote: dto.note, reviewedByUserId: actor.userId, reviewedAt: new Date() })
        .where(eq(brands.id, id));
      this.events.emit(AppEvents.BRAND_REVIEWED, { brandId: id });
      return this.detail(actor, id);
    }

    if (!dto.senderNumberId) throw new BadRequestException('Pick the WhatsApp number set up for this brand');
    await this.db.transaction(async (tx) => {
      const [n] = await tx.select().from(senderNumbers).where(eq(senderNumbers.id, dto.senderNumberId!)).for('update');
      if (!n) throw new NotFoundException('WhatsApp number not found');
      if (n.service !== 'BRANDED') throw new BadRequestException('That number is for Premium Campaigns. Add it as a Branded number.');
      if (n.ownerAccountId && n.ownerAccountId !== b.accountId) {
        throw new ConflictException('That number belongs to another account');
      }
      const [other] = await tx
        .select({ id: brands.id, name: brands.displayName })
        .from(brands)
        .where(and(eq(brands.senderNumberId, n.id), eq(brands.status, 'APPROVED'), ne(brands.id, id)));
      if (other) throw new ConflictException(`That number is already used by the brand ${other.name}`);

      await tx
        .update(senderNumbers)
        .set({ ownerAccountId: b.accountId, displayName: n.displayName ?? b.displayName, updatedAt: new Date() })
        .where(eq(senderNumbers.id, n.id));
      await tx
        .update(brands)
        .set({
          status: 'APPROVED',
          senderNumberId: n.id,
          reviewNote: dto.note ?? null,
          reviewedByUserId: actor.userId,
          reviewedAt: new Date(),
        })
        .where(eq(brands.id, id));
    });
    this.events.emit(AppEvents.BRAND_REVIEWED, { brandId: id });
    return this.detail(actor, id);
  }

  // ------------------------------------------------------------ reading

  private async getInScope(actor: AuthUser, id: string): Promise<Brand> {
    const [b] = await this.db
      .select()
      .from(brands)
      .where(and(eq(brands.id, id), inTreeOf(this.db, brands.accountId, actor.accountId, 0)));
    if (!b) throw new NotFoundException('Brand not found');
    return b;
  }

  private reviewer = alias(users, 'reviewer');

  private select() {
    return this.db
      .select({
        brand: brands,
        accountUsername: accounts.username,
        accountName: accounts.name,
        logoFile: media.fileName,
        numberPhone: senderNumbers.phoneNumber,
        numberLabel: senderNumbers.label,
        numberStatus: senderNumbers.status,
        reviewedBy: this.reviewer.username,
      })
      .from(brands)
      .innerJoin(accounts, eq(accounts.id, brands.accountId))
      .leftJoin(media, eq(media.id, brands.logoMediaId))
      .leftJoin(senderNumbers, eq(senderNumbers.id, brands.senderNumberId))
      .leftJoin(this.reviewer, eq(this.reviewer.id, brands.reviewedByUserId));
  }

  private shape = (r: Awaited<ReturnType<BrandsService['select']>>[number]) => ({
    ...r.brand,
    accountUsername: r.accountUsername,
    accountName: r.accountName,
    logoUrl: r.logoFile ? this.mediaUrl(r.logoFile) : null,
    number: r.numberPhone ? { phoneNumber: r.numberPhone, label: r.numberLabel, status: r.numberStatus } : null,
    reviewedBy: r.reviewedBy,
  });

  async detail(actor: AuthUser, id: string) {
    await this.getInScope(actor, id);
    const [r] = await this.select().where(eq(brands.id, id));
    return this.shape(r);
  }

  async list(actor: AuthUser, q: BrandsQuery) {
    const f: (SQL | undefined)[] = [inTreeOf(this.db, brands.accountId, actor.accountId, 0)];
    if (q.status) f.push(eq(brands.status, q.status));
    if (q.accountId) f.push(eq(brands.accountId, q.accountId));
    if (q.search?.trim()) {
      const s = `%${q.search.trim()}%`;
      f.push(or(ilike(brands.organizationName, s), ilike(brands.displayName, s), ilike(accounts.username, s), ilike(brands.phoneNumber, s)));
    }
    const where = and(...f);
    const [rows, [{ total }]] = await Promise.all([
      this.select().where(where).orderBy(desc(brands.createdAt)).limit(q.pageSize).offset((q.page - 1) * q.pageSize),
      this.db.select({ total: count() }).from(brands).innerJoin(accounts, eq(accounts.id, brands.accountId)).where(where),
    ]);
    return { items: rows.map(this.shape), total, page: q.page, pageSize: q.pageSize };
  }

  /** Brands that can send now, for the Branded campaign composer. */
  async approved(actor: AuthUser, accountId?: string) {
    const account = await this.resolveAccount(actor, accountId);
    return this.db
      .select({
        id: brands.id,
        displayName: brands.displayName,
        organizationName: brands.organizationName,
        phoneNumber: senderNumbers.phoneNumber,
        numberStatus: senderNumbers.status,
        logoFile: media.fileName,
      })
      .from(brands)
      .innerJoin(senderNumbers, eq(senderNumbers.id, brands.senderNumberId))
      .leftJoin(media, eq(media.id, brands.logoMediaId))
      .where(and(eq(brands.accountId, account.id), eq(brands.status, 'APPROVED')))
      .orderBy(brands.displayName)
      .then((rows) => rows.map(({ logoFile, ...r }) => ({ ...r, logoUrl: logoFile ? this.mediaUrl(logoFile) : null })));
  }
}
