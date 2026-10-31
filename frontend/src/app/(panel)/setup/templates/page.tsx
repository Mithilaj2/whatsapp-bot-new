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
import PageHeader from '@/components/PageHeader';
import TemplateDialog from '@/components/setup/TemplateDialog';
import { TemplateStatusChip } from '@/components/StatusChip';
import { api, MessageTemplate, Page, SenderNumber } from '@/lib/api';
import { formatDate } from '@/lib/format';

export default function TemplatesPage() {
  const [numbers, setNumbers] = useState<SenderNumber[]>([]);
  const [numberId, setNumberId] = useState('');
  const [page, setPage] = useState(0);
  const [data, setData] = useState<Page<MessageTemplate> | null>(null);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');

  useEffect(() => {
    api<SenderNumber[]>('/gateway/numbers').then(setNumbers).catch(() => {});
  }, []);

  const load = useCallback(() => {
    api<Page<MessageTemplate>>('/gateway/templates', { query: { senderNumberId: numberId || undefined, page: page + 1, pageSize: 25 } })
      .then(setData)
      .catch((e) => setError(e.message));
  }, [numberId, page]);
  useEffect(load, [load]);

  // Templates in review change status on their own: check again every 10 seconds
  useEffect(() => {
    if (!data?.items.some((t) => t.status === 'PENDING')) return;
    const t = setInterval(load, 10_000);
    return () => clearInterval(t);
  }, [data, load]);

  async function sync(t: MessageTemplate) {
    try {
      const updated = await api<MessageTemplate>(`/gateway/templates/${t.id}/sync`, { method: 'POST' });
      setToast(`${t.name}: ${updated.status.toLowerCase()}`);
      load();
    } catch (e) {
      setToast((e as Error).message);
    }
  }

  return (
    <>
      <PageHeader
        title="Templates"
        description="WhatsApp only lets businesses start a conversation with an approved template. Approval usually takes minutes, sometimes a day."
        actions={
          <Button variant="contained" startIcon={<Add />} onClick={() => setOpen(true)} disabled={numbers.length === 0}>
            New template
          </Button>
        }
      />
      {numbers.length === 0 && (
        <Alert severity="info" sx={{ mb: 2 }}>
          Add a WhatsApp number first. Templates belong to a number.
        </Alert>
      )}
      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

      <Paper variant="outlined">
        <Box sx={{ px: 2, py: 1.5, borderBottom: 1, borderColor: 'divider' }}>
          <TextField
            select
            label="Number"
            value={numberId}
            onChange={(e) => {
              setNumberId(e.target.value);
              setPage(0);
            }}
            sx={{ minWidth: 240 }}
          >
            <MenuItem value="">All numbers</MenuItem>
            {numbers.map((n) => (
              <MenuItem key={n.id} value={n.id}>
                {n.label}
              </MenuItem>
            ))}
          </TextField>
        </Box>
        <TableContainer>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>Template</TableCell>
                <TableCell>Message</TableCell>
                <TableCell>Category</TableCell>
                <TableCell>Status</TableCell>
                <TableCell>Created</TableCell>
                <TableCell align="right">
                  <Box component="span" sx={{ position: 'absolute', left: -9999 }}>
                    Actions
                  </Box>
                </TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {data?.items.map((t) => (
                <TableRow key={t.id} hover>
                  <TableCell>
                    <Typography sx={{ fontWeight: 600 }}>{t.name}</Typography>
                    <Typography variant="body2" color="text.secondary">
                      {t.numberLabel}, {t.language}
                    </Typography>
                  </TableCell>
                  <TableCell sx={{ maxWidth: 360 }}>
                    <Typography variant="body2" sx={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                      {t.content.body}
                    </Typography>
                    {t.rejectionReason && (
                      <Typography variant="body2" color="error">
                        {t.rejectionReason}
                      </Typography>
                    )}
                  </TableCell>
                  <TableCell>{t.category === 'MARKETING' ? 'Marketing' : 'Utility'}</TableCell>
                  <TableCell>
                    <TemplateStatusChip status={t.status} />
                  </TableCell>
                  <TableCell sx={{ whiteSpace: 'nowrap' }}>{formatDate(t.createdAt)}</TableCell>
                  <TableCell align="right">
                    {t.status === 'PENDING' && (
                      <Button size="small" onClick={() => sync(t)}>
                        Check now
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
        {data && data.items.length === 0 && (
          <Box sx={{ py: 6, textAlign: 'center' }}>
            <Typography variant="h3">No templates yet</Typography>
            <Typography color="text.secondary" sx={{ mt: 0.5 }}>
              Create one and submit it to WhatsApp for approval.
            </Typography>
          </Box>
        )}
        <TablePagination component="div" count={data?.total ?? 0} page={page} onPageChange={(_, p) => setPage(p)} rowsPerPage={25} rowsPerPageOptions={[25]} />
      </Paper>

      <TemplateDialog
        open={open}
        numbers={numbers}
        onClose={() => setOpen(false)}
        onSaved={(t) => {
          setOpen(false);
          setToast(t.status === 'REJECTED' ? `${t.name} was not accepted: ${t.rejectionReason}` : `${t.name} submitted for approval`);
          load();
        }}
      />
      <Snackbar open={Boolean(toast)} autoHideDuration={6000} onClose={() => setToast('')} message={toast} anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }} />
    </>
  );
}
