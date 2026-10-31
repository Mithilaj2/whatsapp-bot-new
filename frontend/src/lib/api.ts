const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api';
const TOKEN_KEY = 'wb360_token';

export type AccountType = 'ADMIN' | 'RESELLER' | 'CUSTOMER';
export type AccountStatus = 'ACTIVE' | 'SUSPENDED';

export interface Me {
  id: string;
  username: string;
  name: string;
  account: {
    id: string;
    username: string;
    name: string;
    type: AccountType;
    brandName: string | null;
    logoUrl: string | null;
    parent: { username: string; name: string } | null;
  };
}

export interface Account {
  id: string;
  username: string;
  name: string;
  type: AccountType;
  status: AccountStatus;
  email: string | null;
  phone: string | null;
  domain: string | null;
  brandName: string | null;
  logoUrl: string | null;
  parentId: string | null;
  parent: { id: string; username: string; name: string } | null;
  childCount: number;
  createdAt: string;
}

export interface TreeNode {
  id: string;
  username: string;
  name: string;
  type: AccountType;
  status: AccountStatus;
  parentId: string | null;
}

export interface Country {
  id: string;
  code: string;
  name: string;
  isd: string;
  slug: string;
  isActive: boolean;
  createdAt: string;
}

export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

export const tokenStore = {
  get: () => (typeof window === 'undefined' ? null : window.localStorage.getItem(TOKEN_KEY)),
  set: (t: string) => window.localStorage.setItem(TOKEN_KEY, t),
  clear: () => window.localStorage.removeItem(TOKEN_KEY),
};

/** Called by the auth provider so a 401 anywhere logs the user out. */
let onUnauthorized: () => void = () => {};
export const setUnauthorizedHandler = (fn: () => void) => {
  onUnauthorized = fn;
};

