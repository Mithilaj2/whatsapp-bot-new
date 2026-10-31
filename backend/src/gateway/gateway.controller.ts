import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BadRequestException } from '@nestjs/common';
import { AuthUser, CurrentUser, Roles } from '../auth/decorators';
import {
  CreateNumberDto,
  CreateTemplateDto,
  MessagesQuery,
  SimulateInboundDto,
  TemplatesQuery,
  TestSendDto,
  UpdateNumberDto,
} from './gateway.dto';
import { GatewayService } from './gateway.service';
import { GatewayWorker } from './gateway.worker';
import { TestProvider } from './providers/test.provider';

/** Platform setup for sending: numbers, templates, test messages. Admin only for now. */
@Controller('gateway')
@Roles('ADMIN')
export class GatewayController {
  constructor(
    private readonly gateway: GatewayService,
    private readonly worker: GatewayWorker,
    private readonly test: TestProvider,
    private readonly config: ConfigService,
  ) {}

  /** What the admin needs to paste into Meta's webhook settings, and whether sending is running. */
  @Get('setup')
  setup() {
    const api = this.config.get<string>('PUBLIC_API_URL', 'http://localhost:4000/api').replace(/\/$/, '');
    return {
      webhookUrl: `${api}/webhooks/meta`,
      verifyTokenSet: Boolean(this.config.get('META_VERIFY_TOKEN')),
      appSecretSet: Boolean(this.config.get('META_APP_SECRET')),
      platformTokenSet: Boolean(this.config.get('META_ACCESS_TOKEN')),
      appIdSet: Boolean(this.config.get('META_APP_ID')),
      workerRunning: this.worker.isRunning,
    };
  }

  @Get('numbers')
  numbers() {
    return this.gateway.listNumbers();
  }

  @Post('numbers')
  createNumber(@Body() dto: CreateNumberDto) {
    return this.gateway.createNumber(dto);
  }

  @Patch('numbers/:id')
  updateNumber(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateNumberDto) {
    return this.gateway.updateNumber(id, dto);
  }

  @Post('numbers/:id/refresh')
  refresh(@Param('id', ParseUUIDPipe) id: string) {
    return this.gateway.refreshNumber(id);
  }

  @Post('numbers/:id/test')
  sendTest(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: TestSendDto) {
    return this.gateway.sendTest(user, id, dto);
  }

  @Get('templates')
  templates(@Query() q: TemplatesQuery) {
    return this.gateway.listTemplates(q);
  }

  @Post('templates')
  createTemplate(@CurrentUser() user: AuthUser, @Body() dto: CreateTemplateDto) {
    return this.gateway.createTemplate(user, dto);
  }

  @Post('templates/:id/sync')
  syncTemplate(@Param('id', ParseUUIDPipe) id: string) {
    return this.gateway.syncTemplate(id);
  }

  @Get('messages')
  messages(@Query() q: MessagesQuery) {
    return this.gateway.listMessages(q);
  }

  @Get('messages/:id')
  message(@Param('id', ParseUUIDPipe) id: string) {
    return this.gateway.getMessage(id);
  }

  /** Test-mode numbers only: pretend a contact replied. */
  @Post('test/inbound')
  async simulateInbound(@Body() dto: SimulateInboundDto) {
    const n = await this.gateway.getNumber(dto.senderNumberId);
    if (n.provider !== 'TEST') throw new BadRequestException('Only works for test-mode numbers');
    return { id: this.test.simulateInbound(this.gateway.creds(n), dto.from, dto.text, dto.name) };
  }
}
