'use client';
import Add from '@mui/icons-material/Add';
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  MenuItem,
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
  TextField,
  Typography,
} from '@mui/material';
import { FormEvent, useCallback, useEffect, useState } from 'react';
import PageHeader from '@/components/PageHeader';
import SearchField from '@/components/SearchField';
import { ToneChip } from '@/components/StatusChip';
import { api, OptOut, OptOutNumber, Page, Service } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatDate, formatPhone } from '@/lib/format';

export default function OptOutsPage() {
  const { me } = useAuth();
  const [service, setService] = useState<Service>('BRANDED');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(0);
  const [data, setData] = useState<Page<OptOut> | null>(null);
  const [error, setError] = useState('');
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<OptOut | null>(null);
  const [toast, setToast] = useState('');

  const load = useCallback(() => {
    api<Page<OptOut>>('/opt-outs', { query: { service, search: query, page: page + 1, pageSize: 25 } })
      .then(setData)
      .catch((e) => setError(e.message));
  }, [service, query, page]);
  useEffect(load, [load]);

  const onSearch = useCallback((v: string) => {
    setQuery(v);
    setPage(0);
  }, []);
  const showAccount = me?.account.type !== 'CUSTOMER';

  async function remove() {
    try {
      await api(`/opt-outs/${removing!.id}`, { method: 'DELETE' });
      setToast(`${formatPhone(removing!.contactPhone)} can get messages again`);
      load();
    } catch (e) {
      setToast((e as Error).message);
    }
    setRemoving(null);
  }

  return (
    <>
      <PageHeader
        title="Opt-outs"
        description="People who don't want your messages. They are left out of every campaign from that number automatically."
        actions={
          <Button variant="contained" startIcon={<Add />} onClick={() => setAdding(true)}>
            Block a number
          </Button>
        }
      />
      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
      <Paper variant="outlined">
        <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 2, px: 2, borderBottom: 1, borderColor: 'divider' }}>
          <Tabs
            value={service}
            onChange={(_, v) => {
              setService(v);
              setPage(0);
            }}
          >
            <Tab value="BRANDED" label="Your numbers (Branded)" />
            <Tab value="PREMIUM" label="Shared number (Premium)" />
          </Tabs>
          <Box sx={{ flex: 1 }} />
          <Box sx={{ py: 1 }}>
            <SearchField placeholder="Phone or name" label="Search opt-outs" onSearch={onSearch} width={260} />
          </Box>
        </Box>
        <TableContainer>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>Phone</TableCell>
                <TableCell>From number</TableCell>
                {showAccount && <TableCell>Account</TableCell>}
                <TableCell>How</TableCell>
                <TableCell>Date</TableCell>
                <TableCell align="right">
                  <Box component="span" sx={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>
                    Actions
                  </Box>
                </TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {data?.items.map((o) => (
                <TableRow key={o.id} hover>
                  <TableCell>
                    <Typography sx={{ whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>{formatPhone(o.contactPhone)}</Typography>
                    {o.contactName && (
                      <Typography variant="body2" color="text.secondary">
                        {o.contactName}
                      </Typography>
                    )}
                  </TableCell>
                  <TableCell>{o.brandName ?? o.numberLabel}</TableCell>
                  {showAccount && <TableCell>{o.accountUsername ?? '—'}</TableCell>}
                  <TableCell>
                    <ToneChip label={o.mode === 'AUTO' ? 'Replied STOP' : 'Added by hand'} tone={o.mode === 'AUTO' ? 'wait' : 'plain'} />
                    {o.remarks && (
                      <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, maxWidth: 260 }}>
                        {o.remarks}
                      </Typography>
                    )}
                  </TableCell>
                  <TableCell sx={{ whiteSpace: 'nowrap' }}>{formatDate(o.createdAt)}</TableCell>
                  <TableCell align="right">
                    <Button size="small" onClick={() => setRemoving(o)}>
                      Unblock
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
        {data && data.items.length === 0 && (
          <Box sx={{ py: 6, textAlign: 'center' }}>
            <Typography variant="h3">{query ? 'No one matches' : 'No opt-outs'}</Typography>
            <Typography color="text.secondary" sx={{ mt: 0.5 }}>
              {query ? 'Try another number or name.' : 'When someone replies STOP to a campaign, they appear here.'}
            </Typography>
          </Box>
        )}
        <TablePagination component="div" count={data?.total ?? 0} page={page} onPageChange={(_, p) => setPage(p)} rowsPerPage={25} rowsPerPageOptions={[25]} />
      </Paper>

      <AddDialog
        open={adding}
        service={service}
        onClose={() => setAdding(false)}
        onSaved={(msg) => {
          setAdding(false);
          setToast(msg);
          load();
        }}
      />
      <Dialog open={Boolean(removing)} onClose={() => setRemoving(null)} maxWidth="xs" fullWidth>
        <DialogTitle>Unblock {removing && formatPhone(removing.contactPhone)}?</DialogTitle>
        <DialogContent>
          <Typography>
            They will get campaigns from {removing?.brandName ?? removing?.numberLabel} again. Only do this if they asked
            to hear from you.
          </Typography>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setRemoving(null)}>Keep blocked</Button>
          <Button variant="contained" onClick={remove}>
            Unblock
          </Button>
        </DialogActions>
      </Dialog>
      <Snackbar open={Boolean(toast)} autoHideDuration={4000} onClose={() => setToast('')} message={toast} anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }} />
    </>
  );
}

function AddDialog({ open, service, onClose, onSaved }: { open: boolean; service: Service; onClose: () => void; onSaved: (msg: string) => void }) {
  const [numbers, setNumbers] = useState<OptOutNumber[]>([]);
  const [numberId, setNumberId] = useState('');
  const [phone, setPhone] = useState('');
  const [remarks, setRemarks] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setPhone('');
    setRemarks('');
    setError('');
    api<OptOutNumber[]>('/opt-outs/numbers').then((n) => {
      setNumbers(n);
      setNumberId(n.find((x) => x.service === service)?.id ?? n[0]?.id ?? '');
    });
  }, [open, service]);

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const r = await api<{ alreadyOptedOut?: boolean }>('/opt-outs', { method: 'POST', body: { senderNumberId: numberId, phone, remarks: remarks || undefined } });
      onSaved(r.alreadyOptedOut ? 'That number was already blocked' : 'Blocked. They will be left out of campaigns from this number.');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth component="form" onSubmit={save}>
      <DialogTitle>Block a number</DialogTitle>
      <DialogContent sx={{ display: 'grid', gap: 2, pt: '8px !important' }}>
        {error && <Alert severity="error">{error}</Alert>}
        <TextField select label="From WhatsApp number" value={numberId} onChange={(e) => setNumberId(e.target.value)} required>
          {numbers.map((n) => (
            <MenuItem key={n.id} value={n.id}>
              {n.brandName ?? n.label} ({n.service === 'PREMIUM' ? 'shared' : formatPhone(n.phoneNumber)})
            </MenuItem>
          ))}
        </TextField>
        <TextField label="Phone number" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="98456 62183" required autoFocus />
        <TextField label="Note (optional)" value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder="Asked on a call" />
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose}>Cancel</Button>
        <Button type="submit" variant="contained" disabled={busy || !numberId}>
          Block
        </Button>
      </DialogActions>
    </Dialog>
  );
}
