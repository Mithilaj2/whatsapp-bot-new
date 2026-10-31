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
