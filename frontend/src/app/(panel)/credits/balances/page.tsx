'use client';
import FileDownloadOutlined from '@mui/icons-material/FileDownloadOutlined';
import {
  Alert,
  Box,
  Button,
  Paper,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TablePagination,
  TableRow,
  Tabs,
  Typography,
} from '@mui/material';
import { useCallback, useEffect, useState } from 'react';
import PageHeader from '@/components/PageHeader';
import SearchField from '@/components/SearchField';
import { api, Balance, downloadCsv, Page, Service } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatDate, formatNumber, serviceLabel, typeLabel } from '@/lib/format';

export default function BalancesPage() {
  const { me } = useAuth();
  const [svc, setSvc] = useState<Service | 'ALL'>('ALL');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const [data, setData] = useState<Page<Balance> | null>(null);
  const [error, setError] = useState('');
  const [exporting, setExporting] = useState(false);

  const filters = { service: svc === 'ALL' ? undefined : svc, search: query };

  const load = useCallback(() => {
    setError('');
    api<Page<Balance>>('/credits/balances', {
      query: { service: svc === 'ALL' ? undefined : svc, search: query, page: page + 1, pageSize },
    })
      .then(setData)
      .catch((e) => setError(e.message));
  }, [svc, query, page, pageSize]);
  useEffect(load, [load]);

  const onSearch = useCallback((v: string) => {
    setQuery(v);
    setPage(0);
  }, []);

  async function exportCsv() {
    setExporting(true);
    try {
      await downloadCsv('/credits/balances/export', filters, `balances-${new Date().toISOString().slice(0, 10)}.csv`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setExporting(false);
    }
  }

  const isCustomer = me?.account.type === 'CUSTOMER';

  return (
    <>
      <PageHeader
        title="Balances"
        description={
          isCustomer
            ? 'Credits you have left. One credit sends one message.'
            : 'Credits held by you and every account under you. One credit sends one message.'
        }
        actions={
          <Button variant="outlined" startIcon={<FileDownloadOutlined />} onClick={exportCsv} disabled={exporting}>
            Export
          </Button>
        }
      />
      <Paper variant="outlined">
        <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 2, px: 2, borderBottom: 1, borderColor: 'divider' }}>
          <Tabs
            value={svc}
            onChange={(_, v) => {
              setSvc(v);
              setPage(0);
            }}
            sx={{ flex: '1 1 auto' }}
            variant="scrollable"
          >
            <Tab value="ALL" label="All" />
            <Tab value="PREMIUM" label="Premium Campaigns" />
            <Tab value="BRANDED" label="Branded Campaigns" />
          </Tabs>
          <SearchField placeholder="Search account or country" label="Search balances" onSearch={onSearch} width={280} />
        </Box>

        {error && <Alert severity="error" sx={{ m: 2 }}>{error}</Alert>}

        <TableContainer>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>Account</TableCell>
                <TableCell>Service</TableCell>
                <TableCell>Country</TableCell>
                <TableCell align="right">Balance</TableCell>
                <TableCell>Last changed</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {data?.items.map((b) => (
                <TableRow key={`${b.accountId}-${b.service}-${b.countryCode}`} hover>
                  <TableCell>
                    <Typography sx={{ fontWeight: 600 }}>
                      {b.accountId === me?.account.id ? `${b.accountName} (you)` : b.accountName}
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      {b.username}, {typeLabel[b.accountType].toLowerCase()}
                    </Typography>
                  </TableCell>
                  <TableCell>{serviceLabel[b.service]}</TableCell>
                  <TableCell>{b.countryName}</TableCell>
                  <TableCell align="right" sx={{ fontWeight: 650, fontSize: '1rem' }}>
                    {formatNumber(b.balance)}
                  </TableCell>
                  <TableCell sx={{ whiteSpace: 'nowrap' }}>{formatDate(b.updatedAt)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>

        {data && data.items.length === 0 && (
          <Box sx={{ py: 6, px: 3, textAlign: 'center' }}>
            <Typography variant="h3">{query ? `Nothing matches "${query}"` : 'No credits yet'}</Typography>
            <Typography color="text.secondary" sx={{ mt: 0.5 }}>
              {query
                ? 'Try an account name, username or country.'
                : isCustomer
                  ? 'Ask your provider to add credits to your account.'
                  : 'Balances appear here once credits are added in Transactions.'}
            </Typography>
          </Box>
        )}

        <TablePagination
          component="div"
          count={data?.total ?? 0}
          page={page}
          onPageChange={(_, p) => setPage(p)}
          rowsPerPage={pageSize}
          onRowsPerPageChange={(e) => {
            setPageSize(Number(e.target.value));
            setPage(0);
          }}
          rowsPerPageOptions={[25, 50, 100]}
        />
      </Paper>
    </>
  );
}
