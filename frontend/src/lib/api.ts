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
