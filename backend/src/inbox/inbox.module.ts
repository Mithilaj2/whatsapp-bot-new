import { Body, Controller, Get, Module, Param, ParseUUIDPipe, Post, Query, Res } from '@nestjs/common';
import { IsIn, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import type { Response } from 'express';
import { AuthUser, CurrentUser } from '../auth/decorators';
import { sendCsv } from '../common/csv';
import { PageQuery } from '../common/pagination';
import { GatewayModule } from '../gateway/gateway.module';
import { InboxService } from './inbox.service';

class ConversationsQuery extends PageQuery {
  @IsIn(['PREMIUM', 'BRANDED'])
  service: 'PREMIUM' | 'BRANDED';
}

class ExportQuery {
  @IsIn(['PREMIUM', 'BRANDED'])
  service: 'PREMIUM' | 'BRANDED';
}

class ReplyDto {
  @IsString()
  @MinLength(1)
  @MaxLength(4096)
  text: string;
}

@Controller('inbox')
class InboxController {
  constructor(private readonly inbox: InboxService) {}

  @Get('conversations')
  conversations(@CurrentUser() user: AuthUser, @Query() q: ConversationsQuery) {
    return this.inbox.conversations(user, q);
  }

  @Get('export')
  async export(@CurrentUser() user: AuthUser, @Query() q: ExportQuery, @Res() res: Response) {
    const rows = await this.inbox.exportRows(user, q.service);
    sendCsv(
      res,
      `incoming-messages-${new Date().toISOString().slice(0, 10)}.csv`,
      ['Received', 'Phone', 'Name', 'Message', 'Campaign', 'Number'],
      rows.map((r) => [r.createdAt, `+${r.contactPhone}`, r.contactName, r.body, r.campaignNo, r.numberLabel]),
    );
  }

  @Get(':senderNumberId/:phone')
  thread(
    @CurrentUser() user: AuthUser,
    @Param('senderNumberId', ParseUUIDPipe) senderNumberId: string,
    @Param('phone') phone: string,
  ) {
    return this.inbox.thread(user, senderNumberId, phone.replace(/[^\d]/g, ''));
  }

  @Post(':senderNumberId/:phone/reply')
  reply(
    @CurrentUser() user: AuthUser,
    @Param('senderNumberId', ParseUUIDPipe) senderNumberId: string,
    @Param('phone') phone: string,
    @Body() dto: ReplyDto,
  ) {
    return this.inbox.reply(user, senderNumberId, phone.replace(/[^\d]/g, ''), dto.text);
  }
}

@Module({
  imports: [GatewayModule],
  controllers: [InboxController],
  providers: [InboxService],
})
export class InboxModule {}
