'use client';
import { Box, Typography } from '@mui/material';
import { KeyboardEvent, useMemo, useState } from 'react';
import { full, ink, niceTicks, periodLabel, tick } from './tokens';
import { useWidth } from './useWidth';

export interface TimeSeries {
  key: string;
  label: string;
  color: string;
}

type Row = { date: string } & Record<string, number | string>;

const HEIGHT = 220;
const PAD = { top: 12, right: 12, bottom: 26, left: 44 };

/**
 * Values over time: stacked columns (kind="columns") or lines (kind="lines"). One shared y-axis
 * from zero, hairline grid, hover or arrow keys to read every series at a date.
 */
export default function TimeChart({
  rows,
  series,
  unit,
  kind,
  label,
}: {
  rows: Row[];
  series: TimeSeries[];
  unit: 'day' | 'week' | 'month';
  kind: 'columns' | 'lines';
  /** What the chart shows, for screen readers. */
  label: string;
}) {
  const { ref, width } = useWidth<HTMLDivElement>();
  const [active, setActive] = useState<number | null>(null);

  const w = width - PAD.left - PAD.right;
  const h = HEIGHT - PAD.top - PAD.bottom;
  const n = Math.max(1, rows.length);
  const band = w / n;

  const max = useMemo(() => {
    const vals = rows.map((r) =>
      kind === 'columns' ? series.reduce((a, s) => a + Number(r[s.key] ?? 0), 0) : Math.max(0, ...series.map((s) => Number(r[s.key] ?? 0))),
    );
    return Math.max(0, ...vals);
  }, [rows, series, kind]);
  const ticks = niceTicks(max);
  const top = ticks[ticks.length - 1] || 1;
  const y = (v: number) => PAD.top + h - (v / top) * h;
  const cx = (i: number) => PAD.left + band * i + band / 2;

  // Only as many date labels as fit
  const every = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(w / 56))));
  const barW = Math.max(2, Math.min(24, band - 2));
  const total = rows.reduce((a, r) => a + series.reduce((b, s) => b + Number(r[s.key] ?? 0), 0), 0);

  function onKey(e: KeyboardEvent) {
    if (e.key === 'ArrowRight') setActive((a) => Math.min(n - 1, (a ?? -1) + 1));
    else if (e.key === 'ArrowLeft') setActive((a) => Math.max(0, (a ?? n) - 1));
    else if (e.key === 'Escape') setActive(null);
    else return;
    e.preventDefault();
  }

  const r = active !== null ? rows[active] : null;
  const tipLeft = active !== null ? cx(active) : 0;

  return (
    <Box ref={ref} sx={{ position: 'relative', width: '100%' }}>
      {total === 0 && (
        <Typography variant="body2" color="text.secondary" sx={{ position: 'absolute', inset: `${PAD.top}px ${PAD.right}px ${PAD.bottom}px ${PAD.left}px`, display: 'grid', placeItems: 'center' }}>
          Nothing in this period
        </Typography>
      )}
      <svg
        width={width}
        height={HEIGHT}
        role="img"
        aria-label={`${label}. Use the arrow keys to read each ${unit}.`}
        tabIndex={0}
        onKeyDown={onKey}
        onBlur={() => setActive(null)}
        onPointerLeave={() => setActive(null)}
        onPointerMove={(e) => {
          const box = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
          const i = Math.floor((e.clientX - box.left - PAD.left) / band);
          setActive(i >= 0 && i < n ? i : null);
        }}
        style={{ display: 'block', outline: 'none' }}
      >
        {ticks.map((t) => (
          <g key={t}>
            <line x1={PAD.left} x2={PAD.left + w} y1={y(t)} y2={y(t)} stroke={t === 0 ? ink.axis : ink.grid} strokeWidth={1} />
            <text x={PAD.left - 8} y={y(t)} dy="0.32em" textAnchor="end" fontSize={11} fill={ink.muted} style={{ fontVariantNumeric: 'tabular-nums' }}>
              {tick(t, top)}
            </text>
          </g>
        ))}
        {rows.map((row, i) =>
          i % every === 0 ? (
            <text key={row.date} x={cx(i)} y={HEIGHT - 8} textAnchor="middle" fontSize={11} fill={ink.muted}>
              {periodLabel(row.date, unit)}
            </text>
          ) : null,
        )}

        {active !== null && kind === 'lines' && <line x1={cx(active)} x2={cx(active)} y1={PAD.top} y2={PAD.top + h} stroke={ink.axis} strokeWidth={1} />}
        {active !== null && kind === 'columns' && (
          <rect x={PAD.left + band * active} y={PAD.top} width={band} height={h} fill="#000" opacity={0.035} />
        )}

        {kind === 'columns' &&
          rows.map((row, i) => {
            let base = 0;
            const parts = series
              .map((s) => ({ s, v: Number(row[s.key] ?? 0) }))
              .filter((p) => p.v > 0);
            return parts.map((p, j) => {
              const y0 = y(base);
              base += p.v;
              const y1 = y(base);
              // 2px surface gap between stacked parts; only the top part gets the 4px rounded end
              const gap = j > 0 ? 2 : 0;
              const height = Math.max(0, y0 - y1 - gap);
              const isTop = j === parts.length - 1;
              const x = cx(i) - barW / 2;
              const rad = isTop ? Math.min(4, height, barW / 2) : 0;
              const d = `M${x},${y1 + height}V${y1 + rad}${rad ? `Q${x},${y1} ${x + rad},${y1}` : ''}H${x + barW - rad}${rad ? `Q${x + barW},${y1} ${x + barW},${y1 + rad}` : ''}V${y1 + height}Z`;
              return <path key={`${row.date}-${p.s.key}`} d={d} fill={p.s.color} />;
            });
          })}

        {kind === 'lines' &&
          series.map((s) => {
            const pts = rows.map((row, i) => `${cx(i)},${y(Number(row[s.key] ?? 0))}`);
            const last = rows.length - 1;
            return (
              <g key={s.key}>
                <polyline points={pts.join(' ')} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
                {last >= 0 && <circle cx={cx(last)} cy={y(Number(rows[last][s.key] ?? 0))} r={4} fill={s.color} stroke={ink.surface} strokeWidth={2} />}
                {active !== null && <circle cx={cx(active)} cy={y(Number(rows[active][s.key] ?? 0))} r={4.5} fill={s.color} stroke={ink.surface} strokeWidth={2} />}
              </g>
            );
          })}
      </svg>

      {r && (
        <Box
          role="status"
          sx={{
            position: 'absolute',
            top: 4,
            left: Math.min(Math.max(tipLeft + 12, 0), width - 190),
            ...(tipLeft + 200 > width ? { left: Math.max(0, tipLeft - 192) } : {}),
            width: 180,
            bgcolor: 'background.paper',
            border: 1,
            borderColor: 'divider',
            borderRadius: 2,
            boxShadow: '0 4px 14px rgba(0,0,0,.08)',
            p: 1.25,
            pointerEvents: 'none',
          }}
        >
          <Typography sx={{ fontSize: '0.75rem', color: ink.secondary, mb: 0.5 }}>{periodLabel(r.date, unit, true)}</Typography>
          {series.map((s) => (
            <Box key={s.key} sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 0.25 }}>
              <Box aria-hidden sx={{ width: 12, height: 2, borderRadius: 1, bgcolor: s.color, flexShrink: 0 }} />
              <Typography sx={{ fontSize: '0.875rem', fontWeight: 650, color: ink.primary, minWidth: 44 }}>{full(Number(r[s.key] ?? 0))}</Typography>
              <Typography sx={{ fontSize: '0.75rem', color: ink.secondary }} noWrap>
                {s.label}
              </Typography>
            </Box>
          ))}
        </Box>
      )}
    </Box>
  );
}
