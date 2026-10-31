'use client';
import { Box, Button, Paper, Skeleton, Typography } from '@mui/material';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import PageHeader from '@/components/PageHeader';
import { api, CreditSummary } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatNumber } from '@/lib/format';
import { brand } from '@/lib/theme';

interface Tile {
  label: string;
  value?: number;
  href: string;
}

export default function DashboardPage() {
  const { me } = useAuth();
  const [stats, setStats] = useState<{ resellers: number; customers: number } | null>(null);
  const [credits, setCredits] = useState<CreditSummary | null>(null);
  const [error, setError] = useState('');

  const type = me?.account.type;
  const canManage = type !== 'CUSTOMER';
  // The platform admin creates credits, so it has no balance of its own
  const hasBalance = type !== 'ADMIN';

  useEffect(() => {
    if (!type) return;
    if (type !== 'CUSTOMER') {
      api<{ resellers: number; customers: number }>('/accounts/stats')
        .then(setStats)
        .catch((e) => setError(e.message));
    }
    if (type !== 'ADMIN') {
      api<CreditSummary>('/credits/summary')
        .then(setCredits)
        .catch((e) => setError(e.message));
    }
  }, [type]);

  if (!me) return null;
  const firstName = me.name.split(' ')[0];
  const noAccounts = stats && stats.resellers + stats.customers === 0;

  const tiles: Tile[] = [
    ...(hasBalance
      ? [
          { label: 'Premium Campaigns credits', value: credits?.totals.PREMIUM, href: '/credits/balances' },
          { label: 'Branded Campaigns credits', value: credits?.totals.BRANDED, href: '/credits/balances' },
        ]
      : []),
    ...(canManage
      ? [
          { label: 'Resellers under you', value: stats?.resellers, href: '/accounts/resellers' },
          { label: 'Customers under you', value: stats?.customers, href: '/accounts/customers' },
        ]
      : []),
  ];

  return (
    <>
      <PageHeader title={`Hello, ${firstName}`} description="An overview of your account." />

      <Paper
        variant="outlined"
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)', lg: `repeat(${tiles.length}, 1fr)` },
          mb: 3,
          overflow: 'hidden',
        }}
      >
        {tiles.map((t) => (
          <Stat key={t.label} {...t} />
        ))}
      </Paper>
      {error && <Typography color="error" sx={{ mb: 2 }}>{error}</Typography>}

      {canManage && noAccounts && (
        <Paper variant="outlined" sx={{ p: 3, mb: 3, bgcolor: brand.bubble, borderColor: 'transparent' }}>
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

      {hasBalance && credits && credits.byCountry.length > 1 && (
        <Paper variant="outlined" sx={{ p: 3, mb: 3 }}>
          <Typography variant="h3" sx={{ mb: 1.5 }}>
            Credits by country
          </Typography>
          {credits.byCountry.map((b) => (
            <Box
              key={`${b.service}-${b.countryCode}`}
              sx={{ display: 'flex', justifyContent: 'space-between', py: 0.75, borderTop: 1, borderColor: 'divider' }}
            >
              <Typography>
                {b.countryName}, {b.service === 'PREMIUM' ? 'Premium' : 'Branded'}
              </Typography>
              <Typography sx={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{formatNumber(b.balance)}</Typography>
            </Box>
          ))}
        </Paper>
      )}

      <Paper variant="outlined" sx={{ p: 3 }}>
        <Typography variant="h3">Coming next</Typography>
        <Typography color="text.secondary" sx={{ mt: 0.5, maxWidth: '65ch' }}>
          Campaigns, reports and the inbox are being built. They will appear in the menu as each one goes
          live, and their charts will show up here.
        </Typography>
      </Paper>
    </>
  );
}

function Stat({ label, value, href }: Tile) {
  return (
    <Box
      component={Link}
      href={href}
      sx={{
        p: 3,
        color: 'inherit',
        textDecoration: 'none',
        // Hairline between tiles in every layout: the grid gap shows the border colour through
        boxShadow: (t) => `-1px -1px 0 ${t.palette.divider}`,
        '&:hover': { bgcolor: 'background.default' },
        '&:focus-visible': { outline: `2px solid ${brand.action}`, outlineOffset: -2 },
      }}
    >
      <Typography sx={{ fontSize: '2.25rem', fontWeight: 650, lineHeight: 1.1, fontVariantNumeric: 'tabular-nums' }}>
        {value === undefined ? <Skeleton width={64} /> : formatNumber(value)}
      </Typography>
      <Typography color="text.secondary" sx={{ mt: 0.5 }}>
        {label}
      </Typography>
    </Box>
  );
}
