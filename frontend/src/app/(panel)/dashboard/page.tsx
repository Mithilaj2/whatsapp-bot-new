'use client';
import { Alert, Box, Button, MenuItem, Paper, Skeleton, TextField, Typography } from '@mui/material';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import ChartCard from '@/components/charts/ChartCard';
import { BarList, SegmentBar } from '@/components/charts/Parts';
import TimeChart, { TimeSeries } from '@/components/charts/TimeChart';
import { outcome, periodLabel, series as colors } from '@/components/charts/tokens';
import PageHeader from '@/components/PageHeader';
import { api, DashboardData } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { campaignStatusLabel, formatNumber } from '@/lib/format';
import { brand } from '@/lib/theme';

type Preset = '7' | '30' | '90' | 'month' | '365' | 'custom';
const PREF_KEY = 'wb360_dashboard';

const iso = (d: Date) => d.toISOString().slice(0, 10);
/** Today in India, as YYYY-MM-DD. */
const todayIST = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());

function rangeFor(p: Preset, custom: { from: string; to: string }) {
  const to = todayIST();
  const back = (days: number) => iso(new Date(Date.parse(`${to}T00:00:00Z`) - (days - 1) * 86_400_000));
  switch (p) {
    case '7':
      return { from: back(7), to };
    case '90':
      return { from: back(90), to };
    case '365':
      return { from: back(365), to };
    case 'month':
      return { from: `${to.slice(0, 8)}01`, to };
    case 'custom':
      return custom;
    default:
      return { from: back(30), to };
  }
}

const pct = (v: number | null) => (v === null ? '—' : `${Math.round(v * 100)}%`);

