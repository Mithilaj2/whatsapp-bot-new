import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'crypto';
import type { RichMessage, TemplatePayload } from '../../db/schema';
import {
  MessagingProvider,
  NumberInfo,
  ProviderError,
  ProviderEvent,
  SenderCreds,
  TemplateRef,
} from './types';

/**
 * Meta error codes that are worth trying again later. Everything else fails the message.
 * https://developers.facebook.com/documentation/business-messaging/whatsapp/support/error-codes
 */
const RETRYABLE = new Set(['1', '2', '4', '80007', '130429', '131000', '131016', '131056', '133004']);
/** The number's token or setup is wrong: stop sending from it. */
const SENDER_BROKEN = new Set(['0', '190', '200', '10', '131031', '131042', '133010']);

interface GraphError {
  message?: string;
  code?: number;
  error_subcode?: number;
  error_data?: { details?: string };
}

@Injectable()
export class MetaProvider implements MessagingProvider {
  private readonly log = new Logger('MetaProvider');
  private readonly base: string;

  constructor(private readonly config: ConfigService) {
    const url = config.get('META_GRAPH_URL', 'https://graph.facebook.com').replace(/\/$/, '');
    this.base = `${url}/${config.get('META_GRAPH_VERSION', 'v23.0')}`;
  }

