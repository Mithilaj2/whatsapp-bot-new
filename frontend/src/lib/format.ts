const dateFmt = new Intl.DateTimeFormat('en-IN', {
  day: '2-digit',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

export const formatDate = (iso: string) => dateFmt.format(new Date(iso));

export const typeLabel = { ADMIN: 'Admin', RESELLER: 'Reseller', CUSTOMER: 'Customer' } as const;
