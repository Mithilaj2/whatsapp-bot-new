const dateFmt = new Intl.DateTimeFormat('en-IN', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

export const formatDate = (iso: string) => dateFmt.format(new Date(iso));

export const typeLabel = { ADMIN: 'Admin', RESELLER: 'Reseller', CUSTOMER: 'Customer' } as const;

export const serviceLabel = { PREMIUM: 'Premium Campaigns', BRANDED: 'Branded Campaigns' } as const;

export const txnTypeLabel = {
  CREDIT: 'Added',
  DEBIT: 'Removed',
  TRANSFER_IN: 'Transfer in',
  TRANSFER_OUT: 'Transfer out',
  SPENT: 'Spent',
  REFUND: 'Refund',
} as const;

const num = new Intl.NumberFormat('en-IN');
/** Indian digit grouping: 1,00,000 */
export const formatNumber = (n: number) => num.format(n);

export const messageStatusLabel = {
  QUEUED: 'Waiting',
  SENDING: 'Sending',
  SENT: 'Sent',
  DELIVERED: 'Delivered',
  READ: 'Read',
  FAILED: 'Failed',
  RECEIVED: 'Received',
  CANCELLED: 'Cancelled',
} as const;

export const templateStatusLabel = {
  DRAFT: 'Draft',
  PENDING: 'In review',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  PAUSED: 'Paused',
  DISABLED: 'Disabled',
} as const;

/** 919845662183 -> +91 98456 62183 (rough grouping for display only) */
export const formatPhone = (digits: string) =>
  digits.startsWith('91') && digits.length === 12
    ? `+91 ${digits.slice(2, 7)} ${digits.slice(7)}`
    : `+${digits}`;

export const campaignStatusLabel = {
  PENDING_APPROVAL: 'Waiting for approval',
  SENDING: 'Sending',
  COMPLETED: 'Completed',
  CANCELLED: 'Stopped',
  REJECTED: 'Not approved',
} as const;

/** "2 min 5 s" between two times. */
export function formatDuration(from?: string | null, to?: string | null) {
  if (!from || !to) return '—';
  const s = Math.max(0, Math.round((new Date(to).getTime() - new Date(from).getTime()) / 1000));
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ${s % 60} s`;
  return `${Math.floor(m / 60)} h ${m % 60} min`;
}

export const timeOnly = (iso: string) =>
  new Intl.DateTimeFormat('en-IN', { hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
