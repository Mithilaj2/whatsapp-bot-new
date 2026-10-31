import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import type { RichMessage, TemplatePayload } from '../../db/schema';
import { MessagingProvider, ProviderError, ProviderEvent, SenderCreds, TemplateRef } from './types';

type Emit = (events: ProviderEvent[]) => Promise<void>;

/**
 * Test mode: behaves like WhatsApp without sending anything. Messages move to sent, delivered and
 * read over a few seconds; templates are approved after a moment. Numbers ending in 0000 fail as
 * "not on WhatsApp", which is handy for trying out failure handling and refunds.
 */
@Injectable()
export class TestProvider implements MessagingProvider {
  private emit: Emit = async () => {};
  /** Speeds simulations up in automated tests. */
  speed = Number(process.env.TEST_PROVIDER_SPEED || 1);

  onEvents(fn: Emit) {
    this.emit = fn;
  }

  private later(ms: number, events: ProviderEvent[]) {
    setTimeout(() => void this.emit(events).catch(() => {}), ms / this.speed).unref();
  }

  private async send(creds: SenderCreds, to: string) {
    if (!/^\d{8,15}$/.test(to)) throw new ProviderError('Invalid phone number', '131009', false);
    const id = `test.${randomUUID()}`;
    if (to.endsWith('0000')) {
      this.later(500, [
        {
          kind: 'status',
          phoneNumberId: creds.phoneNumberId,
          providerMessageId: id,
          status: 'FAILED',
          at: new Date(),
          errorCode: '131026',
          errorMessage: 'Message undeliverable: this number is not on WhatsApp (test mode)',
        },
      ]);
      return id;
    }
    const base = { kind: 'status' as const, phoneNumberId: creds.phoneNumberId, providerMessageId: id };
    this.later(400, [{ ...base, status: 'SENT', at: new Date() }]);
    this.later(1200, [{ ...base, status: 'DELIVERED', at: new Date() }]);
    this.later(3000, [{ ...base, status: 'READ', at: new Date() }]);
    return id;
  }

  sendTemplate(creds: SenderCreds, to: string, _t: TemplateRef, _p: TemplatePayload) {
    return this.send(creds, to);
  }

  sendText(creds: SenderCreds, to: string) {
    return this.send(creds, to);
  }

  sendRich(creds: SenderCreds, to: string, _m: RichMessage) {
    return this.send(creds, to);
  }

  async createTemplate(_creds: SenderCreds, t: TemplateRef) {
    const id = `test-tpl-${randomUUID().slice(0, 8)}`;
    // Bodies containing "reject" are rejected, so the rejection flow can be tried too
    const rejected = /reject/i.test(t.content.body);
    this.later(1500, [
      {
        kind: 'template',
        providerTemplateId: id,
        status: rejected ? 'REJECTED' : 'APPROVED',
        reason: rejected ? 'INVALID_FORMAT (test mode)' : undefined,
      },
    ]);
    return { id, status: 'PENDING' };
  }

  async getTemplateStatus() {
    return { status: 'APPROVED' };
  }

  async getNumberInfo() {
    return { qualityRating: 'GREEN', messagingLimit: 'TIER_1K', verifiedName: 'Test number' };
  }

  /** Pretends a contact replied, as if WhatsApp sent us the webhook. */
  simulateInbound(creds: SenderCreds, from: string, text: string, contactName?: string, replyTo?: string, replyId?: string) {
    const id = `test.in.${randomUUID()}`;
    void this.emit([
      {
        kind: 'inbound',
        phoneNumberId: creds.phoneNumberId,
        providerMessageId: id,
        from,
        contactName,
        at: new Date(),
        type: replyId ? 'INTERACTIVE' : 'TEXT',
        text,
        replyToProviderId: replyTo,
        replyId,
      },
    ]);
    return id;
  }
}
