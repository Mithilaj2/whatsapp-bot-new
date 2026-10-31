import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OnEvent } from '@nestjs/event-emitter';
import { and, count, desc, eq, gt, isNull, ne, or, SQL, sql } from 'drizzle-orm';
import { inTreeOf } from '../accounts/scope';
import { AuthUser } from '../auth/decorators';
import { Db, InjectDb } from '../db/db.module';
import {
  accounts,
  BotFlow,
  BotNode,
  bots,
  botSessions,
  brands,
  messages,
  RichMessage,
  senderNumbers,
} from '../db/schema';
import { EnqueueItem, GatewayEvents, GatewayService, MessageRow } from '../gateway/gateway.service';
import { isStopReply } from '../optouts/optouts.service';
import { AiService, AiTurn, NO_ANSWER } from './ai.service';
import { BotOutput, BotState, checkFlow, LIMITS, starterFlow, step } from './engine';

type Bot = typeof bots.$inferSelect;
type Session = typeof botSessions.$inferSelect;

const DEFAULT_NO_ANSWER = "Sorry, I don't have that information. Our team will get back to you.";

// ------------------------------------------------------------ input cleaning

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '');
const optStr = (v: unknown, max: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : undefined);
const oneOf = <T extends string>(v: unknown, allowed: readonly T[], dflt: T): T =>
  allowed.includes(v as T) ? (v as T) : dflt;
const idOf = (v: unknown) => (typeof v === 'string' && /^[\w-]{1,40}$/.test(v) ? v : null);