  /** Calls the Graph API and turns Meta's error format into ProviderError. */
  private async graph<T>(
    token: string,
    path: string,
    init: { method?: string; body?: unknown; headers?: Record<string, string>; raw?: Buffer } = {},
  ): Promise<T> {
    let res: Response;
    try {
      res = await fetch(`${this.base}/${path}`, {
        method: init.method ?? 'GET',
        headers: {
          authorization: `Bearer ${token}`,
          ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}),
          ...init.headers,
        },
        body: init.raw ? new Uint8Array(init.raw) : (init.body !== undefined ? JSON.stringify(init.body) : undefined),
        signal: AbortSignal.timeout(20_000),
      });
    } catch (e) {
      throw new ProviderError(`Could not reach WhatsApp: ${(e as Error).message}`, 'NETWORK', true);
    }

    const data = (await res.json().catch(() => ({}))) as { error?: GraphError } & T;
    if (res.ok && !data.error) return data;

    const err = data.error ?? {};
    const code = String(err.code ?? res.status);
    const detail = err.error_data?.details ? ` (${err.error_data.details})` : '';
    const message = `${err.message ?? `WhatsApp returned HTTP ${res.status}`}${detail}`;
    const retryAfter = Number(res.headers.get('retry-after'));
    throw new ProviderError(
      message,
      code,
      RETRYABLE.has(code) || res.status >= 500,
      Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : undefined,
      SENDER_BROKEN.has(code),
    );
  }

  async sendTemplate(creds: SenderCreds, to: string, t: TemplateRef, payload: TemplatePayload) {
    const components: unknown[] = [];
    if (t.content.header?.type === 'IMAGE') {
      const link = payload.headerImageUrl ?? t.content.header.exampleUrl;
      components.push({ type: 'header', parameters: [{ type: 'image', image: { link } }] });
    }
    if (payload.bodyParams?.length) {
      components.push({
        type: 'body',
        parameters: payload.bodyParams.map((text) => ({ type: 'text', text })),
      });
    }
    const res = await this.graph<{ messages: { id: string }[] }>(creds.accessToken, `${creds.phoneNumberId}/messages`, {
      method: 'POST',
      body: {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to,
        type: 'template',
        template: { name: t.name, language: { code: t.language }, components },
      },
    });
    return res.messages[0].id;
  }

  async sendText(creds: SenderCreds, to: string, text: string) {
    const res = await this.graph<{ messages: { id: string }[] }>(creds.accessToken, `${creds.phoneNumberId}/messages`, {
      method: 'POST',
      body: { messaging_product: 'whatsapp', recipient_type: 'individual', to, type: 'text', text: { body: text } },
    });
    return res.messages[0].id;
  }

  async sendRich(creds: SenderCreds, to: string, m: RichMessage) {
    let body: Record<string, unknown>;
    if (m.kind === 'image') {
      body = { type: 'image', image: { link: m.imageUrl, ...(m.caption ? { caption: m.caption } : {}) } };
    } else if (m.kind === 'buttons') {
      body = {
        type: 'interactive',
        interactive: {
          type: 'button',
          ...(m.imageUrl ? { header: { type: 'image', image: { link: m.imageUrl } } } : {}),
          body: { text: m.body },
          ...(m.footer ? { footer: { text: m.footer } } : {}),
          action: { buttons: m.buttons.map((b) => ({ type: 'reply', reply: { id: b.id, title: b.title } })) },
        },
      };
    } else {
      body = {
        type: 'interactive',
        interactive: {
          type: 'list',
          body: { text: m.body },
          ...(m.footer ? { footer: { text: m.footer } } : {}),
          action: {
            button: m.button,
            sections: [{ title: m.button.slice(0, 24), rows: m.rows.map((r) => ({ id: r.id, title: r.title, ...(r.description ? { description: r.description } : {}) })) }],
          },
        },
      };
    }
    const res = await this.graph<{ messages: { id: string }[] }>(creds.accessToken, `${creds.phoneNumberId}/messages`, {
      method: 'POST',
      body: { messaging_product: 'whatsapp', recipient_type: 'individual', to, ...body },
    });
    return res.messages[0].id;
  }

  async createTemplate(creds: SenderCreds, t: TemplateRef) {
    const components: unknown[] = [];
    const h = t.content.header;
    if (h?.type === 'IMAGE') {
      const handle = await this.uploadExampleMedia(creds.accessToken, h.exampleUrl);
      components.push({ type: 'HEADER', format: 'IMAGE', example: { header_handle: [handle] } });
    } else if (h?.type === 'TEXT') {
      components.push({ type: 'HEADER', format: 'TEXT', text: h.text });
    }
    components.push({
      type: 'BODY',
      text: t.content.body,
      ...(t.content.bodyExamples?.length ? { example: { body_text: [t.content.bodyExamples] } } : {}),
    });
    if (t.content.footer) components.push({ type: 'FOOTER', text: t.content.footer });
    if (t.content.buttons?.length) {
      components.push({
        type: 'BUTTONS',
        buttons: t.content.buttons.map((b) =>
          b.type === 'PHONE_NUMBER'
            ? { type: 'PHONE_NUMBER', text: b.text, phone_number: b.phone }
            : b.type === 'URL'
              ? { type: 'URL', text: b.text, url: b.url }
              : { type: 'QUICK_REPLY', text: b.text },
        ),
      });
    }
    const res = await this.graph<{ id: string; status: string }>(creds.accessToken, `${creds.wabaId}/message_templates`, {
      method: 'POST',
      body: { name: t.name, language: t.language, category: t.category, components },
    });
    return { id: res.id, status: res.status };
  }

  async getTemplateStatus(creds: SenderCreds, id: string) {
    const res = await this.graph<{ status: string; rejected_reason?: string }>(
      creds.accessToken,
      `${id}?fields=status,rejected_reason`,
    );
    return { status: res.status, reason: res.rejected_reason && res.rejected_reason !== 'NONE' ? res.rejected_reason : undefined };
  }

  async getNumberInfo(creds: SenderCreds): Promise<NumberInfo> {
    const res = await this.graph<{
      display_phone_number?: string;
      verified_name?: string;
      quality_rating?: string;
      messaging_limit_tier?: string;
    }>(creds.accessToken, `${creds.phoneNumberId}?fields=display_phone_number,verified_name,quality_rating,messaging_limit_tier`);
    return {
      displayPhoneNumber: res.display_phone_number,
      verifiedName: res.verified_name,
      qualityRating: res.quality_rating,
      messagingLimit: res.messaging_limit_tier,
    };
  }

  /**
   * Template image headers need a sample uploaded through Meta's resumable upload API.
   * Needs META_APP_ID. Returns the handle Meta gives back.
   */
  private async uploadExampleMedia(token: string, url: string): Promise<string> {
    const appId = this.config.get<string>('META_APP_ID');
    if (!appId) throw new ProviderError('Set META_APP_ID to submit templates with an image', 'CONFIG', false);

    const img = await fetch(url, { signal: AbortSignal.timeout(20_000) }).catch(() => null);
    if (!img?.ok) throw new ProviderError('Could not download the sample image for the template', 'MEDIA', false);
    const bytes = Buffer.from(await img.arrayBuffer());
    const type = img.headers.get('content-type')?.split(';')[0] ?? 'image/jpeg';

    const session = await this.graph<{ id: string }>(
      token,
      `${appId}/uploads?file_length=${bytes.length}&file_type=${encodeURIComponent(type)}`,
      { method: 'POST' },
    );
    const done = await this.graph<{ h: string }>(token, session.id, {
      method: 'POST',
      headers: { authorization: `OAuth ${token}`, file_offset: '0' },
      raw: bytes,
    });
    return done.h;
  }

  // ---------------------------------------------------------------- webhooks

  /** Checks Meta's X-Hub-Signature-256 header against the raw request body. */
  verifySignature(rawBody: Buffer, header: string | undefined): boolean {
    const secret = this.config.get<string>('META_APP_SECRET');
    if (!secret || !header?.startsWith('sha256=')) return false;
    const expected = Buffer.from(createHmac('sha256', secret).update(rawBody).digest('hex'));
    const given = Buffer.from(header.slice(7));
    return expected.length === given.length && timingSafeEqual(expected, given);
  }

  /** Turns one webhook body into our events. Unknown parts are ignored. */
  parseWebhook(body: any): ProviderEvent[] {
    const events: ProviderEvent[] = [];
    if (body?.object !== 'whatsapp_business_account') return events;

    for (const entry of body.entry ?? []) {
      for (const change of entry.changes ?? []) {
        const v = change.value ?? {};
        if (change.field === 'messages') {
          const phoneNumberId: string = v.metadata?.phone_number_id;
          const names = new Map<string, string>(
            (v.contacts ?? []).map((c: any) => [c.wa_id, c.profile?.name]),
          );
          for (const s of v.statuses ?? []) {
            const status = String(s.status).toUpperCase();
            if (!['SENT', 'DELIVERED', 'READ', 'FAILED'].includes(status)) continue;
            const e = s.errors?.[0];
            events.push({
              kind: 'status',
              phoneNumberId,
              providerMessageId: s.id,
              status: status as 'SENT',
              at: new Date(Number(s.timestamp) * 1000),
              errorCode: e ? String(e.code) : undefined,
              errorMessage: e ? (e.error_data?.details ?? e.message ?? e.title) : undefined,
            });
          }
          for (const m of v.messages ?? []) {
            const text =
              m.text?.body ??
              m.button?.text ??
              m.interactive?.button_reply?.title ??
              m.interactive?.list_reply?.title ??
              m.image?.caption;
            events.push({
              kind: 'inbound',
              phoneNumberId,
              providerMessageId: m.id,
              from: m.from,
              contactName: names.get(m.from),
              at: new Date(Number(m.timestamp) * 1000),
              type:
                m.type === 'text' || m.type === 'button'
                  ? 'TEXT'
                  : m.type === 'image'
                    ? 'IMAGE'
                    : m.type === 'interactive'
                      ? 'INTERACTIVE'
                      : 'OTHER',
              text,
              replyToProviderId: m.context?.id,
              replyId: m.interactive?.button_reply?.id ?? m.interactive?.list_reply?.id ?? m.button?.payload,
            });
          }
        } else if (change.field === 'message_template_status_update') {
          const event = String(v.event ?? '').toUpperCase();
          const map: Record<string, 'APPROVED' | 'REJECTED' | 'PAUSED' | 'DISABLED' | 'PENDING'> = {
            APPROVED: 'APPROVED',
            REJECTED: 'REJECTED',
            PAUSED: 'PAUSED',
            DISABLED: 'DISABLED',
            PENDING_DELETION: 'DISABLED',
            FLAGGED: 'PAUSED',
            REINSTATED: 'APPROVED',
            PENDING: 'PENDING',
          };
          if (map[event] && v.message_template_id) {
            events.push({
              kind: 'template',
              providerTemplateId: String(v.message_template_id),
              status: map[event],
              reason: v.reason && v.reason !== 'NONE' ? String(v.reason) : undefined,
            });
          }
        } else if (change.field === 'phone_number_quality_update') {
          events.push({
            kind: 'number',
            displayPhoneNumber: v.display_phone_number,
            qualityRating: v.event,
            messagingLimit: v.current_limit,
          });
        }
      }
    }
    return events;
  }
}