export async function api<T>(
  path: string,
  options: { method?: string; body?: unknown; query?: Record<string, unknown> } = {},
): Promise<T> {
  const url = new URL(API_URL + path);
  for (const [k, v] of Object.entries(options.query ?? {})) {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
  }
  const token = tokenStore.get();
  let res: Response;
  try {
    res = await fetch(url, {
      method: options.method ?? 'GET',
      headers: {
        ...(options.body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    });
  } catch {
    throw new ApiError('Cannot reach the server. Check your internet connection.', 0);
  }

  const data = await res.json().catch(() => null);
  if (!res.ok) {
    if (res.status === 401 && token) onUnauthorized();
    const msg = Array.isArray(data?.message) ? data.message[0] : data?.message;
    throw new ApiError(msg || 'Something went wrong. Try again.', res.status);
  }
  return data as T;
}

// ---------------------------------------------------------------- credits (Phase 2)

export type Service = 'PREMIUM' | 'BRANDED';
export type CreditTxnType = 'CREDIT' | 'DEBIT' | 'TRANSFER_IN' | 'TRANSFER_OUT' | 'SPENT' | 'REFUND';

export interface Balance {
  accountId: string;
  username: string;
  accountName: string;
  accountType: AccountType;
  service: Service;
  countryCode: string;
  countryName: string;
  balance: number;
  updatedAt: string;
}

export interface CreditTxn {
  id: string;
  createdAt: string;
  accountId: string;
  username: string;
  accountName: string;
  service: Service;
  type: CreditTxnType;
  amount: number;
  balanceAfter: number;
  countryCode: string;
  counterpartyUsername: string | null;
  counterpartyName: string | null;
  campaignNo: string | null;
  recipients: number | null;
  remarks: string | null;
  createdBy: string | null;
}

export interface CreditSummary {
  totals: Record<Service, number>;
  byCountry: Balance[];
}

/** Downloads a CSV export from the API (needs the login token, so a plain link won't work). */
export async function downloadCsv(path: string, query: Record<string, unknown>, filename: string) {
  const url = new URL(API_URL + path);
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
  }
  const res = await fetch(url, { headers: { authorization: `Bearer ${tokenStore.get() ?? ''}` } });
  if (!res.ok) throw new ApiError('Export failed. Try again.', res.status);
  const blob = await res.blob();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

// ---------------------------------------------------------------- gateway (Phase 3)

export type ProviderKind = 'META' | 'TEST';
export type TemplateStatus = 'DRAFT' | 'PENDING' | 'APPROVED' | 'REJECTED' | 'PAUSED' | 'DISABLED';
export type MessageStatus = 'QUEUED' | 'SENDING' | 'SENT' | 'DELIVERED' | 'READ' | 'FAILED' | 'RECEIVED' | 'CANCELLED';

export interface SenderNumber {
  id: string;
  label: string;
  provider: ProviderKind;
  service: Service;
  ownerAccountId: string | null;
  ownerUsername: string | null;
  phoneNumber: string;
  displayName: string | null;
  phoneNumberId: string;
  wabaId: string;
  accessToken: string | null;
  usesPlatformToken: boolean;
  status: 'ACTIVE' | 'DISABLED';
  isDefault: boolean;
  ratePerSecond: number;
  qualityRating: string | null;
  messagingLimit: string | null;
  lastError: string | null;
  createdAt: string;
}

export interface TemplateButton {
  type: 'PHONE_NUMBER' | 'URL' | 'QUICK_REPLY';
  text: string;
  phone?: string;
  url?: string;
}

export interface TemplateContent {
  header?: { type: 'IMAGE'; exampleUrl: string } | { type: 'TEXT'; text: string };
  body: string;
  bodyExamples?: string[];
  footer?: string;
  buttons?: TemplateButton[];
}

export interface MessageTemplate {
  id: string;
  senderNumberId: string;
  numberLabel: string;
  provider: ProviderKind;
  name: string;
  language: string;
  category: 'MARKETING' | 'UTILITY';
  content: TemplateContent;
  status: TemplateStatus;
  rejectionReason: string | null;
  createdAt: string;
}

export interface Message {
  id: string;
  direction: 'OUT' | 'IN';
  contactPhone: string;
  contactName: string | null;
  kind: string;
  body: string | null;
  status: MessageStatus;
  errorCode: string | null;
  errorMessage: string | null;
  attempts: number;
  campaignId: string | null;
  createdAt: string;
  sentAt: string | null;
  deliveredAt: string | null;
  readAt: string | null;
  failedAt: string | null;
  numberLabel?: string;
  accountUsername?: string;
  templateName?: string | null;
}

export interface GatewaySetup {
  webhookUrl: string;
  verifyTokenSet: boolean;
  appSecretSet: boolean;
  platformTokenSet: boolean;
  appIdSet: boolean;
  workerRunning: boolean;
}

// ---------------------------------------------------------------- campaigns (Phase 4)

export type CampaignStatus = 'PENDING_APPROVAL' | 'SENDING' | 'COMPLETED' | 'CANCELLED' | 'REJECTED';

export interface CampaignStats {
  queued: number;
  sent: number;
  delivered: number;
  read: number;
  failed: number;
  cancelled: number;
  replies: number;
}

export interface CampaignCountry {
  code: string;
  name: string;
  recipients: number;
  credits: number;
  balance?: number | null;
  enough?: boolean;
}

export interface CampaignListItem {
  id: string;
  campaignNo: string;
  accountId: string;
  accountUsername: string;
  accountName: string;
  service: Service;
  brandName: string | null;
  title: string;
  status: CampaignStatus;
  isDemo: boolean;
  recipients: number;
  creditsCharged: number;
  creditsRefunded: number;
  submittedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  stats: CampaignStats | null;
}

export interface CampaignDetail extends CampaignListItem {
  content: { imageUrl?: string; message: string; callNumber?: string; visitUrl?: string };
  totalNumbers: number;
  invalidNumbers: number;
  duplicateNumbers: number;
  optedOutNumbers: number;
  byCountry: CampaignCountry[];
  rejectionReason: string | null;
  createdBy: string | null;
  templateStatus: TemplateStatus;
  /** Branded: the customer's own number it was sent from. */
  senderPhone: string | null;
  failureReasons: { reason: string | null; code: string | null; n: number }[];
}

export interface RecipientCheck {
  total: number;
  valid: number;
  invalid: number;
  duplicates: number;
  optedOut: number;
  countryOff: number;
  recipients: number;
  invalidSamples: string[];
  byCountry: CampaignCountry[];
  creditsNeeded: number;
  enoughCredits: boolean;
  isDemo: boolean;
  problem: string | null;
  limits: { demoMax: number; min: number; max: number };
}

export interface CampaignRecipient {
  id: string;
  contactPhone: string;
  countryCode: string | null;
  status: MessageStatus;
  sentAt: string | null;
  deliveredAt: string | null;
  readAt: string | null;
  failedAt: string | null;
  errorCode: string | null;
  errorMessage: string | null;
}

export interface Conversation {
  senderNumberId: string;
  contactPhone: string;
  contactName: string | null;
  lastAt: string;
  lastBody: string | null;
  lastDirection: 'IN' | 'OUT';
  inbound: number;
  lastInboundAt: string | null;
  numberLabel: string;
}

export interface ThreadMessage {
  id: string;
  direction: 'IN' | 'OUT';
  body: string | null;
  kind: string;
  status: MessageStatus;
  createdAt: string;
  errorMessage: string | null;
  campaignId: string | null;
  campaignNo: string | null;
  imageUrl: string | null;
  /** Sent by the auto responder. */
  auto: 'normal' | 'optout' | null;
  /** Sent by a bot; ai = the answer was written by AI. */
  bot: boolean;
  ai: boolean;
}

export interface Thread {
  contactPhone: string;
  contactName: string | null;
  canReply: boolean;
  replyWindowEndsAt: string | null;
  messages: ThreadMessage[];
}

/** Uploads one file (multipart). */
export async function uploadFile<T>(path: string, file: File): Promise<T> {
  const form = new FormData();
  form.append('file', file);
  const token = tokenStore.get();
  const res = await fetch(API_URL + path, {
    method: 'POST',
    headers: token ? { authorization: `Bearer ${token}` } : {},
    body: form,
  }).catch(() => {
    throw new ApiError('Cannot reach the server. Check your internet connection.', 0);
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError((Array.isArray(data?.message) ? data.message[0] : data?.message) || 'Upload failed', res.status);
  return data as T;
}

// ---------------------------------------------------------------- branded (Phase 5)

export type BrandStatus = 'SUBMITTED' | 'APPROVED' | 'REJECTED';

export interface BrandForm {
  accountId?: string;
  organizationName: string;
  displayName: string;
  category: string;
  description?: string;
  website?: string;
  email: string;
  phoneNumber: string;
  address: string;
  taxId?: string;
  contactName: string;
  logoMediaId?: string;
}

export interface Brand extends Required<Omit<BrandForm, 'accountId' | 'logoMediaId'>> {
  id: string;
  accountId: string;
  accountUsername: string;
  accountName: string;
  logoMediaId: string | null;
  logoUrl: string | null;
  status: BrandStatus;
  reviewNote: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  senderNumberId: string | null;
  number: { phoneNumber: string; label: string; status: string } | null;
  createdAt: string;
  updatedAt: string;
}

export interface ApprovedBrand {
  id: string;
  displayName: string;
  organizationName: string;
  phoneNumber: string;
  numberStatus: string;
  logoUrl: string | null;
}

export interface AutoResponder {
  id: string;
  name: string;
  normalMessage: string | null;
  optOutMessage: string | null;
  isActive: boolean;
  updatedAt: string;
}

export interface AutoResponderRow {
  senderNumberId: string;
  service: Service;
  phoneNumber: string;
  label: string;
  brandName: string | null;
  accountUsername: string | null;
  responder: AutoResponder | null;
}

export interface OptOut {
  id: string;
  contactPhone: string;
  contactName: string | null;
  mode: 'AUTO' | 'MANUAL';
  remarks: string | null;
  createdAt: string;
  numberLabel: string;
  numberPhone: string;
  service: Service;
  brandName: string | null;
  accountUsername: string | null;
}

export interface OptOutNumber {
  id: string;
  service: Service;
  label: string;
  phoneNumber: string;
  brandName: string | null;
}

// ---------------------------------------------------------------- Bot Studio (Phase 6)

export type BotNodeType = 'MESSAGE' | 'BUTTONS' | 'LIST' | 'QUESTION' | 'HANDOFF';

export interface BotOption {
  id: string;
  title: string;
  description?: string;
  next?: string;
}

export interface BotNode {
  id: string;
  type: BotNodeType;
  name: string;
  text: string;
  imageUrl?: string;
  options?: BotOption[];
  listButton?: string;
  variable?: string;
  validation?: 'TEXT' | 'NUMBER' | 'EMAIL' | 'PHONE';
  next?: string;
}

export interface BotTrigger {
  id: string;
  keywords: string[];
  match: 'EXACT' | 'CONTAINS';
  startNodeId: string;
}

export interface BotFlow {
  nodes: BotNode[];
  triggers: BotTrigger[];
  fallback: { mode: 'START' | 'MESSAGE' | 'AI' | 'NONE'; startNodeId?: string; text?: string };
  ai: { knowledge: string; noAnswerText?: string };
}

export interface Bot {
  id: string;
  accountId: string;
  name: string;
  senderNumberId: string | null;
  isActive: boolean;
  flow: BotFlow;
  updatedAt: string;
  problems: string[];
}

export interface BotListItem {
  id: string;
  name: string;
  isActive: boolean;
  accountUsername: string;
  senderNumberId: string | null;
  numberPhone: string | null;
  numberLabel: string | null;
  updatedAt: string;
  chats: number;
  chatsToday: number;
  handoffs: number;
  steps: number;
  keywords: string[];
  usesAi: boolean;
}

export interface BotNumber {
  id: string;
  service: Service;
  label: string;
  phoneNumber: string;
  brandName: string | null;
  botId: string | null;
  botName: string | null;
}

export interface BotSettings {
  aiAvailable: boolean;
  aiDailyLimit: number;
  idleMinutes: number;
  handoffHours: number;
  limits: Record<string, number>;
}

export interface BotState {
  status: 'ACTIVE' | 'COMPLETED' | 'HANDOFF';
  nodeId: string | null;
  vars: Record<string, string>;
}

export type RichMessage =
  | { kind: 'buttons'; body: string; imageUrl?: string; buttons: { id: string; title: string }[] }
  | { kind: 'list'; body: string; button: string; rows: { id: string; title: string; description?: string }[] }
  | { kind: 'image'; imageUrl: string; caption?: string };

export type SimMessage = { kind: 'text'; text: string; ai?: boolean } | { kind: 'rich'; rich: RichMessage };

export interface BotSession {
  id: string;
  contactPhone: string;
  contactName: string | null;
  status: 'ACTIVE' | 'COMPLETED' | 'HANDOFF' | 'ENDED';
  nodeId: string | null;
  variables: Record<string, string>;
  startedAt: string;
  lastActivityAt: string;
  handoffUntil: string | null;
  senderNumberId: string;
}

// ---------------------------------------------------------------- dashboard and notifications (Phase 7)

export interface DashboardData {
  range: { from: string; to: string; days: number; unit: 'day' | 'week' | 'month'; timezone: string };
  tiles: {
    balance: { PREMIUM: number; BRANDED: number } | null;
    resellers: number;
    customers: number;
    campaigns: number;
    messages: number;
    creditsUsed: number;
    deliveryRate: number | null;
    readRate: number | null;
    replies: number;
    botChats: number;
    waitingForTeam: number;
  };
  creditActivity: { date: string; received: number; given: number; created: number; removed: number; used: number }[];
  campaignVolume: { date: string; premiumCampaigns: number; brandedCampaigns: number; premiumMessages: number; brandedMessages: number }[];
  campaignStatus: Partial<Record<CampaignStatus, number>>;
  accountGrowth: { date: string; resellers: number; customers: number }[];
  byService: { service: Service; campaigns: number; messages: number; credits: number }[];
  delivery: { read: number; delivered: number; sent: number; waiting: number; failed: number; cancelled: number };
}

export interface AppNotification {
  id: string;
  type: string;
  level: 'INFO' | 'SUCCESS' | 'WARNING' | 'ERROR';
  title: string;
  body: string | null;
  link: string | null;
  readAt: string | null;
  createdAt: string;
}
