'use client';
import Add from '@mui/icons-material/Add';
import {
  Alert,
  Box,
  Button,
  MenuItem,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TablePagination,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import Progress from '@/components/campaigns/Progress';
import PageHeader from '@/components/PageHeader';
import SearchField from '@/components/SearchField';
import { CampaignStatusChip } from '@/components/StatusChip';
import { api, CampaignListItem, Page } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatDate, formatDuration, formatNumber } from '@/lib/format';

export default function ReportsPage() {
  const { me } = useAuth();
  const [status, setStatus] = useState('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(0);
  const [data, setData] = useState<Page<CampaignListItem> | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    api<Page<CampaignListItem>>('/campaigns', { query: { service: 'PREMIUM', status, search: query, page: page + 1, pageSize: 25 } })
      .then(setData)
      .catch((e) => setError(e.message));
  }, [status, query, page]);
  useEffect(load, [load]);

  // Keep numbers moving while anything is still going
  const active = data?.items.some((c) => c.status === 'SENDING' || c.status === 'PENDING_APPROVAL');
  useEffect(() => {
    if (!active) return;
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, [active, load]);

  const onSearch = useCallback((v: string) => {
    setQuery(v);
    setPage(0);
  }, []);
  const showAccount = me?.account.type !== 'CUSTOMER';

  return (
    <>
      <PageHeader
        title="Premium campaign reports"
        description="Every campaign, with live delivery. Open one for the full report and to download it."
        actions={
          <Button component={Link} href="/campaigns/premium/new" variant="contained" startIcon={<Add />}>
            New campaign
          </Button>
        }
      />
      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
      <Paper variant="outlined">
        <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 2, px: 2, py: 0.5, borderBottom: 1, borderColor: 'divider' }}>
          <TextField
            select
            label="Status"
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setPage(0);
            }}
            sx={{ minWidth: 200, my: 1 }}
          >
            <MenuItem value="">All</MenuItem>
            <MenuItem value="PENDING_APPROVAL">Waiting for approval</MenuItem>
            <MenuItem value="SENDING">Sending</MenuItem>
            <MenuItem value="COMPLETED">Completed</MenuItem>
            <MenuItem value="CANCELLED">Stopped</MenuItem>
            <MenuItem value="REJECTED">Not approved</MenuItem>
          </TextField>
          <Box sx={{ flex: 1 }} />
          <SearchField placeholder="Campaign number, title or account" label="Search campaigns" onSearch={onSearch} width={300} />
        </Box>
        <TableContainer>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>Campaign</TableCell>
                {showAccount && <TableCell>Account</TableCell>}
                <TableCell>Status</TableCell>
                <TableCell>Progress</TableCell>
                <TableCell align="right">Read</TableCell>
                <TableCell align="right">Replies</TableCell>
                <TableCell align="right">Credits</TableCell>
                <TableCell>Submitted</TableCell>
                <TableCell>Run time</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {data?.items.map((c) => (
                <TableRow key={c.id} hover>
                  <TableCell sx={{ maxWidth: 260 }}>
                    <Typography
                      component={Link}
                      href={`/campaigns/premium/reports/${c.id}`}
                      sx={{ fontWeight: 650, color: 'primary.main', textDecoration: 'none', '&:hover': { textDecoration: 'underline' } }}
                    >
                      {c.campaignNo}
                    </Typography>
                    <Typography variant="body2" color="text.secondary" noWrap title={c.title}>
                      {c.title}
                      {c.isDemo ? ' (demo)' : ''}
                    </Typography>
                  </TableCell>
                  {showAccount && <TableCell>{c.accountUsername}</TableCell>}
                  <TableCell>
                    <CampaignStatusChip status={c.status} />
                  </TableCell>
                  <TableCell>
                    <Progress stats={c.stats} recipients={c.recipients} compact />
                  </TableCell>
                  <TableCell align="right">{formatNumber(c.stats?.read ?? 0)}</TableCell>
                  <TableCell align="right">{formatNumber(c.stats?.replies ?? 0)}</TableCell>
                  <TableCell align="right">
                    {formatNumber(c.creditsCharged - c.creditsRefunded)}
                    {c.creditsRefunded > 0 && (
                      <Typography variant="body2" color="text.secondary">
                        {formatNumber(c.creditsRefunded)} refunded
                      </Typography>
                    )}
                  </TableCell>
                  <TableCell sx={{ whiteSpace: 'nowrap' }}>{formatDate(c.submittedAt)}</TableCell>
                  <TableCell sx={{ whiteSpace: 'nowrap' }}>{formatDuration(c.startedAt, c.completedAt)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
        {data && data.items.length === 0 && (
          <Box sx={{ py: 6, textAlign: 'center' }}>
            <Typography variant="h3">{query || status ? 'No campaigns match' : 'No campaigns yet'}</Typography>
            <Typography color="text.secondary" sx={{ mt: 0.5 }}>
              {query || status ? 'Try another search or status.' : 'Start with a demo to up to 10 numbers.'}
            </Typography>
          </Box>
        )}
        <TablePagination component="div" count={data?.total ?? 0} page={page} onPageChange={(_, p) => setPage(p)} rowsPerPage={25} rowsPerPageOptions={[25]} />
      </Paper>
    </>
  );
}
