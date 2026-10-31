import { Body, Controller, Delete, Get, Module, Param, ParseUUIDPipe, Patch, Post, Query, Res } from '@nestjs/common';
import { Transform } from 'class-transformer';
import { IsBoolean, IsIn, IsObject, IsOptional, IsString, IsUUID, MaxLength, MinLength, ValidateIf } from 'class-validator';
import type { Response } from 'express';
import { AuthUser, CurrentUser } from '../auth/decorators';
import { sendCsv } from '../common/csv';
import { PageQuery } from '../common/pagination';
import { GatewayModule } from '../gateway/gateway.module';
import { AiService } from './ai.service';
import { BotsService } from './bots.service';
import type { BotState } from './engine';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

class CreateBotDto {
  @Transform(trim)
  @IsString()
  @MinLength(2, { message: 'Give the bot a name' })
  @MaxLength(120)
  name: string;

  @IsOptional()
  @IsUUID()
  accountId?: string;
}

class UpdateBotDto {
  @Transform(trim)
  @IsOptional()
  @IsString()
  @MinLength(2, { message: 'Give the bot a name' })
  @MaxLength(120)
  name?: string;

  /** null takes the bot off its number. */
  @IsOptional()
  @ValidateIf((o) => o.senderNumberId !== null)
  @IsUUID()
  senderNumberId?: string | null;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsObject()
  flow?: Record<string, unknown>;
}

class SimulateDto {
  @IsObject()
  flow: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  state?: BotState | null;

  @IsString()
  @MaxLength(4096)
  text: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  replyId?: string;
}

class SessionsQuery extends PageQuery {
  @IsOptional()
  @IsIn(['ACTIVE', 'COMPLETED', 'HANDOFF', 'ENDED'])
  status?: string;
}

const statusLabel: Record<string, string> = {
  ACTIVE: 'In progress',
  COMPLETED: 'Finished',
  HANDOFF: 'Waiting for team',
  ENDED: 'Ended',
};

@Controller('bots')
class BotsController {
  constructor(private readonly bots: BotsService) {}

  @Get('settings')
  settings() {
    return this.bots.settings();
  }

  /** WhatsApp numbers a bot can be put on. */
  @Get('numbers')
  numbers(@CurrentUser() user: AuthUser) {
    return this.bots.numbers(user);
  }

  /** Runs a flow (saved or not) for the "Test chat", without sending anything. */
  @Post('simulate')
  simulate(@CurrentUser() user: AuthUser, @Body() dto: SimulateDto) {
    return this.bots.simulate(user, dto);
  }

  @Post('sessions/:id/end')
  endSession(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.bots.endSession(user, id);
  }

  @Get()
  list(@CurrentUser() user: AuthUser) {
    return this.bots.list(user);
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateBotDto) {
    return this.bots.create(user, dto);
  }

  @Get(':id')
  detail(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.bots.detail(user, id);
  }

  @Patch(':id')
  update(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateBotDto) {
    return this.bots.update(user, id, dto);
  }

  @Delete(':id')
  remove(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.bots.remove(user, id);
  }

  @Get(':id/sessions')
  sessions(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Query() q: SessionsQuery) {
    return this.bots.sessions(user, id, q);
  }

  @Get(':id/sessions/export')
  async export(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Res() res: Response) {
    const { bot, vars, rows } = await this.bots.exportSessions(user, id);
    const safe = bot.name.replace(/[^\w-]+/g, '-').toLowerCase();
    sendCsv(
      res,
      `bot-${safe}-answers.csv`,
      ['Phone', 'Name', 'Status', 'Started', 'Last message', ...vars],
      rows.map((r) => [
        `+${r.contactPhone}`,
        r.contactName ?? '',
        statusLabel[r.status] ?? r.status,
        r.startedAt.toISOString(),
        r.lastActivityAt.toISOString(),
        ...vars.map((v) => r.variables[v] ?? ''),
      ]),
    );
  }
}

@Module({
  imports: [GatewayModule],
  controllers: [BotsController],
  providers: [BotsService, AiService],
})
export class BotsModule {}
