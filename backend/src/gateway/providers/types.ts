import type { RichMessage, TemplateContent, TemplatePayload } from '../../db/schema';

/** What a provider needs to act for one WhatsApp number. */
export interface SenderCreds {
  phoneNumberId: string;
  wabaId: string;
  accessToken: string;
}

export interface TemplateRef {
  name: string;
  language: string;
  category: 'MARKETING' | 'UTILITY';
  content: TemplateContent;
}

/** A failure from the provider. `retryable` failures are tried again later. */
export class ProviderError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly retryable: boolean,
    public readonly retryAfterMs?: number,
    /** The number's token or setup is broken: stop using it until fixed. */
    public readonly senderBroken = false,
  ) {
    super(message);
  }
}

export type DeliveryStatus = 'SENT' | 'DELIVERED' | 'READ' | 'FAILED';

/** Things a provider tells us about through webhooks. */
export type ProviderEvent =
  | {
      kind: 'status';
      phoneNumberId: string;
      providerMessageId: string;
      status: DeliveryStatus;
      at: Date;
      errorCode?: string;
      errorMessage?: string;
    }
  | {
      kind: 'inbound';
      phoneNumberId: string;
      providerMessageId: string;
      from: string;
      contactName?: string;
      at: Date;
      type: 'TEXT' | 'IMAGE' | 'INTERACTIVE' | 'OTHER';
      text?: string;
      replyToProviderId?: string;
      /** Id of the tapped button or list row. */
      replyId?: string;
    }
  | {
      kind: 'template';
      providerTemplateId: string;
      status: 'APPROVED' | 'REJECTED' | 'PAUSED' | 'DISABLED' | 'PENDING';
      reason?: string;
    }
  | {
      kind: 'number';
      phoneNumberId?: string;
      displayPhoneNumber?: string;
      qualityRating?: string;
      messagingLimit?: string;
    };

export interface NumberInfo {
  displayPhoneNumber?: string;
  verifiedName?: string;
  qualityRating?: string;
  messagingLimit?: string;
}

/** Every way of sending WhatsApp messages implements this, so providers can be swapped. */
export interface MessagingProvider {
  sendTemplate(creds: SenderCreds, to: string, template: TemplateRef, payload: TemplatePayload): Promise<string>;
  sendText(creds: SenderCreds, to: string, text: string): Promise<string>;
  /** Buttons, list menu or image (inside the 24-hour window). */
  sendRich(creds: SenderCreds, to: string, message: RichMessage): Promise<string>;
  /** Submits a template for approval. Returns the provider's template id. */
  createTemplate(creds: SenderCreds, template: TemplateRef): Promise<{ id: string; status: string }>;
  getTemplateStatus(creds: SenderCreds, providerTemplateId: string): Promise<{ status: string; reason?: string }>;
  getNumberInfo(creds: SenderCreds): Promise<NumberInfo>;
}