export default function DashboardPage() {
  const { me } = useAuth();
  const [preset, setPreset] = useState<Preset>('30');
  const [custom, setCustom] = useState({ from: '', to: '' });
  const [service, setService] = useState('');
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Remember the last filters on this device
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(PREF_KEY) ?? '{}');
      if (saved.preset && saved.preset !== 'custom') setPreset(saved.preset);
      if (saved.service !== undefined) setService(saved.service);
    } catch {
      /* private window: defaults are fine */
    }
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem(PREF_KEY, JSON.stringify({ preset, service }));
    } catch {
      /* ignore */
    }
  }, [preset, service]);

  const range = useMemo(() => rangeFor(preset, custom), [preset, custom]);
  useEffect(() => {
    if (!me || !range.from || !range.to) return;
    setLoading(true);
    setError('');
    api<DashboardData>('/dashboard', { query: { ...range, service } })
      .then(setData)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [me, range, service]);

  if (!me) return null;
  const type = me.account.type;
  const canManage = type !== 'CUSTOMER';
  // People get their first name; the platform account keeps its full name
  const firstName = type === 'ADMIN' ? me.name : me.name.split(' ')[0];
  const t = data?.tiles;
  const unit = data?.range.unit ?? 'day';
  const branded = service === 'BRANDED';
  const premium = service === 'PREMIUM';

  // Credit lines: what matters for this kind of account (at most three)
  const creditSeries: TimeSeries[] =
    type === 'ADMIN'
      ? [
          { key: 'created', label: 'Credits added to accounts', color: colors[0] },
          { key: 'used', label: 'Used on campaigns', color: colors[2] },
        ]
      : type === 'RESELLER'
        ? [
            { key: 'received', label: 'Received', color: colors[0] },
            { key: 'given', label: 'Given to your accounts', color: colors[1] },
            { key: 'used', label: 'Used on campaigns (you and below)', color: colors[2] },
          ]
        : [
            { key: 'received', label: 'Received', color: colors[0] },
            { key: 'used', label: 'Used on campaigns', color: colors[2] },
          ];
  const volumeSeries: TimeSeries[] = [
    ...(branded ? [] : [{ key: 'premiumMessages', label: 'Premium', color: colors[0] }]),
    ...(premium ? [] : [{ key: 'brandedMessages', label: 'Branded', color: colors[1] }]),
  ];
  const growthSeries: TimeSeries[] = [
    ...(type === 'CUSTOMER' ? [] : [{ key: 'customers', label: 'Customers', color: colors[0] }]),
    ...(type === 'CUSTOMER' ? [] : [{ key: 'resellers', label: 'Resellers', color: colors[1] }]),
  ];
  const d = data?.delivery;
  const deliveryParts = d
    ? [
        { label: 'Read', value: d.read, color: outcome.read },
        { label: 'Delivered', value: d.delivered, color: outcome.delivered },
        { label: 'Sent', value: d.sent, color: outcome.sent, onColor: '#0b2a22' },
        { label: 'Waiting', value: d.waiting, color: outcome.waiting, onColor: '#18211F' },
        { label: 'Failed', value: d.failed, color: outcome.failed },
        { label: 'Stopped', value: d.cancelled, color: outcome.cancelled, onColor: '#18211F' },
      ]
    : [];
  const statusItems = (['COMPLETED', 'SENDING', 'PENDING_APPROVAL', 'CANCELLED', 'REJECTED'] as const).map((s) => ({
    label: campaignStatusLabel[s],
    value: data?.campaignStatus[s] ?? 0,
  }));

  const tiles = [
    ...(t?.balance && !branded ? [{ label: 'Premium credits left', value: formatNumber(t.balance.PREMIUM), href: '/credits/balances' }] : []),
    ...(t?.balance && !premium ? [{ label: 'Branded credits left', value: formatNumber(t.balance.BRANDED), href: '/credits/balances' }] : []),
    { label: 'Campaigns', value: t ? formatNumber(t.campaigns) : undefined, href: branded ? '/campaigns/branded/reports' : '/campaigns/premium/reports' },
    { label: 'Messages sent', value: t ? formatNumber(t.messages) : undefined },
    { label: 'Delivered', value: t ? pct(t.deliveryRate) : undefined, note: 'of messages that finished' },
    { label: 'Read', value: t ? pct(t.readRate) : undefined, note: 'of delivered' },
    { label: 'People who replied', value: t ? formatNumber(t.replies) : undefined, href: branded ? '/campaigns/branded/inbox' : '/campaigns/premium/inbox' },
    { label: 'Bot chats', value: t ? formatNumber(t.botChats) : undefined, href: '/bots', note: t?.waitingForTeam ? `${t.waitingForTeam} waiting for your team` : undefined },
    ...(canManage
      ? [
          { label: 'Resellers under you', value: t ? formatNumber(t.resellers) : undefined, href: '/accounts/resellers' },
          { label: 'Customers under you', value: t ? formatNumber(t.customers) : undefined, href: '/accounts/customers' },
        ]
      : []),
  ];
  const noAccounts = canManage && t && t.resellers + t.customers === 0;
  const dates = (rows: { date: string }[]) => rows.map((r) => periodLabel(r.date, unit, true));

  return (
    <>
      <PageHeader title={`Hello, ${firstName}`} description="How your campaigns, credits and bots are doing." />

      {/* Filters: one row, above everything they change */}
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1.5, mb: 2.5, alignItems: 'center' }}>
        <TextField select size="small" label="Period" value={preset} onChange={(e) => {
          const p = e.target.value as Preset;
          if (p === 'custom') setCustom(rangeFor(preset, custom));
          setPreset(p);
        }} sx={{ minWidth: 170 }}>
          <MenuItem value="7">Last 7 days</MenuItem>
          <MenuItem value="30">Last 30 days</MenuItem>
          <MenuItem value="90">Last 90 days</MenuItem>
          <MenuItem value="month">This month</MenuItem>
          <MenuItem value="365">Last 12 months</MenuItem>
          <MenuItem value="custom">Custom dates</MenuItem>
        </TextField>
        {preset === 'custom' && (
          <>
            <TextField size="small" type="date" label="From" value={custom.from} onChange={(e) => setCustom((c) => ({ ...c, from: e.target.value }))} slotProps={{ inputLabel: { shrink: true } }} />
            <TextField size="small" type="date" label="To" value={custom.to} onChange={(e) => setCustom((c) => ({ ...c, to: e.target.value }))} slotProps={{ inputLabel: { shrink: true } }} />
          </>
        )}
        <TextField
          select
          size="small"
          label="Service"
          value={service}
          onChange={(e) => setService(e.target.value)}
          sx={{ minWidth: 190 }}
          slotProps={{ select: { displayEmpty: true }, inputLabel: { shrink: true } }}
        >
          <MenuItem value="">Premium and Branded</MenuItem>
          <MenuItem value="PREMIUM">Premium Campaigns</MenuItem>
          <MenuItem value="BRANDED">Branded Campaigns</MenuItem>
        </TextField>
      </Box>
      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

      {noAccounts && (
        <Paper variant="outlined" sx={{ p: 3, mb: 2.5, bgcolor: brand.bubble, borderColor: 'transparent' }}>
          <Typography variant="h3" sx={{ color: brand.pine }}>
            Add your first customer
          </Typography>
          <Typography sx={{ mt: 0.5, mb: 2, color: brand.pine, maxWidth: '60ch' }}>
            Create a login for a business you work with, then give them credits in Transactions.
          </Typography>
          <Button component={Link} href="/accounts?new=1" variant="contained">
            Add customer
          </Button>
        </Paper>
      )}

      <Paper
        variant="outlined"
        sx={{ display: 'grid', gridTemplateColumns: { xs: 'repeat(2, 1fr)', md: 'repeat(4, 1fr)', xl: `repeat(${Math.min(6, tiles.length)}, 1fr)` }, mb: 2.5, overflow: 'hidden', opacity: loading && data ? 0.55 : 1 }}
      >
        {tiles.map((tile) => (
          <Stat key={tile.label} {...tile} />
        ))}
      </Paper>

      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: 'repeat(2, minmax(0, 1fr))' }, gap: 2.5 }}>
        <ChartCard
          title="Messages sent"
          subtitle={`Campaign messages per ${unit}`}
          legend={volumeSeries.map((s) => ({ label: s.label, color: s.color }))}
          dim={loading}
          table={data ? { columns: ['Period', ...volumeSeries.map((s) => s.label)], rows: data.campaignVolume.map((r, i) => [dates(data.campaignVolume)[i], ...volumeSeries.map((s) => Number(r[s.key as keyof typeof r]))]) } : undefined}
        >
          {data ? <TimeChart kind="columns" rows={data.campaignVolume} series={volumeSeries} unit={unit} label="Campaign messages sent over time" /> : <Skeleton variant="rounded" height={220} />}
        </ChartCard>

        <ChartCard
          title="Credit activity"
          subtitle={type === 'ADMIN' ? 'Credits you added, and credits used on campaigns' : 'Credits in and out of your account'}
          legend={creditSeries.map((s) => ({ label: s.label, color: s.color, kind: 'line' }))}
          dim={loading}
          table={data ? { columns: ['Period', ...creditSeries.map((s) => s.label)], rows: data.creditActivity.map((r, i) => [dates(data.creditActivity)[i], ...creditSeries.map((s) => Number(r[s.key as keyof typeof r]))]) } : undefined}
        >
          {data ? <TimeChart kind="lines" rows={data.creditActivity} series={creditSeries} unit={unit} label="Credit activity over time" /> : <Skeleton variant="rounded" height={220} />}
        </ChartCard>

        <ChartCard
          title="What happened to messages"
          subtitle="Campaign messages sent in this period"
          dim={loading}
          table={d ? { columns: ['Outcome', 'Messages'], rows: deliveryParts.map((p) => [p.label, p.value]) } : undefined}
        >
          {data ? <SegmentBar parts={deliveryParts} label="Message outcomes" /> : <Skeleton variant="rounded" height={80} />}
        </ChartCard>

        <ChartCard
          title="Campaigns by status"
          dim={loading}
          table={data ? { columns: ['Status', 'Campaigns'], rows: statusItems.map((s) => [s.label, s.value]) } : undefined}
        >
          {data ? <BarList items={statusItems} color={colors[0]} label="Campaigns by status" /> : <Skeleton variant="rounded" height={160} />}
        </ChartCard>

        {!service && (
          <ChartCard
            title="Premium and Branded"
            subtitle="Campaigns, messages and credits used in this period"
            dim={loading}
          >
            {data ? (
              <Box component="table" sx={{ width: '100%', borderCollapse: 'collapse', '& th, & td': { py: 1, borderTop: 1, borderColor: 'divider', fontSize: '0.875rem' }, '& td:not(:first-of-type), & th:not(:first-of-type)': { textAlign: 'right', fontVariantNumeric: 'tabular-nums' }, '& th': { color: 'text.secondary', fontWeight: 600 } }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: 'left' }}>Service</th>
                    <th>Campaigns</th>
                    <th>Messages</th>
                    <th>Credits used</th>
                  </tr>
                </thead>
                <tbody>
                  {(['PREMIUM', 'BRANDED'] as const).map((s, i) => {
                    const r = data.byService.find((x) => x.service === s);
                    return (
                      <tr key={s}>
                        <td>
                          <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 1 }}>
                            <Box component="span" aria-hidden sx={{ width: 10, height: 10, borderRadius: '3px', bgcolor: colors[i] }} />
                            {s === 'PREMIUM' ? 'Premium' : 'Branded'}
                          </Box>
                        </td>
                        <td>{formatNumber(r?.campaigns ?? 0)}</td>
                        <td>{formatNumber(r?.messages ?? 0)}</td>
                        <td>{formatNumber(r?.credits ?? 0)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </Box>
            ) : (
              <Skeleton variant="rounded" height={100} />
            )}
          </ChartCard>
        )}

        {canManage && (
          <ChartCard
            title="New accounts"
            subtitle={`Resellers and customers added under you, per ${unit}`}
            legend={growthSeries.map((s) => ({ label: s.label, color: s.color }))}
            dim={loading}
            table={data ? { columns: ['Period', ...growthSeries.map((s) => s.label)], rows: data.accountGrowth.map((r, i) => [dates(data.accountGrowth)[i], ...growthSeries.map((s) => Number(r[s.key as keyof typeof r]))]) } : undefined}
          >
            {data ? <TimeChart kind="columns" rows={data.accountGrowth} series={growthSeries} unit={unit} label="New accounts over time" /> : <Skeleton variant="rounded" height={220} />}
          </ChartCard>
        )}
      </Box>
    </>
  );
}

function Stat({ label, value, href, note }: { label: string; value?: string; href?: string; note?: string }) {
  const inner = (
    <>
      <Typography sx={{ fontSize: '1.75rem', fontWeight: 650, lineHeight: 1.15 }}>{value === undefined ? <Skeleton width={56} /> : value}</Typography>
      <Typography color="text.secondary" sx={{ mt: 0.5, fontSize: '0.875rem' }}>
        {label}
      </Typography>
      {note && (
        <Typography variant="body2" sx={{ color: brand.muted, fontSize: '0.75rem' }}>
          {note}
        </Typography>
      )}
    </>
  );
  const sx = {
    p: 2.25,
    color: 'inherit',
    textDecoration: 'none',
    boxShadow: (th: { palette: { divider: string } }) => `-1px -1px 0 ${th.palette.divider}`,
  } as const;
  return href ? (
    <Box component={Link} href={href} sx={{ ...sx, '&:hover': { bgcolor: 'background.default' }, '&:focus-visible': { outline: `2px solid ${brand.action}`, outlineOffset: -2 } }}>
      {inner}
    </Box>
  ) : (
    <Box sx={sx}>{inner}</Box>
  );
}
