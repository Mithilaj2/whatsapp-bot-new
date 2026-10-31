import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { and, asc, count, desc, eq, exists, gte, ilike, isNull, or, sql, SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { AuthUser } from '../auth/decorators';
import { Paginated } from '../common/pagination';
import { Db, InjectDb } from '../db/db.module';
import { accountClosure, accounts, creditBalances, users } from '../db/schema';
import { CreateAccountDto, ListAccountsQuery, UpdateAccountDto } from './dto/account.dto';

const parent = alias(accounts, 'parent');

/** Number of active accounts directly under each row. */
const childCount = sql<number>`(
  select count(*)::int from ${accounts} as child
  where child.parent_id = ${accounts.id} and child.deleted_at is null
)`;

const listColumns = {
  id: accounts.id,
  username: accounts.username,
  name: accounts.name,
  type: accounts.type,
  status: accounts.status,
  email: accounts.email,
  phone: accounts.phone,
  domain: accounts.domain,
  brandName: accounts.brandName,
  logoUrl: accounts.logoUrl,
  parentId: accounts.parentId,
  createdAt: accounts.createdAt,
  parentUsername: parent.username,
  parentName: parent.name,
  childCount,
};

@Injectable()
export class AccountsService {
  constructor(@InjectDb() private readonly db: Db) {}

  /** Condition: the row is below `accountId` in the tree (minDepth 1) or is it/below it (minDepth 0). */
  private inTreeOf(accountId: string, minDepth: 0 | 1): SQL {
    return and(
      isNull(accounts.deletedAt),
      exists(
        this.db
          .select({ one: sql`1` })
          .from(accountClosure)
          .where(
            and(
              eq(accountClosure.descendantId, accounts.id),
              eq(accountClosure.ancestorId, accountId),
              gte(accountClosure.depth, minDepth),
            ),
          ),
      ),
    )!;
  }

  /** Throws unless target is the actor's own account (when allowed) or below it. */
  private async assertInScope(actorAccountId: string, targetId: string, allowSelf: boolean) {
    if (targetId === actorAccountId) {
      if (allowSelf) return;
      throw new ForbiddenException('You cannot change your own account here');
    }
    const [link] = await this.db
      .select({ deletedAt: accounts.deletedAt })
      .from(accountClosure)
      .innerJoin(accounts, eq(accounts.id, accountClosure.descendantId))
      .where(
        and(
          eq(accountClosure.ancestorId, actorAccountId),
          eq(accountClosure.descendantId, targetId),
        ),
      )
      .limit(1);
    if (!link || link.deletedAt) throw new NotFoundException('Account not found');
  }

  private shape<
    T extends { parentId: string | null; parentUsername: string | null; parentName: string | null },
  >(row: T) {
    const { parentUsername, parentName, ...rest } = row;
    return {
      ...rest,
      parent: rest.parentId ? { id: rest.parentId, username: parentUsername, name: parentName } : null,
    };
  }

  private async getById(id: string) {
    const [row] = await this.db
      .select(listColumns)
      .from(accounts)
      .leftJoin(parent, eq(parent.id, accounts.parentId))
      .where(eq(accounts.id, id))
      .limit(1);
    if (!row) throw new NotFoundException('Account not found');
    return this.shape(row);
  }

  async list(actor: AuthUser, q: ListAccountsQuery): Promise<Paginated<unknown>> {
    const filters: (SQL | undefined)[] = [this.inTreeOf(actor.accountId, 1)];
    if (q.type) filters.push(eq(accounts.type, q.type));
    if (q.search?.trim()) {
      const s = `%${q.search.trim()}%`;
      filters.push(
        or(
          ilike(accounts.username, s),
          ilike(accounts.name, s),
          ilike(accounts.email, s),
          ilike(accounts.domain, s),
        ),
      );
    }
    const where = and(...filters);

    const [rows, [{ total }]] = await Promise.all([
      this.db
        .select(listColumns)
        .from(accounts)
        .leftJoin(parent, eq(parent.id, accounts.parentId))
        .where(where)
        .orderBy(desc(accounts.createdAt))
        .limit(q.pageSize)
        .offset((q.page - 1) * q.pageSize),
      this.db.select({ total: count() }).from(accounts).where(where),
    ]);
    return { items: rows.map((r) => this.shape(r)), total, page: q.page, pageSize: q.pageSize };
  }

  /** My account plus everything below it, flat with parentId, for the tree view. */
  tree(actor: AuthUser) {
    return this.db
      .select({
        id: accounts.id,
        username: accounts.username,
        name: accounts.name,
        type: accounts.type,
        status: accounts.status,
        parentId: accounts.parentId,
      })
      .from(accounts)
      .where(this.inTreeOf(actor.accountId, 0))
      .orderBy(asc(accounts.type), asc(accounts.username));
  }

  /** Counts for the dashboard. Only accounts below me, never my own account. */
  async stats(actor: AuthUser) {
    const rows = await this.db
      .select({ type: accounts.type, total: count() })
      .from(accounts)
      .where(this.inTreeOf(actor.accountId, 1))
      .groupBy(accounts.type);
    const get = (t: string) => rows.find((r) => r.type === t)?.total ?? 0;
    return { resellers: get('RESELLER'), customers: get('CUSTOMER') };
  }

  async findOne(actor: AuthUser, id: string) {
    await this.assertInScope(actor.accountId, id, true);
    return this.getById(id);
  }

  async create(actor: AuthUser, dto: CreateAccountDto) {
    if (actor.accountType === 'CUSTOMER') {
      throw new ForbiddenException('Customers cannot create accounts');
    }

    const parentId = dto.parentId ?? actor.accountId;
    await this.assertInScope(actor.accountId, parentId, true);
    const [parentRow] = await this.db.select().from(accounts).where(eq(accounts.id, parentId));
    if (!parentRow) throw new NotFoundException('Parent account not found');
    if (parentRow.type === 'CUSTOMER') {
      throw new BadRequestException('A customer cannot have accounts under it');
    }

    const [userTaken] = await this.db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.username, dto.username));
    const [accountTaken] = await this.db
      .select({ id: accounts.id })
      .from(accounts)
      .where(eq(accounts.username, dto.username));
    if (userTaken || accountTaken) throw new ConflictException('This username is already taken');

    const isReseller = dto.type === 'RESELLER';
    if (isReseller && dto.domain) await this.assertDomainFree(dto.domain);

    const passwordHash = await bcrypt.hash(dto.password, 12);

    const id = await this.db.transaction(async (tx) => {
      const [created] = await tx
        .insert(accounts)
        .values({
          username: dto.username,
          name: dto.name,
          type: dto.type,
          email: dto.email,
          phone: dto.phone,
          domain: isReseller ? dto.domain : null,
          brandName: isReseller ? dto.brandName : null,
          parentId,
        })
        .returning({ id: accounts.id });

      // Closure rows: every ancestor of the parent becomes an ancestor of the new account
      const parentAncestors = await tx
        .select()
        .from(accountClosure)
        .where(eq(accountClosure.descendantId, parentId));
      await tx.insert(accountClosure).values([
        ...parentAncestors.map((a) => ({
          ancestorId: a.ancestorId,
          descendantId: created.id,
          depth: a.depth + 1,
        })),
        { ancestorId: created.id, descendantId: created.id, depth: 0 },
      ]);

      await tx
        .insert(users)
        .values({ accountId: created.id, username: dto.username, name: dto.name, passwordHash });
      return created.id;
    });

    return this.getById(id);
  }

  async update(actor: AuthUser, id: string, dto: UpdateAccountDto) {
    await this.assertInScope(actor.accountId, id, false);
    const [target] = await this.db.select().from(accounts).where(eq(accounts.id, id));
    const isReseller = target.type === 'RESELLER';
    if (isReseller && dto.domain && dto.domain !== target.domain) {
      await this.assertDomainFree(dto.domain, id);
    }

    const ownerLogin = and(eq(users.accountId, id), eq(users.username, target.username));
    const passwordHash = dto.password ? await bcrypt.hash(dto.password, 12) : undefined;

    // Only fields that were actually sent; undefined means "leave as is"
    const changes = Object.fromEntries(
      Object.entries({
        name: dto.name,
        status: dto.status,
        email: dto.email,
        phone: dto.phone,
        domain: isReseller ? dto.domain : undefined,
        brandName: isReseller ? dto.brandName : undefined,
        logoUrl: isReseller ? dto.logoUrl : undefined,
      }).filter(([, v]) => v !== undefined),
    );

    await this.db.transaction(async (tx) => {
      if (Object.keys(changes).length > 0) {
        await tx.update(accounts).set(changes).where(eq(accounts.id, id));
      }
      if (dto.name || passwordHash) {
        await tx
          .update(users)
          // A new password signs the account out everywhere
          .set({ name: dto.name, passwordHash, ...(passwordHash ? { tokenVersion: sql`${users.tokenVersion} + 1` } : {}) })
          .where(ownerLogin);
      }
    });

    return this.getById(id);
  }

  /** Soft delete. Blocked while the account still has accounts or credits under it. */
  async remove(actor: AuthUser, id: string) {
    await this.assertInScope(actor.accountId, id, false);
    const [{ children }] = await this.db
      .select({ children: count() })
      .from(accounts)
      .where(and(eq(accounts.parentId, id), isNull(accounts.deletedAt)));
    if (children > 0) {
      throw new BadRequestException(
        `This account has ${children} account(s) under it. Move or delete them first.`,
      );
    }
    const [{ credits }] = await this.db
      .select({ credits: sql<number>`coalesce(sum(${creditBalances.balance}), 0)`.mapWith(Number) })
      .from(creditBalances)
      .where(eq(creditBalances.accountId, id));
    if (credits > 0) {
      throw new BadRequestException(
        `This account still has ${credits.toLocaleString('en-IN')} credits. Take them back in Credits > Transactions first.`,
      );
    }
    await this.db.transaction(async (tx) => {
      await tx
        .update(accounts)
        .set({ deletedAt: new Date(), status: 'SUSPENDED', domain: null })
        .where(eq(accounts.id, id));
      await tx.update(users).set({ isActive: false }).where(eq(users.accountId, id));
    });
    return { ok: true };
  }

  private async assertDomainFree(domain: string, exceptId?: string) {
    const [owner] = await this.db
      .select({ id: accounts.id })
      .from(accounts)
      .where(eq(accounts.domain, domain));
    if (owner && owner.id !== exceptId) {
      throw new ConflictException('This domain is already used by another account');
    }
  }
}
