'use client';
import { Box, Button, Paper, Skeleton, Typography } from '@mui/material';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import PageHeader from '@/components/PageHeader';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { brand } from '@/lib/theme';

export default function DashboardPage() {
  const { me } = useAuth();
  const [stats, setStats] = useState<{ resellers: number; customers: number } | null>(null);
  const [error, setError] = useState('');
  const canManage = me?.account.type !== 'CUSTOMER';

  useEffect(() => {
    api<{ resellers: number; customers: number }>('/accounts/stats')
      .then(setStats)
      .catch((e) => setError(e.message));
  }, []);

  if (!me) return null;
  const firstName = me.name.split(' ')[0];
  const isEmpty = stats && stats.resellers + stats.customers === 0;

  return (
    <>
      <PageHeader title={`Hello, ${firstName}`} description="An overview of your account." />

      {canManage && (
        <Paper
          variant="outlined"
          sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, 1fr)' }, mb: 3 }}
        >
          <Stat label="Resellers under you" value={stats?.resellers} href="/accounts/resellers" />
          <Stat label="Customers under you" value={stats?.customers} href="/accounts/customers" divider />
        </Paper>
      )}
      {error && <Typography color="error">{error}</Typography>}

      {canManage && isEmpty && (
        <Paper variant="outlined" sx={{ p: 3, mb: 3, bgcolor: brand.bubble, borderColor: 'transparent' }}>
          <Typography variant="h3" sx={{ color: brand.pine }}>
            Add your first customer
          </Typography>
          <Typography sx={{ mt: 0.5, mb: 2, color: brand.pine, maxWidth: '60ch' }}>
            Create a login for a business you work with. They can start sending campaigns once credits and
            campaigns are switched on.
          </Typography>
          <Button component={Link} href="/accounts?new=1" variant="contained">
            Add customer
          </Button>
        </Paper>
      )}

      <Paper variant="outlined" sx={{ p: 3 }}>
        <Typography variant="h3">Coming next</Typography>
        <Typography color="text.secondary" sx={{ mt: 0.5, maxWidth: '65ch' }}>
          Credits, campaigns, reports and the inbox are being built. They will appear in the menu as each one
          goes live, and their charts will show up here.
        </Typography>
      </Paper>
    </>
  );
}

function Stat({ label, value, href, divider }: { label: string; value?: number; href: string; divider?: boolean }) {
  return (
    <Box
      component={Link}
      href={href}
      sx={{
        p: 3,
        color: 'inherit',
        textDecoration: 'none',
        borderLeft: { sm: divider ? 1 : 0 },
        borderTop: { xs: divider ? 1 : 0, sm: 0 },
        borderColor: 'divider',
        '&:hover': { bgcolor: 'background.default' },
        '&:focus-visible': { outline: `2px solid ${brand.action}`, outlineOffset: -2 },
      }}
    >
      <Typography sx={{ fontSize: '2.25rem', fontWeight: 650, lineHeight: 1.1, fontVariantNumeric: 'tabular-nums' }}>
        {value === undefined ? <Skeleton width={48} /> : value.toLocaleString('en-IN')}
      </Typography>
      <Typography color="text.secondary" sx={{ mt: 0.5 }}>
        {label}
      </Typography>
    </Box>
  );
}
