'use client';
import {
  Alert,
  Box,
  MenuItem,
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
  TextField,
  Typography,
} from '@mui/material';
import { useCallback, useEffect, useState } from 'react';
import PageHeader from '@/components/PageHeader';
import SearchField from '@/components/SearchField';
import { MessageStatusChip } from '@/components/StatusChip';
import { api, Message, Page } from '@/lib/api';
import { formatDate, formatPhone } from '@/lib/format';

export default function MessagesPage() {
  const [direction, setDirection] = useState<'ALL' | 'OUT' | 'IN'>('ALL');
  const [status, setStatus] = useState('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(0);
  const [data, setData] = useState<Page<Message> | null>(null);
  const [error, setError] = useState('');

  const load = useCallback(() => {
    api<Page<Message>>('/gateway/messages', {
      query: { direction: direction === 'ALL' ? undefined : direction, status, search: query, page: page + 1, pageSize: 50 },
    })
      .then(setData)
      .catch((e) => setError(e.message));
  }, [direction, status, query, page]);
  useEffect(load, [load]);

  // Statuses change as WhatsApp reports back: refresh every 5 seconds
  useEffect(() => {
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [load]);

  const onSearch = useCallback((v: string) => {
    setQuery(v);
    setPage(0);
  }, []);

  return (
    <>
      <PageHeader title="Message log" description="Every WhatsApp message sent or received on the platform, for troubleshooting." />
      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}
      <Paper variant="outlined">
        <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 2, px: 2, borderBottom: 1, borderColor: 'divider' }}>
          <Tabs
            value={direction}
            onChange={(_, v) => {
              setDirection(v);
              setPage(0);
            }}
            sx={{ flex: '1 1 auto' }}
          >
            <Tab value="ALL" label="All" />
            <Tab value="OUT" label="Sent" />
            <Tab value="IN" label="Received" />
          </Tabs>
          <TextField select label="Status" value={status} onChange={(e) => setStatus(e.target.value)} sx={{ minWidth: 150, my: 1 }}>
            <MenuItem value="">Any status</MenuItem>
            <MenuItem value="QUEUED">Waiting</MenuItem>
            <MenuItem value="SENT">Sent</MenuItem>
            <MenuItem value="DELIVERED">Delivered</MenuItem>
            <MenuItem value="READ">Read</MenuItem>
            <MenuItem value="FAILED">Failed</MenuItem>
          </TextField>
          <SearchField placeholder="Search phone number" label="Search phone number" onSearch={onSearch} width={220} />
        </Box>
        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>Time</TableCell>
                <TableCell>Contact</TableCell>
                <TableCell>Message</TableCell>
                <TableCell>Status</TableCell>
                <TableCell>Number</TableCell>
                <TableCell>Account</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {data?.items.map((m) => (
                <TableRow key={m.id} hover>
                  <TableCell sx={{ whiteSpace: 'nowrap', py: 1.25 }}>{formatDate(m.createdAt)}</TableCell>
                  <TableCell sx={{ whiteSpace: 'nowrap' }}>
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>
                      {m.direction === 'IN' ? 'From ' : 'To '}
                      {formatPhone(m.contactPhone)}
                    </Typography>
                    {m.contactName && (
                      <Typography variant="body2" color="text.secondary">
                        {m.contactName}
                      </Typography>
                    )}
                  </TableCell>
                  <TableCell sx={{ maxWidth: 380 }}>
                    {m.templateName && (
                      <Typography variant="body2" color="text.secondary">
                        Template {m.templateName}
                      </Typography>
                    )}
                    <Typography variant="body2" sx={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                      {m.body || '—'}
                    </Typography>
                    {m.status === 'FAILED' && (
                      <Typography variant="body2" color="error">
                        {m.errorMessage}
                        {m.errorCode ? ` (code ${m.errorCode})` : ''}
                      </Typography>
                    )}
                  </TableCell>
                  <TableCell>
                    <MessageStatusChip status={m.status} />
                    {m.attempts > 1 && (
                      <Typography variant="body2" color="text.secondary">
                        {m.attempts} tries
                      </Typography>
                    )}
                  </TableCell>
                  <TableCell>{m.numberLabel}</TableCell>
                  <TableCell>{m.accountUsername}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
        {data && data.items.length === 0 && (
          <Box sx={{ py: 6, textAlign: 'center' }}>
            <Typography variant="h3">No messages</Typography>
            <Typography color="text.secondary" sx={{ mt: 0.5 }}>
              Use Send test on a WhatsApp number to see messages here.
            </Typography>
          </Box>
        )}
        <TablePagination component="div" count={data?.total ?? 0} page={page} onPageChange={(_, p) => setPage(p)} rowsPerPage={50} rowsPerPageOptions={[50]} />
      </Paper>
    </>
  );
}
