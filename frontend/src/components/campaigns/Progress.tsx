import { Box, Typography } from '@mui/material';
import type { CampaignStats } from '@/lib/api';
import { formatNumber } from '@/lib/format';
import { brand } from '@/lib/theme';

/** One bar: read, delivered, sent, failed, waiting — left to right. */
export default function Progress({ stats, recipients, compact }: { stats: CampaignStats | null; recipients: number; compact?: boolean }) {
  const s = stats ?? { queued: recipients, sent: 0, delivered: 0, read: 0, failed: 0, cancelled: 0, replies: 0 };
  const total = Math.max(1, recipients);
  const parts = [
    { n: s.read, color: brand.pine, label: 'Read' },
    { n: s.delivered - s.read, color: brand.action, label: 'Delivered' },
    { n: s.sent - s.delivered, color: '#7FB7A6', label: 'Sent' },
    { n: s.failed, color: brand.danger, label: 'Failed' },
    { n: s.cancelled, color: '#B9C3C0', label: 'Stopped' },
  ];
  const done = s.sent + s.failed + s.cancelled;

  return (
    <Box sx={{ minWidth: compact ? 140 : undefined }}>
      <Box
        role="img"
        aria-label={`${done} of ${recipients} processed: ${parts.map((p) => `${p.n} ${p.label.toLowerCase()}`).join(', ')}`}
        sx={{ display: 'flex', height: compact ? 6 : 10, borderRadius: 99, overflow: 'hidden', bgcolor: brand.surface }}
      >
        {parts.map((p) => (p.n > 0 ? <Box key={p.label} sx={{ width: `${(p.n / total) * 100}%`, bgcolor: p.color }} /> : null))}
      </Box>
      <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, fontVariantNumeric: 'tabular-nums' }}>
        {formatNumber(done)} of {formatNumber(recipients)}
        {compact ? '' : ' processed'}
      </Typography>
      {!compact && (
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2, mt: 1 }}>
          {parts.map((p) => (
            <Box key={p.label} sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
              <Box sx={{ width: 10, height: 10, borderRadius: 99, bgcolor: p.color }} />
              <Typography variant="body2">
                {p.label} {formatNumber(Math.max(0, p.n))}
              </Typography>
            </Box>
          ))}
        </Box>
      )}
    </Box>
  );
}
