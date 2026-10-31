import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { AuthUser, CurrentUser } from '../auth/decorators';
import { sendCsv } from '../common/csv';
import {
  CampaignDefaultsDto,
  CampaignsQuery,
  CheckRecipientsDto,
  CreateCampaignDto,
  MESSAGE_MAX,
  RecipientsQuery,
} from './campaigns.dto';
import { CampaignsService } from './campaigns.service';

const statusLabel: Record<string, string> = {
  QUEUED: 'Waiting',
  SENDING: 'Sending',
  SENT: 'Sent',
  DELIVERED: 'Delivered',
  READ: 'Read',
  FAILED: 'Failed',
  CANCELLED: 'Cancelled',
};

@Controller('campaigns')
export class CampaignsController {
  constructor(private readonly campaigns: CampaignsService) {}

  /** Recipient limits and message length, for the composer. */
  @Get('limits')
  limits() {
    return { ...this.campaigns.limits, messageMax: MESSAGE_MAX };
  }

  @Get('defaults')
  getDefaults(@CurrentUser() user: AuthUser) {
    return this.campaigns.getDefaults(user);
  }

  @Put('defaults')
  setDefaults(@CurrentUser() user: AuthUser, @Body() dto: CampaignDefaultsDto) {
    return this.campaigns.setDefaults(user, dto);
  }

  /** Counts valid / invalid / duplicate numbers and the credits needed, without sending. */
  @Post('check')
  check(@CurrentUser() user: AuthUser, @Body() dto: CheckRecipientsDto) {
    return this.campaigns.check(user, dto);
  }

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateCampaignDto) {
    return this.campaigns.create(user, dto);
  }

  @Get()
  list(@CurrentUser() user: AuthUser, @Query() q: CampaignsQuery) {
    return this.campaigns.list(user, q);
  }

  @Get(':id')
  detail(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.campaigns.detail(user, id);
  }

  @Get(':id/recipients')
  recipients(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Query() q: RecipientsQuery) {
    return this.campaigns.recipients(user, id, q);
  }

  @Get(':id/report')
  async report(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Res() res: Response) {
    const { campaign, rows } = await this.campaigns.reportRows(user, id);
    sendCsv(
      res,
      `campaign-${campaign.campaignNo}.csv`,
      ['Phone', 'Country', 'Status', 'Sent at', 'Delivered at', 'Read at', 'Failure reason', 'Credit refunded'],
      rows.map((r) => [
        `+${r.contactPhone}`,
        r.countryCode,
        statusLabel[r.status] ?? r.status,
        r.sentAt,
        r.deliveredAt,
        r.readAt,
        r.errorMessage,
        r.refunded ? 'Yes' : '',
      ]),
    );
  }

  @Post(':id/cancel')
  cancel(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.campaigns.cancel(user, id);
  }
}
