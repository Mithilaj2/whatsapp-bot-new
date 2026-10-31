'use client';
import FileDownloadOutlined from '@mui/icons-material/FileDownloadOutlined';
import StopCircleOutlined from '@mui/icons-material/StopCircleOutlined';
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Paper,
  Snackbar,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TablePagination,
  TableRow,
  Tabs,
  Typography,
} from '@mui/material';
import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import { Suspense, useCallback, useEffect, useState } from 'react';
import Progress from '@/components/campaigns/Progress';
import { CampaignStatusChip, MessageStatusChip } from '@/components/StatusChip';
import WhatsAppPreview from '@/components/WhatsAppPreview';
import { api, CampaignDetail, CampaignRecipient, downloadCsv, Page, Service, TemplateButton } from '@/lib/api';
import { formatDate, formatDuration, formatNumber, formatPhone } from '@/lib/format';

export default function ReportDetail({ service }: { service: Service }) {
  return (
    <Suspense>
      <CampaignReport service={service} />
    </Suspense>
  );
}

function CampaignReport({ service }: { service: Service }) {
  const branded = service === 'BRANDED';
  const { id } = useParams<{ id: string }>();
  const params = useSearchParams();
  const [c, setC] = useState<CampaignDetail | null>(null);
  const [error, setError] = useState('');
  const [tab, setTab] = useState('');
  const [page, setPage] = useState(0);
  const [rows, setRows] = useState<Page<CampaignRecipient> | null>(null);
  const [confirmStop, setConfirmStop] = useState(false);
  const [toast, setToast] = useState(params.get('new') ? 'Campaign submitted' : '');

  const load = useCallback(() => {
    api<CampaignDetail>(`/campaigns/${id}`).then(setC).catch((e) => setError(e.message));
    api<Page<CampaignRecipient>>(`/campaigns/${id}/recipients`, { query: { status: tab, page: page + 1, pageSize: 25 } })
      .then(setRows)
      .catch(() => {});
  }, [id, tab, page]);
  useEffect(load, [load]);

  const active = c?.status === 'SENDING' || c?.status === 'PENDING_APPROVAL';
  // Delivered and read keep changing for a while after sending finishes
  const recent = c?.completedAt && Date.now() - new Date(c.completedAt).getTime() < 10 * 60_000;
  useEffect(() => {
    if (!active && !recent) return;
    const t = setInterval(load, active ? 3000 : 10000);
    return () => clearInterval(t);
  }, [active, recent, load]);

  async function stop() {
    try {
      const r = await api<{ stopped: number; refunded: number }>(`/campaigns/${id}/cancel`, { method: 'POST' });
      setToast(`Stopped. ${formatNumber(r.stopped)} messages not sent; credits returned.`);
    } catch (e) {
      setToast((e as Error).message);
    }
    setConfirmStop(false);
    load();
  }

  if (error) return <Alert severity="error">{error}</Alert>;
  if (!c) return null;
  const s = c.stats;
  const buttons: TemplateButton[] = [];
  if (c.content.callNumber) buttons.push({ type: 'PHONE_NUMBER', text: 'Call now', phone: c.content.callNumber });
  if (c.content.visitUrl) buttons.push({ type: 'URL', text: 'Visit website', url: c.content.visitUrl });
  buttons.push({ type: 'QUICK_REPLY', text: 'Stop' });

  const tiles = [
    { label: 'Recipients', value: c.recipients },
    { label: 'Sent', value: s?.sent ?? 0 },
    { label: 'Delivered', value: s?.delivered ?? 0 },
    { label: 'Read', value: s?.read ?? 0 },
    { label: 'Failed', value: s?.failed ?? 0 },
    { label: 'Replied', value: s?.replies ?? 0 },
  ];

  return (
    <>
      <Typography
        component={Link}
        href={`/campaigns/${service.toLowerCase()}/reports`}
        variant="body2"
        sx={{ color: 'text.secondary', textDecoration: 'none' }}
      >
        {branded ? 'Branded' : 'Premium'} campaign reports
      </Typography>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', justifyContent: 'space-between', gap: 2, mt: 0.5, mb: 3 }}>
        <Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
            <Typography variant="h1">{c.campaignNo}</Typography>
            <CampaignStatusChip status={c.status} />
          </Box>
          <Typography color="text.secondary" sx={{ mt: 0.5 }}>
            {c.title}
            {c.isDemo ? ' (demo)' : ''}, for {c.accountName}
          </Typography>
        </Box>
        <Box sx={{ display: 'flex', gap: 1 }}>
          <Button
            variant="outlined"
            startIcon={<FileDownloadOutlined />}
            onClick={() => downloadCsv(`/campaigns/${id}/report`, {}, `campaign-${c.campaignNo}.csv`)}
          >
            Download report
          </Button>
          {active && (
            <Button variant="outlined" color="error" startIcon={<StopCircleOutlined />} onClick={() => setConfirmStop(true)}>
              Stop
            </Button>
          )}
        </Box>
      </Box>

      {c.status === 'PENDING_APPROVAL' && (
        <Alert severity="info" sx={{ mb: 2 }}>
          WhatsApp is checking this message. Sending starts on its own once it&apos;s approved, usually within minutes.
        </Alert>
      )}
      {c.status === 'REJECTED' && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {c.rejectionReason}. All {formatNumber(c.creditsRefunded)} credits were returned. Change the wording and send it again.
        </Alert>
      )}

      <Paper variant="outlined" sx={{ display: 'grid', gridTemplateColumns: { xs: 'repeat(2, 1fr)', sm: 'repeat(3, 1fr)', lg: 'repeat(6, 1fr)' }, mb: 2, overflow: 'hidden' }}>
        {tiles.map((t) => (
          <Box key={t.label} sx={{ p: 2, boxShadow: (th) => `-1px -1px 0 ${th.palette.divider}` }}>
            <Typography sx={{ fontSize: '1.75rem', fontWeight: 650, fontVariantNumeric: 'tabular-nums', lineHeight: 1.2 }}>
              {formatNumber(t.value)}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {t.label}
              {t.label !== 'Recipients' && c.recipients > 0 ? ` (${Math.round((t.value / c.recipients) * 100)}%)` : ''}
            </Typography>
          </Box>
        ))}
      </Paper>

      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: '1fr 320px' }, gap: 2, alignItems: 'start' }}>
        <Box sx={{ display: 'grid', gap: 2, minWidth: 0 }}>
          <Paper variant="outlined" sx={{ p: 2.5 }}>
            <Progress stats={s} recipients={c.recipients} />
          </Paper>

          <Paper variant="outlined">
            <Tabs value={tab} onChange={(_, v) => { setTab(v); setPage(0); }} variant="scrollable" sx={{ px: 2, borderBottom: 1, borderColor: 'divider' }}>
              <Tab value="" label="All recipients" />
              <Tab value="READ" label="Read" />
              <Tab value="DELIVERED" label="Delivered" />
              <Tab value="FAILED" label="Failed" />
              <Tab value="QUEUED" label="Waiting" />
            </Tabs>
            <Box sx={{ overflowX: 'auto' }}>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Phone</TableCell>
                    <TableCell>Status</TableCell>
                    <TableCell>Delivered</TableCell>
                    <TableCell>Read</TableCell>
                    <TableCell>Problem</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {rows?.items.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell sx={{ whiteSpace: 'nowrap', py: 1.25 }}>{formatPhone(r.contactPhone)}</TableCell>
                      <TableCell>
                        <MessageStatusChip status={r.status} />
                      </TableCell>
                      <TableCell sx={{ whiteSpace: 'nowrap' }}>{r.deliveredAt ? formatDate(r.deliveredAt) : '—'}</TableCell>
                      <TableCell sx={{ whiteSpace: 'nowrap' }}>{r.readAt ? formatDate(r.readAt) : '—'}</TableCell>
                      <TableCell sx={{ color: 'error.main', maxWidth: 280 }}>{r.status === 'FAILED' ? r.errorMessage : ''}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Box>
            {rows && rows.items.length === 0 && (
              <Typography color="text.secondary" sx={{ p: 3, textAlign: 'center' }}>
                No recipients here.
              </Typography>
            )}
            <TablePagination component="div" count={rows?.total ?? 0} page={page} onPageChange={(_, p) => setPage(p)} rowsPerPage={25} rowsPerPageOptions={[25]} />
          </Paper>

          {c.failureReasons.length > 0 && (
            <Paper variant="outlined" sx={{ p: 2.5 }}>
              <Typography variant="h3" sx={{ mb: 1 }}>
                Why messages failed
              </Typography>
              {c.failureReasons.map((f, i) => (
                <Box key={i} sx={{ display: 'flex', justifyContent: 'space-between', gap: 2, py: 0.75, borderTop: 1, borderColor: 'divider' }}>
                  <Typography variant="body2">{f.reason ?? 'Unknown'}</Typography>
                  <Typography variant="body2" sx={{ fontWeight: 600, whiteSpace: 'nowrap' }}>
                    {formatNumber(f.n)}
                  </Typography>
                </Box>
              ))}
              <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
                Credits for failed messages are returned automatically.
              </Typography>
            </Paper>
          )}
        </Box>

        <Box sx={{ display: 'grid', gap: 2 }}>
          <WhatsAppPreview
            senderName={c.brandName ?? undefined}
            content={{ header: { type: 'IMAGE', exampleUrl: c.content.imageUrl ?? '' }, body: c.content.message, footer: 'Reply STOP to unsubscribe', buttons }}
          />
          <Paper variant="outlined" sx={{ p: 2.5 }}>
            <Typography variant="h3" sx={{ mb: 1 }}>
              Details
            </Typography>
            {[
              ['Account', `${c.accountName} (${c.accountUsername})`],
              ...(c.brandName ? [['Brand', c.brandName]] : []),
              ...(c.senderPhone ? [['Sent from', formatPhone(c.senderPhone)]] : []),
              ['Sent by', c.createdBy ?? '—'],
              ['Submitted', formatDate(c.submittedAt)],
              ['Started', c.startedAt ? formatDate(c.startedAt) : '—'],
              ['Finished', c.completedAt ? formatDate(c.completedAt) : '—'],
              ['Run time', formatDuration(c.startedAt, c.completedAt)],
              ['Numbers pasted', formatNumber(c.totalNumbers)],
              ['Left out', `${formatNumber(c.invalidNumbers)} invalid, ${formatNumber(c.duplicateNumbers)} duplicate, ${formatNumber(c.optedOutNumbers)} opted out`],
              ['Credits used', formatNumber(c.creditsCharged)],
              ['Credits returned', formatNumber(c.creditsRefunded)],
            ].map(([k, v]) => (
              <Box key={k} sx={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: 1, py: 0.6, borderTop: 1, borderColor: 'divider' }}>
                <Typography variant="body2" color="text.secondary">
                  {k}
                </Typography>
                <Typography variant="body2">{v}</Typography>
              </Box>
            ))}
            <Typography variant="h3" sx={{ mt: 2, mb: 1 }}>
              Countries
            </Typography>
            {c.byCountry.map((b) => (
              <Box key={b.code} sx={{ display: 'flex', justifyContent: 'space-between', py: 0.6, borderTop: 1, borderColor: 'divider' }}>
                <Typography variant="body2">{b.name}</Typography>
                <Typography variant="body2" sx={{ fontWeight: 600 }}>
                  {formatNumber(b.recipients)}
                </Typography>
              </Box>
            ))}
          </Paper>
        </Box>
      </Box>

      <Dialog open={confirmStop} onClose={() => setConfirmStop(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Stop {c.campaignNo}?</DialogTitle>
        <DialogContent>
          <Typography>
            Messages not sent yet won&apos;t be sent, and their credits come back. Messages already sent can&apos;t be
            recalled.
          </Typography>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setConfirmStop(false)}>Keep sending</Button>
          <Button color="error" variant="contained" onClick={stop}>
            Stop campaign
          </Button>
        </DialogActions>
      </Dialog>
      <Snackbar open={Boolean(toast)} autoHideDuration={5000} onClose={() => setToast('')} message={toast} anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }} />
    </>
  );
}
