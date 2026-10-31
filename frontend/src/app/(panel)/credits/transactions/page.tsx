'use client';
import Add from '@mui/icons-material/Add';
import FileDownloadOutlined from '@mui/icons-material/FileDownloadOutlined';
import {
  Alert,
  Box,
  Button,
  Chip,
  Paper,
  Snackbar,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TablePagination,
  TableRow,
  Tabs,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material';
import { useCallback, useEffect, useState } from 'react';
import TransactionDialog from '@/components/credits/TransactionDialog';
import PageHeader from '@/components/PageHeader';
import SearchField from '@/components/SearchField';
import { api, CreditTxn, downloadCsv, Page, Service } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatDate, formatNumber, serviceLabel, txnTypeLabel } from '@/lib/format';
import { brand } from '@/lib/theme';

type Category = 'all' | 'platform' | 'transfers' | 'campaign';

export default function TransactionsPage() {
  const { me } = useAuth();
  const canTransfer = me?.account.type !== 'CUSTOMER';
  const [svc, setSvc] = useState<Service | 'ALL'>('ALL');
  const [category, setCategory] = useState<Category>('all');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const [data, setData] = useState<Page<CreditTxn> | null>(null);
  const [error, setError] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [toast, setToast] = useState('');

  const filters = {
    service: svc === 'ALL' ? undefined : svc,
    category: category === 'all' ? undefined : category,
    search: query,
  };

  const load = useCallback(() => {
    setError('');
    api<Page<CreditTxn>>('/credits/transactions', {
      query: {
        service: svc === 'ALL' ? undefined : svc,
        category: category === 'all' ? undefined : category,
        search: query,
        page: page + 1,
        pageSize,
      },
    })
      .then(setData)
      .catch((e) => setError(e.message));
  }, [svc, category, query, page, pageSize]);
  useEffect(load, [load]);

  const onSearch = useCallback((v: string) => {
    setQuery(v);
    setPage(0);
  }, []);

  async function exportCsv() {
    try {
      await downloadCsv('/credits/transactions/export', filters, `transactions-${new Date().toISOString().slice(0, 10)}.csv`);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <>
      <PageHeader
        title="Transactions"
        description="Every credit added, transferred, spent or refunded, newest first."
        actions={
          <>
            <Button variant="outlined" startIcon={<FileDownloadOutlined />} onClick={exportCsv}>
              Export
            </Button>
            {canTransfer && (
              <Button variant="contained" startIcon={<Add />} onClick={() => setDialogOpen(true)}>
                New transaction
              </Button>
            )}
          </>
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
          <SearchField placeholder="Search account, campaign or note" label="Search transactions" onSearch={onSearch} width={280} />
        </Box>
        <Box sx={{ px: 2, py: 1.5, borderBottom: 1, borderColor: 'divider' }}>
          <ToggleButtonGroup
            exclusive
            size="small"
            value={category}
            onChange={(_, v) => {
              if (!v) return;
              setCategory(v);
              setPage(0);
            }}
            aria-label="Kind of transaction"
          >
            <ToggleButton value="all">All kinds</ToggleButton>
            <ToggleButton value="platform">Added / removed</ToggleButton>
            <ToggleButton value="transfers">Transfers</ToggleButton>
            <ToggleButton value="campaign">Campaigns</ToggleButton>
          </ToggleButtonGroup>
        </Box>

        {error && <Alert severity="error" sx={{ m: 2 }}>{error}</Alert>}

        <TableContainer>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>Date</TableCell>
                <TableCell>Account</TableCell>
                <TableCell>Type</TableCell>
                <TableCell align="right">Credits</TableCell>
                <TableCell align="right">Balance after</TableCell>
                <TableCell>Country</TableCell>
                <TableCell>From / to</TableCell>
                <TableCell>Details</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {data?.items.map((t) => {
                const plus = t.amount > 0;
                return (
                  <TableRow key={t.id} hover>
                    <TableCell sx={{ whiteSpace: 'nowrap' }}>{formatDate(t.createdAt)}</TableCell>
                    <TableCell>
                      <Typography sx={{ fontWeight: 600 }}>{t.username}</Typography>
                      <Typography variant="body2" color="text.secondary">
                        {serviceLabel[t.service]}
                      </Typography>
                    </TableCell>
                    <TableCell>
                      <Chip
                        size="small"
                        label={txnTypeLabel[t.type]}
                        sx={{ bgcolor: plus ? brand.bubble : 'background.default', color: brand.pine }}
                      />
                    </TableCell>
                    <TableCell
                      align="right"
                      sx={{ fontWeight: 650, color: plus ? 'primary.main' : 'text.primary', whiteSpace: 'nowrap' }}
                    >
                      {plus ? '+' : '−'}
                      {formatNumber(Math.abs(t.amount))}
                    </TableCell>
                    <TableCell align="right" sx={{ color: 'text.secondary' }}>
                      {formatNumber(t.balanceAfter)}
                    </TableCell>
                    <TableCell>{t.countryCode}</TableCell>
                    <TableCell>{t.counterpartyUsername ?? '—'}</TableCell>
                    <TableCell sx={{ maxWidth: 280 }}>
                      {t.campaignNo && (
                        <Typography variant="body2" sx={{ fontWeight: 600 }}>
                          Campaign {t.campaignNo}
                          {t.recipients ? `, ${formatNumber(t.recipients)} recipients` : ''}
                        </Typography>
                      )}
                      <Typography variant="body2" color="text.secondary">
                        {t.remarks || (t.createdBy ? `By ${t.createdBy}` : '—')}
                      </Typography>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </TableContainer>

        {data && data.items.length === 0 && (
          <Box sx={{ py: 6, px: 3, textAlign: 'center' }}>
            <Typography variant="h3">{query ? `Nothing matches "${query}"` : 'No transactions yet'}</Typography>
            <Typography color="text.secondary" sx={{ mt: 0.5 }}>
              {query
                ? 'Try an account name, campaign number or note.'
                : canTransfer
                  ? 'Use New transaction to give credits to an account under you.'
                  : 'Transactions appear here when credits are added or used.'}
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

      {canTransfer && (
        <TransactionDialog
          open={dialogOpen}
          onClose={() => setDialogOpen(false)}
          onDone={(msg) => {
            setDialogOpen(false);
            setToast(msg);
            setPage(0);
            load();
          }}
        />
      )}
      <Snackbar
        open={Boolean(toast)}
        autoHideDuration={5000}
        onClose={() => setToast('')}
        message={toast}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      />
    </>
  );
}
