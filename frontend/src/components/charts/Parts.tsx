'use client';
import { Box, Tooltip, Typography } from '@mui/material';
import { full, ink } from './tokens';

export interface Part {
  label: string;
  value: number;
  color: string;
  /** Text colour inside the block. */
  onColor?: string;
}

/** One whole split into parts (tall segmented bar), with the legend under it. */
export function SegmentBar({ parts, label }: { parts: Part[]; label: string }) {
  const total = parts.reduce((a, p) => a + p.value, 0);
  const pct = (v: number) => (total ? Math.round((v / total) * 100) : 0);
  const shown = parts.filter((p) => p.value > 0);
  return (
    <Box>
      {total === 0 ? (
        <Box sx={{ height: 28, borderRadius: 1, bgcolor: ink.grid, display: 'grid', placeItems: 'center' }}>
          <Typography variant="body2" color="text.secondary">
            No messages in this period
          </Typography>
        </Box>
      ) : (
        <Box role="img" aria-label={`${label}: ${shown.map((p) => `${p.label} ${full(p.value)} (${pct(p.value)}%)`).join(', ')}`} sx={{ display: 'flex', gap: '2px', height: 28 }}>
          {shown.map((p) => (
            <Tooltip key={p.label} title={`${p.label}: ${full(p.value)} (${pct(p.value)}%)`}>
              <Box
                tabIndex={0}
                sx={{
                  flex: `${p.value} 0 0`,
                  minWidth: 4,
                  bgcolor: p.color,
                  borderRadius: '4px',
                  color: p.onColor ?? '#fff',
                  fontSize: '0.75rem',
                  fontWeight: 650,
                  display: 'flex',
                  alignItems: 'center',
                  px: 0.75,
                  overflow: 'hidden',
                  outline: 'none',
                  '&:hover, &:focus-visible': { filter: 'brightness(1.08)', boxShadow: `0 0 0 2px ${ink.primary}` },
                }}
              >
                {/* Share only where it fits */}
                {pct(p.value) >= 9 ? `${pct(p.value)}%` : ''}
              </Box>
            </Tooltip>
          ))}
        </Box>
      )}
      <Box component="ul" sx={{ m: 0, mt: 1.5, p: 0, listStyle: 'none', display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))', gap: 1 }}>
        {parts.map((p) => (
          <Box component="li" key={p.label} sx={{ display: 'flex', alignItems: 'baseline', gap: 0.75 }}>
            <Box aria-hidden sx={{ width: 10, height: 10, borderRadius: '3px', bgcolor: p.color, flexShrink: 0, alignSelf: 'center' }} />
            <Typography sx={{ fontWeight: 650, color: ink.primary }}>{full(p.value)}</Typography>
            <Typography variant="body2" color="text.secondary" noWrap>
              {p.label}
            </Typography>
          </Box>
        ))}
      </Box>
    </Box>
  );
}

/** Horizontal bars, one per category, value at the tip. */
export function BarList({ items, color, label }: { items: { label: string; value: number }[]; color: string; label: string }) {
  const max = Math.max(1, ...items.map((i) => i.value));
  if (!items.some((i) => i.value > 0)) {
    return (
      <Typography variant="body2" color="text.secondary" sx={{ py: 3, textAlign: 'center' }}>
        Nothing in this period
      </Typography>
    );
  }
  return (
    <Box component="ul" aria-label={label} sx={{ m: 0, p: 0, listStyle: 'none', display: 'grid', gap: 1.25 }}>
      {items.map((i) => (
        <Box component="li" key={i.label} sx={{ display: 'grid', gridTemplateColumns: 'minmax(110px, 160px) 1fr', alignItems: 'center', gap: 1.5 }}>
          <Typography variant="body2" color="text.secondary" noWrap title={i.label}>
            {i.label}
          </Typography>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 0 }}>
            {i.value > 0 && (
              <Box
                sx={{
                  width: `calc((100% - 56px) * ${i.value / max})`,
                  minWidth: 3,
                  height: 16,
                  bgcolor: color,
                  borderRadius: '0 4px 4px 0',
                }}
              />
            )}
            <Typography sx={{ fontSize: '0.875rem', fontWeight: 650, color: ink.primary, fontVariantNumeric: 'tabular-nums' }}>{full(i.value)}</Typography>
          </Box>
        </Box>
      ))}
    </Box>
  );
}
