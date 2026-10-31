import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Injectable,
  Logger,
  Module,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Put,
} from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { and, eq, gt, sql } from 'drizzle-orm';
import { AuthUser, CurrentUser } from '../auth/decorators';
import { Db, InjectDb } from '../db/db.module';
import { accounts, autoResponders, bots, brands, messages, senderNumbers } from '../db/schema';
import { GatewayModule } from '../gateway/gateway.module';
import { GatewayEvents, GatewayService, MessageRow } from '../gateway/gateway.service';
import { isStopReply } from '../optouts/optouts.service';

const DAY_MS = 24 * 60 * 60 * 1000;
const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

class AutoResponderDto {
  @Transform(trim)
  @IsString()
  @MinLength(2, { message: 'Give it a name' })
  @MaxLength(120)
  name: string;

  @Transform(trim)
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  normalMessage?: string;

  @Transform(trim)
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  optOutMessage?: string;

  @IsBoolean()
  isActive: boolean;
}

/**
 * Automatic replies on a WhatsApp number: a normal reply when someone writes (once a day per
 * person, so it never loops with another bot), and a confirmation when someone replies STOP.
 * Both are free-form messages inside WhatsApp's 24-hour window, so they cost no credits.
 */
@Injectable()
export class AutoResponderService {
  private readonly log = new Logger('AutoResponder');

  constructor(
    @InjectDb() private readonly db: Db,
    private readonly gateway: GatewayService,
  ) {}

  /** Numbers I may set replies for: the platform admin any; others the numbers of their brands. */
  private numberScope(actor: AuthUser) {
    return actor.accountType === 'ADMIN'
      ? undefined
      : sql`${senderNumbers.ownerAccountId} in (select descendant_id from account_closure where ancestor_id = ${actor.accountId})`;
  }

  async list(actor: AuthUser) {
    return this.db
      .select({
        senderNumberId: senderNumbers.id,
        service: senderNumbers.service,
        phoneNumber: senderNumbers.phoneNumber,
        label: senderNumbers.label,
        brandName: brands.displayName,
        accountUsername: accounts.username,
        responder: autoResponders,
      })
      .from(senderNumbers)
      .leftJoin(brands, and(eq(brands.senderNumberId, senderNumbers.id), eq(brands.status, 'APPROVED')))
      .leftJoin(accounts, eq(accounts.id, senderNumbers.ownerAccountId))
      .leftJoin(autoResponders, eq(autoResponders.senderNumberId, senderNumbers.id))
      .where(and(this.numberScope(actor), sql`${senderNumbers.status} <> 'DISABLED'`))
      .orderBy(senderNumbers.service, senderNumbers.label);
  }

  private async number(actor: AuthUser, id: string) {
    const [n] = await this.db.select().from(senderNumbers).where(and(eq(senderNumbers.id, id), this.numberScope(actor)));
    if (!n) throw new NotFoundException('WhatsApp number not found');
    return n;
  }

  async save(actor: AuthUser, senderNumberId: string, dto: AutoResponderDto) {
    const n = await this.number(actor, senderNumberId);
    if (dto.isActive && !dto.normalMessage && !dto.optOutMessage) {
      throw new BadRequestException('Write at least one reply, or turn it off');
    }
    const values = {
      name: dto.name,
      normalMessage: dto.normalMessage || null,
      optOutMessage: dto.optOutMessage || null,
      isActive: dto.isActive,
    };
    const [row] = await this.db
      .insert(autoResponders)
      .values({ ...values, senderNumberId, accountId: n.ownerAccountId ?? actor.accountId })
      .onConflictDoUpdate({ target: autoResponders.senderNumberId, set: { ...values, updatedAt: new Date() } })
      .returning();
    return row;
  }

  async remove(actor: AuthUser, senderNumberId: string) {
    await this.number(actor, senderNumberId);
    await this.db.delete(autoResponders).where(eq(autoResponders.senderNumberId, senderNumberId));
    return { ok: true };
  }

  @OnEvent(GatewayEvents.RECEIVED, { async: true })
  async onReceived({ message }: { message: MessageRow }) {
    try {
      const [r] = await this.db
        .select()
        .from(autoResponders)
        .where(and(eq(autoResponders.senderNumberId, message.senderNumberId), eq(autoResponders.isActive, true)));
      if (!r) return;
      const kind = isStopReply(message.body) ? 'optout' : 'normal';
      const text = kind === 'optout' ? r.optOutMessage : r.normalMessage;
      if (!text) return;
      if (kind === 'normal') {
        // A bot on this number answers instead
        const [bot] = await this.db
          .select({ id: bots.id })
          .from(bots)
          .where(and(eq(bots.senderNumberId, message.senderNumberId), eq(bots.isActive, true)));
        if (bot) return;
      }

      // Once a day per person and kind
      const [already] = await this.db
        .select({ id: messages.id })
        .from(messages)
        .where(
          and(
            eq(messages.senderNumberId, message.senderNumberId),
            eq(messages.contactPhone, message.contactPhone),
            eq(messages.direction, 'OUT'),
            sql`${messages.payload}->>'auto' = ${kind}`,
            gt(messages.createdAt, new Date(Date.now() - DAY_MS)),
          ),
        )
        .limit(1);
      if (already) return;

      await this.gateway.enqueue([
        {
          accountId: message.accountId,
          senderNumberId: message.senderNumberId,
          to: message.contactPhone,
          text,
          payload: { auto: kind },
          campaignId: message.campaignId ?? undefined,
        },
      ]);
      this.log.log(`Auto reply (${kind}) to ${message.contactPhone}`);
    } catch (e) {
      this.log.error(`Auto reply failed: ${(e as Error).message}`);
    }
  }
}

@Controller('auto-responders')
class AutoResponderController {
  constructor(private readonly svc: AutoResponderService) {}

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.svc.list(user);
  }

  @Put(':senderNumberId')
  save(@CurrentUser() user: AuthUser, @Param('senderNumberId', ParseUUIDPipe) id: string, @Body() dto: AutoResponderDto) {
    return this.svc.save(user, id, dto);
  }

  @Delete(':senderNumberId')
  remove(@CurrentUser() user: AuthUser, @Param('senderNumberId', ParseUUIDPipe) id: string) {
    return this.svc.remove(user, id);
  }
}

@Module({
  imports: [GatewayModule],
  controllers: [AutoResponderController],
  providers: [AutoResponderService],
})
export class AutoResponderModule {}
