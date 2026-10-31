/**
 * Chart colours. Categorical order validated with the dataviz palette checker against the white
 * card surface (all pairs pass CVD and normal-vision floors). Slot 2 is under 3:1 contrast, so
 * every chart ships a legend, tooltips and a table view.
 */
export const series = ['#0b8a68', '#d98e1f', '#2a78d6'] as const;

/** Delivery outcome: one green ramp for how far a message got, status red for failed. */
export const outcome = {
  read: '#0b6b52',
  delivered: '#2fa383',
  sent: '#8fd3bd',
  waiting: '#c3c2b7',
  failed: '#d03b3b',
  cancelled: '#e1e0d9',
};

export const ink = {
  primary: '#18211F',
  secondary: '#5E6B68',
  muted: '#7d8885',
  grid: '#e7ecea',
  axis: '#c9d1ce',
  surface: '#FFFFFF',
};

const compactFmt = new Intl.NumberFormat('en-IN', { notation: 'compact', maximumFractionDigits: 1 });
const fullFmt = new Intl.NumberFormat('en-IN');

/** Axis numbers: in full under 10,000, compact above. */
export const tick = (v: number, max: number) => (max >= 10_000 ? compactFmt.format(v) : fullFmt.format(v));
export const full = (v: number) => fullFmt.format(v);

/** 0 and up to 4 more clean steps covering max. */
export function niceTicks(max: number): number[] {
  if (max <= 0) return [0, 1];
  const rough = max / 4;
  const pow = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * pow).find((s) => s >= rough) ?? 10 * pow;
  const top = Math.ceil(max / step) * step;
  const out: number[] = [];
  for (let v = 0; v <= top + step / 2; v += step) out.push(Math.round(v * 100) / 100);
  return out;
}

const dayFmt = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const monthFmt = new Intl.DateTimeFormat('en-IN', { month: 'short', year: '2-digit', timeZone: 'UTC' });

/** Label for a bucket date (YYYY-MM-DD) at day / week / month size. */
export function periodLabel(date: string, unit: 'day' | 'week' | 'month', long = false) {
  const d = new Date(`${date}T00:00:00Z`);
  if (unit === 'month') return monthFmt.format(d);
  if (unit === 'week') return long ? `Week of ${dayFmt.format(d)}` : dayFmt.format(d);
  return dayFmt.format(d);
}
