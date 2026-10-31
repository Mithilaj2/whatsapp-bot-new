import type { BrandStatus } from '@/lib/api';

export const brandStatus: Record<BrandStatus, { label: string; tone: 'good' | 'wait' | 'bad' }> = {
  SUBMITTED: { label: 'In review', tone: 'wait' },
  APPROVED: { label: 'Live', tone: 'good' },
  REJECTED: { label: 'Sent back', tone: 'bad' },
};
