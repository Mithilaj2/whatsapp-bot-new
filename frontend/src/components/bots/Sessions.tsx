'use client';
import FileDownloadOutlined from '@mui/icons-material/FileDownloadOutlined';
import {
  Box,
  Button,
  Chip,
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
import SearchField from '@/components/SearchField';
import { ToneChip } from '@/components/StatusChip';
import { api, BotNode, BotSession, downloadCsv, Page } from '@/lib/api';
import { formatDate, formatPhone } from '@/lib/format';

const statusInfo: Record<BotSession['status'], { label: string; tone: 'good' | 'wait' | 'bad' | 'plain' }> = {
  ACTIVE: { label: 'In progress', tone: 'plain' },
  COMPLETED: { label: 'Finished', tone: 'good' },
  HANDOFF: { label: 'Waiting for team', tone: 'wait' },
  ENDED: { label: 'Ended', tone: 'plain' },
};

/** Everyone who chatted with the bot, with the answers they gave. */
export default function Sessions({ botId, botName, nodes }: { botId: string; botName: string; nodes: BotNode[] }) {
  const [status, setStatus] = useState('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(0);
  const [data, setData] = useState<Page<BotSession> | null>(null);
  const [toast, setToast] = useState('');

  const load = useCallback(() => {
    api<Page<BotSession>>(`/bots/${botId}/sessions`, { query: { status, search: query, page: page + 1, pageSize: 25 } })
      .then(setData)
      .catch((e) => setToast(e.message));
  }, [botId, status, query, page]);
  useEffect(load, [load]);

  const onSearch = useCallback((v: string) => {
    setQuery(v);
    setPage(0);
  }, []);

  async function resume(s: BotSession) {
    try {
      await api(`/bots/sessions/${s.id}/end`, { method: 'POST' });
      setToast(`The bot will answer ${formatPhone(s.contactPhone)} again`);
      load();
    } catch (e) {
      setToast((e as Error).message);
    }
  }

  const stepName = (id: string | null) => (id ? (nodes.find((n) => n.id === id)?.name ?? id) : '');
  // Menu choices are saved under the step id: show the step's name instead
  const label = (k: string) => nodes.find((n) => n.id === k)?.name ?? k;

  return (
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
          sx={{ minWidth: 190, my: 1 }}
        >
          <MenuItem value="">All</MenuItem>
          <MenuItem value="HANDOFF">Waiting for team</MenuItem>
          <MenuItem value="ACTIVE">In progress</MenuItem>
          <MenuItem value="COMPLETED">Finished</MenuItem>
          <MenuItem value="ENDED">Ended</MenuItem>
        </TextField>
        <Box sx={{ flex: 1 }} />
        <SearchField placeholder="Phone, name or answer" label="Search chats" onSearch={onSearch} width={260} />
        <Button
          variant="outlined"
          startIcon={<FileDownloadOutlined />}
          onClick={() => downloadCsv(`/bots/${botId}/sessions/export`, {}, `bot-${botName.toLowerCase().replace(/[^\w]+/g, '-')}-answers.csv`)}
        >
          Download
        </Button>
      </Box>
      <TableContainer>
        <Table>
          <TableHead>
            <TableRow>
              <TableCell>Person</TableCell>
              <TableCell>Answers</TableCell>
              <TableCell>Status</TableCell>
              <TableCell>Last message</TableCell>
              <TableCell align="right">
                <Box component="span" sx={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>
                  Actions
                </Box>
              </TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {data?.items.map((s) => {
              const st = statusInfo[s.status];
              const answers = Object.entries(s.variables);
              return (
                <TableRow key={s.id} hover>
                  <TableCell>
                    <Typography sx={{ whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>{formatPhone(s.contactPhone)}</Typography>
                    {s.contactName && (
                      <Typography variant="body2" color="text.secondary">
                        {s.contactName}
                      </Typography>
                    )}
                  </TableCell>
                  <TableCell sx={{ maxWidth: 360 }}>
                    {answers.length ? (
                      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                        {answers.map(([k, v]) => (
                          <Chip key={k} size="small" variant="outlined" label={`${label(k)}: ${v}`} sx={{ maxWidth: '100%' }} />
                        ))}
                      </Box>
                    ) : (
                      <Typography variant="body2" color="text.secondary">
                        —
                      </Typography>
                    )}
                  </TableCell>
                  <TableCell>
                    <ToneChip label={st.label} tone={st.tone} />
                    {s.status === 'ACTIVE' && s.nodeId && (
                      <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                        At: {stepName(s.nodeId)}
                      </Typography>
                    )}
                  </TableCell>
                  <TableCell sx={{ minWidth: 110 }}>{formatDate(s.lastActivityAt)}</TableCell>
                  <TableCell align="right">
                    {s.status === 'HANDOFF' && (
                      <Button size="small" onClick={() => resume(s)}>
                        Bot back on
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </TableContainer>
      {data && data.items.length === 0 && (
        <Box sx={{ py: 6, textAlign: 'center' }}>
          <Typography variant="h3">{query || status ? 'No chats match' : 'No chats yet'}</Typography>
          <Typography color="text.secondary" sx={{ mt: 0.5 }}>
            {query || status ? 'Try another search or status.' : 'When people chat with the bot on WhatsApp, they and their answers show up here.'}
          </Typography>
        </Box>
      )}
      <TablePagination component="div" count={data?.total ?? 0} page={page} onPageChange={(_, p) => setPage(p)} rowsPerPage={25} rowsPerPageOptions={[25]} />
      <Snackbar open={Boolean(toast)} autoHideDuration={4000} onClose={() => setToast('')} message={toast} anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }} />
    </Paper>
  );
}
