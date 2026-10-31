'use client';
import { Box, Chip, MenuItem, Paper, Table, TableBody, TableCell, TableContainer, TableHead, TablePagination, TableRow, TextField, Typography } from '@mui/material';
import { useCallback, useEffect, useState } from 'react';
import PageHeader from '@/components/PageHeader';
import SearchField from '@/components/SearchField';
import { api, Page } from '@/lib/api';
import { formatDate } from '@/lib/format';

interface AuditRow {
  id: string;
  username: string | null;
  accountUsername: string | null;
  action: string;
  targetId: string | null;
  details: Record<string, unknown> | null;
  ip: string | null;
  createdAt: string;
}

/** Plain words for the logged actions (method + route). Unknown ones show as they are. */
const LABELS: [RegExp, string][] = [
  [/^LOGIN$/, 'Logged in'],
  [/^LOGIN_FAILED$/, 'Wrong password'],
  [/^POST \/api\/auth\/change-password$/, 'Changed own password'],
  [/^POST \/api\/accounts$/, 'Created an account'],
  [/^PATCH \/api\/accounts\/:id$/, 'Changed an account'],
  [/^DELETE \/api\/accounts\/:id$/, 'Deleted an account'],
  [/^POST \/api\/credits\/transactions$/, 'Moved credits'],
  [/^POST \/api\/campaigns$/, 'Sent a campaign'],
  [/^POST \/api\/campaigns\/:id\/cancel$/, 'Stopped a campaign'],
  [/^PUT \/api\/campaigns\/defaults$/, 'Saved campaign defaults'],
  [/\/api\/gateway\/numbers/, 'Changed WhatsApp numbers'],
  [/\/api\/gateway\/templates/, 'Changed templates'],
  [/\/api\/gateway\/setup/, 'Changed WhatsApp setup'],
  [/^POST \/api\/brands$/, 'Submitted a brand'],
  [/^PUT \/api\/brands\/:id$/, 'Changed a brand'],
  [/^POST \/api\/brands\/:id\/review$/, 'Reviewed a brand'],
  [/\/api\/auto-responders/, 'Changed auto replies'],
  [/\/api\/opt-outs/, 'Changed opt-outs'],
  [/^POST \/api\/inbox\//, 'Replied to a message'],
  [/\/api\/bots/, 'Changed a bot'],
  [/\/api\/countries/, 'Changed countries'],
];
const label = (a: string) => LABELS.find(([r]) => r.test(a))?.[1] ?? a;

export default function ActivityPage() {
  const [kind, setKind] = useState('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(0);
  const [data, setData] = useState<Page<AuditRow> | null>(null);

  const load = useCallback(() => {
    api<Page<AuditRow>>('/audit', { query: { action: kind, search: query, page: page + 1, pageSize: 50 } })
      .then(setData)
      .catch(() => {});
  }, [kind, query, page]);
  useEffect(load, [load]);
  const onSearch = useCallback((v: string) => {
    setQuery(v);
    setPage(0);
  }, []);

  return (
    <>
      <PageHeader title="Activity log" description="Logins and every change made in the panel by you and the accounts under you, with the address it came from. Kept for a year." />
      <Paper variant="outlined">
        <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 2, px: 2, py: 0.5, borderBottom: 1, borderColor: 'divider' }}>
          <TextField select label="Show" value={kind} onChange={(e) => { setKind(e.target.value); setPage(0); }} sx={{ minWidth: 200, my: 1 }} slotProps={{ select: { displayEmpty: true }, inputLabel: { shrink: true } }}>
            <MenuItem value="">Everything</MenuItem>
            <MenuItem value="LOGIN">Logins and wrong passwords</MenuItem>
            <MenuItem value="POST /api/credits">Credit moves</MenuItem>
            <MenuItem value="POST /api/campaigns">Campaigns</MenuItem>
            <MenuItem value="DELETE">Deletions</MenuItem>
          </TextField>
          <Box sx={{ flex: 1 }} />
          <SearchField placeholder="Username, IP address or record" label="Search activity" onSearch={onSearch} />
        </Box>
        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>When</TableCell>
                <TableCell>Who</TableCell>
                <TableCell>What</TableCell>
                <TableCell>Details</TableCell>
                <TableCell>IP address</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {data?.items.map((r) => (
                <TableRow key={r.id} hover>
                  <TableCell sx={{ whiteSpace: 'nowrap', py: 1.25 }}>{formatDate(r.createdAt)}</TableCell>
                  <TableCell>
                    {r.username ?? '—'}
                    {r.accountUsername && r.accountUsername !== r.username && (
                      <Typography variant="body2" color="text.secondary">
                        {r.accountUsername}
                      </Typography>
                    )}
                  </TableCell>
                  <TableCell>
                    {r.action === 'LOGIN_FAILED' ? <Chip size="small" label={label(r.action)} sx={{ bgcolor: '#F8E1DC', color: '#8E2A18' }} /> : label(r.action)}
                  </TableCell>
                  <TableCell sx={{ maxWidth: 360 }}>
                    <Typography variant="body2" color="text.secondary" sx={{ overflowWrap: 'anywhere' }}>
                      {[
                        ...Object.entries(r.details ?? {}).map(([k, v]) => `${k}: ${String(v)}`),
                        r.targetId ? `record ${r.targetId.slice(0, 8)}` : '',
                      ]
                        .filter(Boolean)
                        .join(', ') || '—'}
                    </Typography>
                  </TableCell>
                  <TableCell sx={{ fontVariantNumeric: 'tabular-nums' }}>{r.ip || '—'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
        {data && data.items.length === 0 && (
          <Typography color="text.secondary" sx={{ p: 5, textAlign: 'center' }}>
            Nothing here yet.
          </Typography>
        )}
        <TablePagination component="div" count={data?.total ?? 0} page={page} onPageChange={(_, p) => setPage(p)} rowsPerPage={50} rowsPerPageOptions={[50]} />
      </Paper>
    </>
  );
}
