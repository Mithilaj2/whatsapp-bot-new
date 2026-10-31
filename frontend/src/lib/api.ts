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
export type MessageStatus = 'QUEUED' | 'SENDING' | 'SENT' | 'DELIVERED' | 'READ' | 'FAILED' | 'RECEIVED';

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
