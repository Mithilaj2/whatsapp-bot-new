import {
  Controller,
  ForbiddenException,
  Get,
  Headers,
  HttpCode,
  Logger,
  Post,
  Query,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { eq } from 'drizzle-orm';
import { Public } from '../auth/decorators';
import { Db, InjectDb } from '../db/db.module';
import { webhookEvents } from '../db/schema';
import { GatewayService } from './gateway.service';
import { MetaProvider } from './providers/meta.provider';

/**
 * WhatsApp calls these. Set the callback URL to https://<api domain>/api/webhooks/meta in
 * Meta > WhatsApp > Configuration, with META_VERIFY_TOKEN as the verify token, and subscribe to
 * "messages", "message_template_status_update" and "phone_number_quality_update".
 */
@Controller('webhooks/meta')
export class WebhooksController {
  private readonly log = new Logger('Webhooks');

  constructor(
    private readonly config: ConfigService,
    private readonly meta: MetaProvider,
    private readonly gateway: GatewayService,
    @InjectDb() private readonly db: Db,
  ) {}

  /** Meta checks the URL once when you save it. */
  @Public()
  @Get()
  verify(
    @Query('hub.mode') mode: string,
    @Query('hub.verify_token') token: string,
    @Query('hub.challenge') challenge: string,
  ) {
    const expected = this.config.get<string>('META_VERIFY_TOKEN');
    if (mode === 'subscribe' && expected && token === expected) return challenge;
    throw new ForbiddenException('Verify token does not match');
  }

  @Public()
  @Post()
  @HttpCode(200)
  async receive(@Req() req: RawBodyRequest<Request>, @Headers('x-hub-signature-256') signature?: string) {
    const valid = req.rawBody ? this.meta.verifySignature(req.rawBody, signature) : false;
    const [logged] = await this.db
      .insert(webhookEvents)
      // Unsigned calls could be anyone: keep a record, not what they sent
      .values({ provider: 'META', signatureValid: valid, payload: valid ? (req.body ?? {}) : {} })
      .returning({ id: webhookEvents.id });

    // Anyone can call this URL; only act on calls signed with our app secret
    if (!valid) {
      this.log.warn('Webhook with a missing or wrong signature ignored');
      throw new UnauthorizedException('Bad signature');
    }

    try {
      await this.gateway.handleEvents('META', this.meta.parseWebhook(req.body));
      await this.db.update(webhookEvents).set({ processedAt: new Date() }).where(eq(webhookEvents.id, logged.id));
    } catch (e) {
      await this.db.update(webhookEvents).set({ error: (e as Error).message }).where(eq(webhookEvents.id, logged.id));
    }
    // Always 200 for signed calls, or Meta keeps retrying the same event
    return 'ok';
  }
}
