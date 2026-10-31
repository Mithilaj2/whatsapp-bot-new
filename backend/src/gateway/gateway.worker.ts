import { Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { and, eq, inArray, lt, sql } from 'drizzle-orm';
import { Db, InjectDb } from '../db/db.module';
import { messages, messageTemplates, senderNumbers, TemplatePayload } from '../db/schema';
import { GatewayEvents, GatewayService, MessageRow, SenderNumber } from './gateway.service';
import { ProviderError } from './providers/types';

const BATCH = 200;
const MAX_ATTEMPTS = 5;
/** A message stuck in SENDING this long was interrupted (e.g. server restart). */
const STUCK_MS = 10 * 60_000;

/**
 * Sends queued messages. The messages table is the queue: rows are claimed with
 * FOR UPDATE SKIP LOCKED, so more than one worker can run safely. Each number has its own
 * speed limit (messages per second) and numbers send in parallel.
 */
@Injectable()
export class GatewayWorker implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly log = new Logger('SendWorker');
  private running = false;
  private stopping = false;
  private loop?: Promise<void>;
  /** Earliest time each number may send its next message. */
  private nextSlot = new Map<string, number>();

  constructor(
    @InjectDb() private readonly db: Db,
    private readonly config: ConfigService,
    private readonly gateway: GatewayService,
    private readonly events: EventEmitter2,
  ) {}

  onApplicationBootstrap() {
    if (this.config.get('WORKER_ENABLED', 'true') === 'false') {
      this.log.log('Sending worker is off (WORKER_ENABLED=false)');
      return;
    }
    this.running = true;
    this.loop = this.run();
    this.log.log('Sending worker started');
  }

  async onApplicationShutdown() {
    this.stopping = true;
    await this.loop;
  }

  private async run() {
    let lastStuckCheck = 0;
    while (!this.stopping) {
      try {
        if (Date.now() - lastStuckCheck > 60_000) {
          lastStuckCheck = Date.now();
          await this.failStuck();
        }
        const claimed = await this.claim();
        if (claimed.length) await this.sendAll(claimed);
        // Busy: go again straight away. Idle: check every half second.
        else await sleep(500);
      } catch (e) {
        this.log.error(`Worker error: ${(e as Error).message}`);
        await sleep(2000);
      }
    }
    this.running = false;
  }

  /**
   * Takes due messages and marks them SENDING so no other worker takes them. Per number, only about
   * two seconds' worth at its speed limit: the rest stays QUEUED, so stopping a campaign still
   * catches it and one slow number doesn't hold up the others.
   */
  private async claim(): Promise<MessageRow[]> {
    const res = await this.db.execute<{ id: string }>(sql`
      update ${messages} set status = 'SENDING', locked_at = now(), attempts = attempts + 1, updated_at = now()
      where id in (
        select id from ${messages}
        where status = 'QUEUED' and id in (
          select id from (
            select m.id, n.rate_per_second,
              row_number() over (partition by m.sender_number_id order by m.next_attempt_at) as rn
            from ${messages} m
            join ${senderNumbers} n on n.id = m.sender_number_id
            where m.status = 'QUEUED' and m.next_attempt_at <= now()
          ) due
          where due.rn <= greatest(1, due.rate_per_second * 2)
        )
        limit ${BATCH}
        for update skip locked
      )
      returning id`);
    const ids = res.rows.map((r) => r.id);
    if (!ids.length) return [];
    return this.db.select().from(messages).where(inArray(messages.id, ids));
  }

  private async sendAll(batch: MessageRow[]) {
    const numberIds = [...new Set(batch.map((m) => m.senderNumberId))];
    const numbers = new Map(
      (await this.db.select().from(senderNumbers).where(inArray(senderNumbers.id, numberIds))).map((n) => [n.id, n]),
    );
    const templateIds = [...new Set(batch.map((m) => m.templateId).filter(Boolean))] as string[];
    const templates = new Map(
      templateIds.length
        ? (await this.db.select().from(messageTemplates).where(inArray(messageTemplates.id, templateIds))).map((t) => [t.id, t])
        : [],
    );

    // One lane per number, run side by side; within a lane, respect the number's speed limit
    const lanes = numberIds.map(async (numberId) => {
      const n = numbers.get(numberId)!;
      for (const m of batch.filter((x) => x.senderNumberId === numberId)) {
        await this.waitForSlot(n);
        await this.sendOne(n, m, m.templateId ? templates.get(m.templateId) : undefined);
      }
    });
    await Promise.all(lanes);
  }

  private async waitForSlot(n: SenderNumber) {
    const gap = 1000 / Math.max(1, n.ratePerSecond);
    const now = Date.now();
    const slot = Math.max(now, this.nextSlot.get(n.id) ?? 0);
    this.nextSlot.set(n.id, slot + gap);
    if (slot > now) await sleep(slot - now);
  }

  private async sendOne(n: SenderNumber, m: MessageRow, t?: typeof messageTemplates.$inferSelect) {
    try {
      if (n.status !== 'ACTIVE') throw new ProviderError('The sending number is switched off', 'SENDER_DISABLED', false);
      if (m.templateId && (!t || t.status !== 'APPROVED')) {
        throw new ProviderError('The template is no longer approved', 'TEMPLATE_NOT_APPROVED', false);
      }
      const provider = this.gateway.provider(n.provider);
      const creds = this.gateway.creds(n);
      const providerMessageId = t
        ? await provider.sendTemplate(
            creds,
            m.contactPhone,
            { name: t.name, language: t.language, category: t.category, content: t.content },
            (m.payload ?? {}) as TemplatePayload,
          )
        : await provider.sendText(creds, m.contactPhone, m.body ?? '');

      const [row] = await this.db
        .update(messages)
        .set({ status: 'SENT', providerMessageId, sentAt: new Date(), lockedAt: null, errorCode: null, errorMessage: null })
        .where(and(eq(messages.id, m.id), eq(messages.status, 'SENDING')))
        .returning();
      if (row) this.events.emit(GatewayEvents.STATUS, { message: row, status: 'SENT' });
    } catch (e) {
      await this.handleError(n, m, e);
    }
  }

  private async handleError(n: SenderNumber, m: MessageRow, e: unknown) {
    const err =
      e instanceof ProviderError ? e : new ProviderError((e as Error).message ?? 'Unknown error', 'INTERNAL', true);

    if (err.senderBroken) {
      await this.db.update(senderNumbers).set({ lastError: err.message }).where(eq(senderNumbers.id, n.id));
    }

    if (err.retryable && m.attempts < MAX_ATTEMPTS) {
      // Wait longer after each try: 10s, 40s, 1.5 min, 2.7 min (or what WhatsApp asks for)
      const delay = err.retryAfterMs ?? 10_000 * m.attempts ** 2;
      await this.db
        .update(messages)
        .set({
          status: 'QUEUED',
          lockedAt: null,
          nextAttemptAt: new Date(Date.now() + delay),
          errorCode: err.code,
          errorMessage: err.message,
        })
        .where(eq(messages.id, m.id));
      if (err.code === '130429' || err.code === '80007') {
        // WhatsApp says this number is going too fast: pause it briefly
        this.nextSlot.set(n.id, Date.now() + Math.max(delay, 5000));
      }
      return;
    }

    const [row] = await this.db
      .update(messages)
      .set({ status: 'FAILED', lockedAt: null, failedAt: new Date(), errorCode: err.code, errorMessage: err.message })
      .where(eq(messages.id, m.id))
      .returning();
    if (row) this.events.emit(GatewayEvents.STATUS, { message: row, status: 'FAILED' });
  }

  /**
   * Messages left in SENDING by a crash are marked failed, not re-sent: WhatsApp may already have
   * delivered them, and sending twice is worse than one missed message.
   */
  private async failStuck() {
    const rows = await this.db
      .update(messages)
      .set({
        status: 'FAILED',
        failedAt: new Date(),
        lockedAt: null,
        errorCode: 'INTERRUPTED',
        errorMessage: 'Sending was interrupted (server restart). Not retried to avoid sending twice.',
      })
      .where(and(eq(messages.status, 'SENDING'), lt(messages.lockedAt, new Date(Date.now() - STUCK_MS))))
      .returning();
    for (const row of rows) this.events.emit(GatewayEvents.STATUS, { message: row, status: 'FAILED' });
    if (rows.length) this.log.warn(`${rows.length} interrupted message(s) marked failed`);
  }

  /** For tests and the admin page: is the worker running? */
  get isRunning() {
    return this.running;
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
