import {
  CallHandler,
  Controller,
  ExecutionContext,
  Get,
  Global,
  Injectable,
  Logger,
  Module,
  NestInterceptor,
  OnModuleDestroy,
  OnModuleInit,
  Query,
} from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { and, count, desc, eq, ilike, lt, or, SQL, sql } from 'drizzle-orm';
import type { Request } from 'express';
import { Observable, tap } from 'rxjs';
import { inTreeOf } from '../accounts/scope';
import { AuthUser, CurrentUser, Roles } from '../auth/decorators';
import { PageQuery } from '../common/pagination';
import { Db, InjectDb } from '../db/db.module';
import { accounts, auditLogs, webhookEvents } from '../db/schema';

/** The person's address, as seen through the proxy (Caddy) in front of the API. */
export const clientIp = (req: Request) => (req.ip ?? req.socket?.remoteAddress ?? '').replace(/^::ffff:/, '').slice(0, 64);

@Injectable()
export class AuditService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('Audit');
  private readonly keepDays: number;
  private timer?: NodeJS.Timeout;

  constructor(
    @InjectDb() private readonly db: Db,
    config: ConfigService,
  ) {
    this.keepDays = Number(config.get('AUDIT_KEEP_DAYS', 365));
  }

  onModuleInit() {
    this.timer = setInterval(() => void this.cleanup().catch(() => {}), 6 * 3_600_000);
    this.timer.unref();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  /** Old entries out; raw webhook bodies are only kept a month. */
  async cleanup() {
    await this.db.delete(auditLogs).where(lt(auditLogs.createdAt, new Date(Date.now() - this.keepDays * 86_400_000)));
    await this.db.delete(webhookEvents).where(lt(webhookEvents.receivedAt, new Date(Date.now() - 30 * 86_400_000)));
  }

  /** Never throws: the log must not break what it logs. */
  async record(e: {
    actor?: Pick<AuthUser, 'userId' | 'accountId' | 'username'> | null;
    accountId?: string | null;
    username?: string | null;
    action: string;
    targetId?: string | null;
    details?: Record<string, unknown>;
    ip?: string;
  }) {
    try {
      await this.db.insert(auditLogs).values({
        accountId: e.actor?.accountId ?? e.accountId ?? null,
        userId: e.actor?.userId ?? null,
        username: (e.actor?.username ?? e.username ?? null)?.slice(0, 60) ?? null,
        action: e.action.slice(0, 80),
        targetId: e.targetId?.slice(0, 64) ?? null,
        details: e.details ?? null,
        ip: e.ip ?? null,
      });
    } catch (err) {
      this.log.error(`Could not write activity log: ${(err as Error).message}`);
    }
  }

  async list(actor: AuthUser, q: AuditQuery) {
    const f: (SQL | undefined)[] = [
      actor.accountType === 'ADMIN' ? undefined : inTreeOf(this.db, auditLogs.accountId, actor.accountId, 0),
    ];
    if (q.accountId) f.push(eq(auditLogs.accountId, q.accountId));
    if (q.action) f.push(ilike(auditLogs.action, `${q.action}%`));
    if (q.search?.trim()) {
      const s = `%${q.search.trim()}%`;
      f.push(or(ilike(auditLogs.username, s), ilike(auditLogs.ip, s), ilike(auditLogs.targetId, s), sql`${auditLogs.details}::text ilike ${s}`));
    }
    const where = and(...f);
    const [items, [{ total }]] = await Promise.all([
      this.db
        .select({ log: auditLogs, accountUsername: accounts.username })
        .from(auditLogs)
        .leftJoin(accounts, eq(accounts.id, auditLogs.accountId))
        .where(where)
        .orderBy(desc(auditLogs.createdAt))
        .limit(q.pageSize)
        .offset((q.page - 1) * q.pageSize),
      this.db.select({ total: count() }).from(auditLogs).where(where),
    ]);
    return { items: items.map((r) => ({ ...r.log, accountUsername: r.accountUsername })), total, page: q.page, pageSize: q.pageSize };
  }
}

/** Reads and tiny writes that aren't worth logging. */
const SKIP = [
  /^POST \/api\/campaigns\/check$/,
  /^POST \/api\/bots\/simulate$/,
  /^POST \/api\/notifications\//,
  /^POST \/api\/auth\/login$/, // logged by the auth service with the outcome
  /^POST \/api\/webhooks\//,
  /^POST \/api\/media$/,
];

/**
 * Every successful change (POST / PUT / PATCH / DELETE) by a logged-in person goes to the
 * activity log: what, on which record, from which address. Request bodies are not stored, so
 * passwords and message text never end up here.
 */
@Injectable()
class AuditInterceptor implements NestInterceptor {
  constructor(private readonly audit: AuditService) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = ctx.switchToHttp().getRequest<Request & { user?: AuthUser }>();
    if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next.handle();
    const route = `${req.method} ${(req.route?.path as string | undefined) ?? req.path}`;
    if (SKIP.some((r) => r.test(route))) return next.handle();

    return next.handle().pipe(
      tap((res) => {
        if (!req.user) return;
        const body = (req.body ?? {}) as Record<string, unknown>;
        const resId = res && typeof res === 'object' && 'id' in res ? String((res as { id: unknown }).id) : undefined;
        const params = req.params as Record<string, string>;
        // A few harmless fields that make the log readable
        const details: Record<string, unknown> = {};
        for (const k of ['accountId', 'service', 'countryCode', 'direction', 'amount', 'decision', 'isActive', 'status', 'title', 'name', 'type'] as const) {
          if (body[k] !== undefined && typeof body[k] !== 'object') details[k] = body[k];
        }
        if ('password' in body) details.passwordChanged = true;
        void this.audit.record({
          actor: req.user,
          action: route,
          targetId: params.id ?? params.senderNumberId ?? resId ?? null,
          details: Object.keys(details).length ? details : undefined,
          ip: clientIp(req),
        });
      }),
    );
  }
}

class AuditQuery extends PageQuery {
  @IsOptional()
  @IsUUID()
  accountId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  action?: string;
}

@Controller('audit')
class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  @Roles('ADMIN', 'RESELLER')
  list(@CurrentUser() user: AuthUser, @Query() q: AuditQuery) {
    return this.audit.list(user, q);
  }
}

@Global()
@Module({
  controllers: [AuditController],
  providers: [AuditService, { provide: APP_INTERCEPTOR, useClass: AuditInterceptor }],
  exports: [AuditService],
})
export class AuditModule {}