/** Keeps only the fields a flow has, with the right types and sizes. Throws on nonsense. */
export function cleanFlow(raw: unknown): BotFlow {
  if (!raw || typeof raw !== 'object') throw new BadRequestException('The bot flow is missing');
  const r = raw as Record<string, any>;
  if (!Array.isArray(r.nodes) || r.nodes.length > LIMITS.nodes) throw new BadRequestException('The bot flow is not valid');
  const nodes: BotNode[] = r.nodes.map((n: any) => {
    const id = idOf(n?.id);
    if (!id) throw new BadRequestException('A step has no valid id');
    const type = oneOf(n.type, ['MESSAGE', 'BUTTONS', 'LIST', 'QUESTION', 'HANDOFF'] as const, 'MESSAGE');
    const node: BotNode = { id, type, name: str(n.name, 60), text: str(n.text, LIMITS.text) };
    const next = idOf(n.next);
    if (next && (type === 'MESSAGE' || type === 'QUESTION')) node.next = next;
    const img = optStr(n.imageUrl, 1000);
    if (img && (type === 'MESSAGE' || type === 'BUTTONS')) {
      if (!/^https?:\/\//.test(img)) throw new BadRequestException('Image links must start with http');
      node.imageUrl = img;
    }
    if (type === 'BUTTONS' || type === 'LIST') {
      node.options = (Array.isArray(n.options) ? n.options : []).slice(0, LIMITS.listRows).map((o: any, i: number) => ({
        id: idOf(o?.id) ?? `o${i + 1}`,
        title: str(o?.title, 40).trim(),
        ...(type === 'LIST' && optStr(o?.description, 100) ? { description: optStr(o?.description, 100) } : {}),
        ...(idOf(o?.next) ? { next: idOf(o?.next)! } : {}),
      }));
      if (type === 'LIST') node.listButton = str(n.listButton, 40).trim() || 'Choose';
      if (optStr(n.variable, 40)) node.variable = optStr(n.variable, 40);
    }
    if (type === 'QUESTION') {
      node.variable = str(n.variable, 40).trim();
      node.validation = oneOf(n.validation, ['TEXT', 'NUMBER', 'EMAIL', 'PHONE'] as const, 'TEXT');
    }
    return node;
  });
  const triggers = (Array.isArray(r.triggers) ? r.triggers : []).slice(0, 30).map((t: any, i: number) => ({
    id: idOf(t?.id) ?? `t${i + 1}`,
    keywords: (Array.isArray(t?.keywords) ? t.keywords : [])
      .map((k: unknown) => str(k, 60).trim())
      .filter(Boolean)
      .slice(0, 20),
    match: oneOf(t?.match, ['EXACT', 'CONTAINS'] as const, 'EXACT'),
    startNodeId: idOf(t?.startNodeId) ?? '',
  }));
  const f = r.fallback ?? {};
  const fallback: BotFlow['fallback'] = { mode: oneOf(f.mode, ['START', 'MESSAGE', 'AI', 'NONE'] as const, 'NONE') };
  if (fallback.mode === 'START') fallback.startNodeId = idOf(f.startNodeId) ?? '';
  if (fallback.mode === 'MESSAGE') fallback.text = str(f.text, 1000);
  return {
    nodes,
    triggers,
    fallback,
    ai: {
      knowledge: str(r.ai?.knowledge, 20000),
      ...(optStr(r.ai?.noAnswerText, 500) ? { noAnswerText: optStr(r.ai?.noAnswerText, 500) } : {}),
    },
  };
}

// ------------------------------------------------------------ service

@Injectable()
export class BotsService {
  private readonly log = new Logger('Bots');
  readonly idleMinutes: number;
  readonly handoffHours: number;

  constructor(
    @InjectDb() private readonly db: Db,
    private readonly gateway: GatewayService,
    readonly ai: AiService,
    config: ConfigService,
  ) {
    this.idleMinutes = Number(config.get('BOT_IDLE_MINUTES', 30));
    this.handoffHours = Number(config.get('BOT_HANDOFF_HOURS', 24));
  }

  settings() {
    return {
      aiAvailable: this.ai.available,
      aiDailyLimit: this.ai.dailyLimit,
      idleMinutes: this.idleMinutes,
      handoffHours: this.handoffHours,
      limits: LIMITS,
    };
  }

  /** WhatsApp numbers I can put a bot on: the admin any, others the numbers of their brands. */
  private numberScope(actor: AuthUser) {
    return actor.accountType === 'ADMIN'
      ? undefined
      : sql`${senderNumbers.ownerAccountId} in (select descendant_id from account_closure where ancestor_id = ${actor.accountId})`;
  }

  async numbers(actor: AuthUser) {
    return this.db
      .select({
        id: senderNumbers.id,
        service: senderNumbers.service,
        label: senderNumbers.label,
        phoneNumber: senderNumbers.phoneNumber,
        brandName: brands.displayName,
        botId: bots.id,
        botName: bots.name,
      })
      .from(senderNumbers)
      .leftJoin(brands, and(eq(brands.senderNumberId, senderNumbers.id), eq(brands.status, 'APPROVED')))
      .leftJoin(bots, and(eq(bots.senderNumberId, senderNumbers.id), eq(bots.isActive, true)))
      .where(and(this.numberScope(actor), eq(senderNumbers.status, 'ACTIVE')))
      .orderBy(senderNumbers.service, senderNumbers.label);
  }

  private async getInScope(actor: AuthUser, id: string): Promise<Bot> {
    const [b] = await this.db
      .select()
      .from(bots)
      .where(and(eq(bots.id, id), inTreeOf(this.db, bots.accountId, actor.accountId, 0)));
    if (!b) throw new NotFoundException('Bot not found');
    return b;
  }

  async list(actor: AuthUser) {
    const rows = await this.db
      .select({
        id: bots.id,
        name: bots.name,
        isActive: bots.isActive,
        accountId: bots.accountId,
        accountUsername: accounts.username,
        senderNumberId: bots.senderNumberId,
        numberPhone: senderNumbers.phoneNumber,
        numberLabel: senderNumbers.label,
        flow: bots.flow,
        updatedAt: bots.updatedAt,
        chats: sql<number>`(select count(*)::int from ${botSessions} s where s.bot_id = ${bots.id})`,
        chatsToday: sql<number>`(select count(*)::int from ${botSessions} s where s.bot_id = ${bots.id} and s.started_at > now() - interval '1 day')`,
        handoffs: sql<number>`(select count(*)::int from ${botSessions} s where s.bot_id = ${bots.id} and s.status = 'HANDOFF' and s.handoff_until > now())`,
      })
      .from(bots)
      .innerJoin(accounts, eq(accounts.id, bots.accountId))
      .leftJoin(senderNumbers, eq(senderNumbers.id, bots.senderNumberId))
      .where(inTreeOf(this.db, bots.accountId, actor.accountId, 0))
      .orderBy(desc(bots.updatedAt));
    return rows.map(({ flow, ...r }) => ({
      ...r,
      steps: flow.nodes.length,
      keywords: flow.triggers.flatMap((t) => t.keywords).slice(0, 8),
      usesAi: flow.fallback.mode === 'AI',
    }));
  }

  async detail(actor: AuthUser, id: string) {
    const b = await this.getInScope(actor, id);
    return { ...b, problems: checkFlow(b.flow) };
  }

  async create(actor: AuthUser, dto: { name: string; accountId?: string }) {
    const accountId = dto.accountId ?? actor.accountId;
    const [acc] = await this.db
      .select({ id: accounts.id, name: accounts.name })
      .from(accounts)
      .where(and(eq(accounts.id, accountId), isNull(accounts.deletedAt), inTreeOf(this.db, accounts.id, actor.accountId, 0)));
    if (!acc) throw new NotFoundException('Account not found');
    const [b] = await this.db
      .insert(bots)
      .values({ accountId: acc.id, name: dto.name, flow: starterFlow(acc.name), createdByUserId: actor.userId })
      .returning({ id: bots.id });
    return this.detail(actor, b.id);
  }

  async update(actor: AuthUser, id: string, dto: { name?: string; senderNumberId?: string | null; isActive?: boolean; flow?: unknown }) {
    const b = await this.getInScope(actor, id);
    const flow = dto.flow !== undefined ? cleanFlow(dto.flow) : b.flow;
    const senderNumberId = dto.senderNumberId !== undefined ? dto.senderNumberId : b.senderNumberId;
    const isActive = dto.isActive ?? b.isActive;

    if (senderNumberId && senderNumberId !== b.senderNumberId) {
      const [n] = await this.db
        .select({ id: senderNumbers.id })
        .from(senderNumbers)
        .where(and(eq(senderNumbers.id, senderNumberId), this.numberScope(actor)));
      if (!n) throw new NotFoundException('WhatsApp number not found');
    }
    if (isActive) {
      if (!senderNumberId) throw new BadRequestException('Pick the WhatsApp number this bot answers on');
      const problems = checkFlow(flow);
      if (problems.length) throw new BadRequestException(`Fix these first: ${problems.slice(0, 5).join('; ')}`);
      const [other] = await this.db
        .select({ name: bots.name })
        .from(bots)
        .where(and(eq(bots.senderNumberId, senderNumberId), eq(bots.isActive, true), ne(bots.id, id)));
      if (other) throw new ConflictException(`The bot "${other.name}" is already on this number. Turn it off first.`);
    }
    try {
      await this.db
        .update(bots)
        .set({ name: dto.name ?? b.name, flow, senderNumberId, isActive, updatedAt: new Date() })
        .where(eq(bots.id, id));
    } catch (e) {
      if ((e as { code?: string }).code === '23505') throw new ConflictException('Another bot is already on this number');
      throw e;
    }
    // A changed flow may no longer have the step someone is on: start them fresh next time
    if (dto.flow !== undefined) {
      const ids = new Set(flow.nodes.map((n) => n.id));
      const open = await this.db
        .select({ id: botSessions.id, nodeId: botSessions.nodeId })
        .from(botSessions)
        .where(and(eq(botSessions.botId, id), eq(botSessions.status, 'ACTIVE')));
      for (const s of open.filter((s) => s.nodeId && !ids.has(s.nodeId))) {
        await this.db.update(botSessions).set({ status: 'ENDED', completedAt: new Date() }).where(eq(botSessions.id, s.id));
      }
    }
    return this.detail(actor, id);
  }

  async remove(actor: AuthUser, id: string) {
    const b = await this.getInScope(actor, id);
    if (b.isActive) throw new BadRequestException('Turn the bot off before deleting it');
    await this.db.delete(bots).where(eq(bots.id, id));
    return { ok: true };
  }

  // ------------------------------------------------------------ chats and answers

  async sessions(actor: AuthUser, id: string, q: { status?: string; search?: string; page: number; pageSize: number }) {
    await this.getInScope(actor, id);
    const f: (SQL | undefined)[] = [eq(botSessions.botId, id)];
    if (q.status === 'HANDOFF') f.push(eq(botSessions.status, 'HANDOFF'), gt(botSessions.handoffUntil, new Date()));
    else if (q.status) f.push(eq(botSessions.status, q.status as 'ACTIVE'));
    if (q.search?.trim()) {
      const s = q.search.trim();
      const d = s.replace(/\D/g, '');
      f.push(
        or(
          d ? sql`${botSessions.contactPhone} like ${'%' + d + '%'}` : undefined,
          sql`${botSessions.contactName} ilike ${'%' + s + '%'}`,
          sql`${botSessions.variables}::text ilike ${'%' + s + '%'}`,
        ),
      );
    }
    const where = and(...f);
    const [items, [{ total }]] = await Promise.all([
      this.db
        .select()
        .from(botSessions)
        .where(where)
        .orderBy(desc(botSessions.lastActivityAt))
        .limit(q.pageSize)
        .offset((q.page - 1) * q.pageSize),
      this.db.select({ total: count() }).from(botSessions).where(where),
    ]);
    return { items: items.map((s) => this.shapeSession(s)), total, page: q.page, pageSize: q.pageSize };
  }

  private shapeSession(s: Session) {
    // A handoff that ran out means the bot is back on
    const handoff = s.status === 'HANDOFF' && s.handoffUntil && s.handoffUntil > new Date();
    return { ...s, status: s.status === 'HANDOFF' && !handoff ? 'COMPLETED' : s.status };
  }

  async exportSessions(actor: AuthUser, id: string) {
    const b = await this.getInScope(actor, id);
    const rows = await this.db.select().from(botSessions).where(eq(botSessions.botId, id)).orderBy(desc(botSessions.startedAt)).limit(100_000);
    const vars = [...new Set(rows.flatMap((r) => Object.keys(r.variables)))];
    return { bot: b, vars, rows: rows.map((r) => this.shapeSession(r)) };
  }

  /** Bot back on for this person (after a team member finished talking to them). */
  async endSession(actor: AuthUser, sessionId: string) {
    const [s] = await this.db.select().from(botSessions).where(eq(botSessions.id, sessionId));
    if (!s) throw new NotFoundException('Chat not found');
    await this.getInScope(actor, s.botId);
    await this.db
      .update(botSessions)
      .set({ status: 'ENDED', handoffUntil: null, completedAt: new Date() })
      .where(eq(botSessions.id, sessionId));
    return { ok: true };
  }

  // ------------------------------------------------------------ test chat

  async simulate(actor: AuthUser, dto: { flow: unknown; state?: BotState | null; text: string; replyId?: string; botId?: string }) {
    const flow = cleanFlow(dto.flow);
    const state = sanitizeState(dto.state);
    const res = step(flow, state, { text: dto.text, replyId: dto.replyId, contactName: actor.username });
    const out: ({ kind: 'text'; text: string; ai?: boolean } | { kind: 'rich'; rich: RichMessage })[] = [];
    for (const o of res.outputs) {
      if (o.kind !== 'ai') {
        out.push(o);
        continue;
      }
      if (!this.ai.available) {
        out.push({ kind: 'text', text: '(The AI answer appears here once AI is switched on for the platform.)', ai: true });
        continue;
      }
      const a = await this.ai.answer('this business', flow.ai.knowledge, [], o.question);
      out.push({ kind: 'text', text: a === NO_ANSWER ? flow.ai.noAnswerText || DEFAULT_NO_ANSWER : a, ai: true });
    }
    return { messages: out, state: res.state, problems: checkFlow(flow) };
  }

  // ------------------------------------------------------------ live

  /** Someone wrote to a number with a bot on it. */
  @OnEvent(GatewayEvents.RECEIVED, { async: true })
  async onReceived({ message }: { message: MessageRow }) {
    try {
      await this.handle(message);
    } catch (e) {
      this.log.error(`Bot failed for ${message.contactPhone}: ${(e as Error).message}`);
    }
  }

  private async handle(message: MessageRow) {
    if (isStopReply(message.body)) return; // opt-outs handle STOP
    const [bot] = await this.db
      .select()
      .from(bots)
      .where(and(eq(bots.senderNumberId, message.senderNumberId), eq(bots.isActive, true)));
    if (!bot) return;

    const now = new Date();
    const [session] = await this.db
      .select()
      .from(botSessions)
      .where(
        and(
          eq(botSessions.botId, bot.id),
          eq(botSessions.contactPhone, message.contactPhone),
          or(
            and(eq(botSessions.status, 'ACTIVE'), gt(botSessions.lastActivityAt, new Date(now.getTime() - this.idleMinutes * 60_000))),
            and(eq(botSessions.status, 'HANDOFF'), gt(botSessions.handoffUntil, now)),
          ),
        ),
      )
      .orderBy(desc(botSessions.lastActivityAt))
      .limit(1);

    // A person from the team is handling this chat: the bot stays quiet
    if (session?.status === 'HANDOFF') {
      await this.db.update(botSessions).set({ lastActivityAt: now }).where(eq(botSessions.id, session.id));
      return;
    }

    const replyId = (message.payload as { replyId?: string } | null)?.replyId;
    const current: BotState | null = session ? { status: 'ACTIVE', nodeId: session.nodeId, vars: session.variables } : null;
    const res = step(bot.flow, current, { text: message.body ?? '', replyId, contactName: message.contactName });

    // Save where they are first, so a quick second message sees it
    let sessionId = session?.id;
    if (res.state) {
      const values = {
        status: res.state.status,
        nodeId: res.state.nodeId,
        variables: res.state.vars,
        lastActivityAt: now,
        contactName: message.contactName ?? session?.contactName ?? null,
        completedAt: res.state.status === 'ACTIVE' ? null : now,
        handoffUntil: res.state.status === 'HANDOFF' ? new Date(now.getTime() + this.handoffHours * 3_600_000) : null,
      };
      if (session && !res.started) {
        await this.db.update(botSessions).set(values).where(eq(botSessions.id, session.id));
      } else {
        // An old chat replaced by a new one
        if (session) await this.db.update(botSessions).set({ status: 'ENDED', completedAt: now }).where(eq(botSessions.id, session.id));
        const [row] = await this.db
          .insert(botSessions)
          .values({ ...values, botId: bot.id, senderNumberId: message.senderNumberId, contactPhone: message.contactPhone, startedAt: now })
          .returning({ id: botSessions.id });
        sessionId = row.id;
      }
    } else if (session) {
      await this.db.update(botSessions).set({ lastActivityAt: now }).where(eq(botSessions.id, session.id));
    }

    const items: EnqueueItem[] = [];
    for (const o of res.outputs) {
      const item = await this.toMessage(bot, message, o);
      if (item) items.push(item);
    }
    if (items.length) await this.gateway.enqueue(items);
    if (items.length) this.log.log(`Bot "${bot.name}" replied to ${message.contactPhone}${sessionId ? '' : ' (no chat)'}`);
  }

  private async toMessage(bot: Bot, m: MessageRow, o: BotOutput): Promise<EnqueueItem | null> {
    const base = { accountId: m.accountId, senderNumberId: m.senderNumberId, to: m.contactPhone, campaignId: m.campaignId ?? undefined };
    if (o.kind === 'text') return { ...base, text: o.text, payload: { bot: bot.id } };
    if (o.kind === 'rich') return { ...base, payload: { bot: bot.id, rich: o.rich } };

    // AI answer, within the daily limit per person
    const noAnswer = bot.flow.ai.noAnswerText || DEFAULT_NO_ANSWER;
    if (!this.ai.available) return { ...base, text: noAnswer, payload: { bot: bot.id } };
    const [{ used }] = await this.db
      .select({ used: count() })
      .from(messages)
      .where(
        and(
          eq(messages.senderNumberId, m.senderNumberId),
          eq(messages.contactPhone, m.contactPhone),
          eq(messages.direction, 'OUT'),
          sql`(${messages.payload}->>'ai')::boolean is true`,
          gt(messages.createdAt, new Date(Date.now() - 86_400_000)),
        ),
      );
    if (used >= this.ai.dailyLimit) return { ...base, text: noAnswer, payload: { bot: bot.id } };

    const history = await this.history(m);
    const [names] = await this.db
      .select({ brand: brands.displayName, account: accounts.name })
      .from(accounts)
      .leftJoin(brands, and(eq(brands.senderNumberId, m.senderNumberId), eq(brands.status, 'APPROVED')))
      .where(eq(accounts.id, bot.accountId));
    const answer = await this.ai.answer(names?.brand ?? names?.account ?? 'the business', bot.flow.ai.knowledge, history, o.question);
    if (answer === NO_ANSWER) return { ...base, text: noAnswer, payload: { bot: bot.id } };
    return { ...base, text: answer, payload: { bot: bot.id, ai: true } };
  }

  /** The last few messages of this chat, so the AI understands follow-up questions. */
  private async history(m: MessageRow): Promise<AiTurn[]> {
    const rows = await this.db
      .select({ direction: messages.direction, body: messages.body, id: messages.id })
      .from(messages)
      .where(
        and(
          eq(messages.senderNumberId, m.senderNumberId),
          eq(messages.contactPhone, m.contactPhone),
          gt(messages.createdAt, new Date(Date.now() - 86_400_000)),
          ne(messages.id, m.id),
          sql`${messages.kind} <> 'TEMPLATE'`,
        ),
      )
      .orderBy(desc(messages.createdAt))
      .limit(8);
    return rows.reverse().map((r) => ({ role: r.direction === 'IN' ? 'user' : 'assistant', text: r.body ?? '' }));
  }
}

function sanitizeState(s: unknown): BotState | null {
  if (!s || typeof s !== 'object') return null;
  const r = s as Record<string, unknown>;
  const vars: Record<string, string> = {};
  if (r.vars && typeof r.vars === 'object') {
    for (const [k, v] of Object.entries(r.vars as Record<string, unknown>).slice(0, 50)) {
      if (typeof v === 'string') vars[k.slice(0, 40)] = v.slice(0, 500);
    }
  }
  const status = r.status === 'ACTIVE' || r.status === 'HANDOFF' || r.status === 'COMPLETED' ? r.status : 'COMPLETED';
  return { status, nodeId: typeof r.nodeId === 'string' ? r.nodeId : null, vars };
}
