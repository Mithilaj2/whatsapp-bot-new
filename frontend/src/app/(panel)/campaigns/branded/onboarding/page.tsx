'use client';
import Add from '@mui/icons-material/Add';
import {
  Alert,
  Box,
  Button,
  MenuItem,
  Paper,
  Snackbar,
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
import { useCallback, useEffect, useState } from 'react';
import BrandDetail from '@/components/brands/BrandDetail';
import BrandDialog from '@/components/brands/BrandDialog';
import { brandStatus } from '@/components/brands/status';
import PageHeader from '@/components/PageHeader';
import SearchField from '@/components/SearchField';
import { ToneChip } from '@/components/StatusChip';
import { api, Brand, Page } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatDate, formatPhone } from '@/lib/format';
import { brand as palette } from '@/lib/theme';

export default function OnboardingPage() {
  const { me } = useAuth();
  const isAdmin = me?.account.type === 'ADMIN';
  const [status, setStatus] = useState('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(0);
  const [data, setData] = useState<Page<Brand> | null>(null);
  const [error, setError] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Brand | null>(null);
  const [viewing, setViewing] = useState<Brand | null>(null);
  const [toast, setToast] = useState('');

  const load = useCallback(() => {
    api<Page<Brand>>('/brands', { query: { status, search: query, page: page + 1, pageSize: 25 } })
      .then(setData)
      .catch((e) => setError(e.message));
  }, [status, query, page]);
  useEffect(load, [load]);

  const onSearch = useCallback((v: string) => {
    setQuery(v);
    setPage(0);
  }, []);
  const showAccount = me?.account.type !== 'CUSTOMER';
  const filtered = Boolean(query || status);

  return (
    <>
      <PageHeader
        title="Onboarding form"
        description={
          isAdmin
            ? 'Brands waiting for a WhatsApp number. Set the number up in Meta, add it under WhatsApp numbers, then approve here.'
            : 'Send your business details to get your own WhatsApp number for Branded Campaigns.'
        }
        actions={
          <Button
            variant="contained"
            startIcon={<Add />}
            onClick={() => {
              setEditing(null);
              setFormOpen(true);
            }}
          >
            New brand
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
            sx={{ minWidth: 180, my: 1 }}
          >
            <MenuItem value="">All</MenuItem>
            <MenuItem value="SUBMITTED">In review</MenuItem>
            <MenuItem value="APPROVED">Live</MenuItem>
            <MenuItem value="REJECTED">Sent back</MenuItem>
          </TextField>
          <Box sx={{ flex: 1 }} />
          <SearchField placeholder="Brand, business, number or account" label="Search brands" onSearch={onSearch} />
        </Box>
        <TableContainer>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>Brand</TableCell>
                {showAccount && <TableCell>Account</TableCell>}
                <TableCell>WhatsApp number</TableCell>
                <TableCell>Status</TableCell>
                <TableCell>Submitted</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {data?.items.map((b) => {
                const st = brandStatus[b.status];
                return (
                  <TableRow key={b.id} hover onClick={() => setViewing(b)} sx={{ cursor: 'pointer' }}>
                    <TableCell>
                      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                        <Box
                          sx={{
                            width: 36,
                            height: 36,
                            borderRadius: '50%',
                            flexShrink: 0,
                            bgcolor: palette.bubble,
                            color: palette.pine,
                            display: 'grid',
                            placeItems: 'center',
                            fontWeight: 650,
                            overflow: 'hidden',
                          }}
                        >
                          {b.logoUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={b.logoUrl} alt="" width={36} height={36} style={{ objectFit: 'cover' }} />
                          ) : (
                            b.displayName.charAt(0).toUpperCase()
                          )}
                        </Box>
                        <Box sx={{ minWidth: 0 }}>
                          <Typography
                            component="button"
                            onClick={() => setViewing(b)}
                            sx={{ all: 'unset', fontWeight: 650, color: 'primary.main', cursor: 'pointer', '&:focus-visible': { outline: 2 } }}
                          >
                            {b.displayName}
                          </Typography>
                          <Typography variant="body2" color="text.secondary" noWrap>
                            {b.organizationName}
                          </Typography>
                        </Box>
                      </Box>
                    </TableCell>
                    {showAccount && <TableCell>{b.accountUsername}</TableCell>}
                    <TableCell sx={{ whiteSpace: 'nowrap' }}>{formatPhone(b.number?.phoneNumber ?? b.phoneNumber)}</TableCell>
                    <TableCell>
                      <ToneChip label={st.label} tone={st.tone} />
                    </TableCell>
                    <TableCell sx={{ whiteSpace: 'nowrap' }}>{formatDate(b.createdAt)}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </TableContainer>
        {data && data.items.length === 0 && (
          <Box sx={{ py: 6, px: 2, textAlign: 'center' }}>
            <Typography variant="h3">{filtered ? 'No brands match' : 'No brands yet'}</Typography>
            <Typography color="text.secondary" sx={{ mt: 0.5, mb: filtered ? 0 : 2 }}>
              {filtered
                ? 'Try another search or status.'
                : 'Fill in the onboarding form to send campaigns with your own business name and number.'}
            </Typography>
            {!filtered && (
              <Button variant="contained" onClick={() => setFormOpen(true)}>
                Fill in the form
              </Button>
            )}
          </Box>
        )}
        <TablePagination component="div" count={data?.total ?? 0} page={page} onPageChange={(_, p) => setPage(p)} rowsPerPage={25} rowsPerPageOptions={[25]} />
      </Paper>

      <BrandDialog
        open={formOpen}
        brand={editing}
        onClose={() => setFormOpen(false)}
        onSaved={(b) => {
          setFormOpen(false);
          setViewing(null);
          setToast(`${b.displayName} sent for review`);
          load();
        }}
      />
      <BrandDetail
        brand={viewing}
        onClose={() => setViewing(null)}
        onEdit={(b) => {
          setEditing(b);
          setViewing(null);
          setFormOpen(true);
        }}
        onChanged={(b) => {
          setViewing(b);
          setToast(b.status === 'APPROVED' ? `${b.displayName} is live` : `${b.displayName} sent back to the customer`);
          load();
        }}
      />
      <Snackbar open={Boolean(toast)} autoHideDuration={5000} onClose={() => setToast('')} message={toast} anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }} />
    </>
  );
}
