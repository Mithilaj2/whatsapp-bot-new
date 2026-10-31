'use client';
import ArrowBack from '@mui/icons-material/ArrowBack';
import CampaignOutlined from '@mui/icons-material/CampaignOutlined';
import DoneAll from '@mui/icons-material/DoneAll';
import FileDownloadOutlined from '@mui/icons-material/FileDownloadOutlined';
import Refresh from '@mui/icons-material/Refresh';
import Send from '@mui/icons-material/Send';
import {
  Alert,
  Box,
  Button,
  ButtonBase,
  IconButton,
  Paper,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import PageHeader from '@/components/PageHeader';
import SearchField from '@/components/SearchField';
import { api, Conversation, downloadCsv, Page, Service, Thread } from '@/lib/api';
import { formatDate, formatPhone, timeOnly } from '@/lib/format';
import { brand } from '@/lib/theme';

const dayFmt = new Intl.DateTimeFormat('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

/** Replies from contacts, as chats. Shared by Premium and Branded campaigns. */
export default function Inbox({ service, title }: { service: Service; title: string }) {
  const [query, setQuery] = useState('');
  const [list, setList] = useState<Page<Conversation> | null>(null);
  const [selected, setSelected] = useState<Conversation | null>(null);
  const [thread, setThread] = useState<Thread | null>(null);
  const [reply, setReply] = useState('');
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);
  const bottom = useRef<HTMLDivElement>(null);

  const loadList = useCallback(() => {
    api<Page<Conversation>>('/inbox/conversations', { query: { service, search: query, pageSize: 50 } })
      .then(setList)
      .catch((e) => setError(e.message));
  }, [service, query]);

  const loadThread = useCallback(() => {
    if (!selected) return;
    api<Thread>(`/inbox/${selected.senderNumberId}/${selected.contactPhone}`)
      .then(setThread)
      .catch((e) => setError(e.message));
  }, [selected]);

  useEffect(loadList, [loadList]);
  useEffect(loadThread, [loadThread]);
  // New replies arrive on their own
  useEffect(() => {
    const t = setInterval(() => {
      loadList();
      loadThread();
    }, 8000);
    return () => clearInterval(t);
  }, [loadList, loadThread]);
  useEffect(() => bottom.current?.scrollIntoView({ block: 'end' }), [thread?.messages.length]);

  async function send(e: FormEvent) {
    e.preventDefault();
    if (!selected || !reply.trim()) return;
    setSending(true);
    setError('');
    try {
      await api(`/inbox/${selected.senderNumberId}/${selected.contactPhone}/reply`, { method: 'POST', body: { text: reply } });
      setReply('');
      loadThread();
      loadList();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSending(false);
    }
  }

  const onSearch = useCallback((v: string) => setQuery(v), []);

  // Group messages by day for the date separators
  let lastDay = '';

  return (
    <>
      <PageHeader
        title={title}
        description="Replies from the people you messaged. You can answer for 24 hours after their last message."
        actions={
          <Button
            variant="outlined"
            startIcon={<FileDownloadOutlined />}
            onClick={() => downloadCsv('/inbox/export', { service }, `incoming-${service.toLowerCase()}.csv`)}
          >
            Export
          </Button>
        }
      />
      {error && (
        <Alert severity="error" onClose={() => setError('')} sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}
      <Paper
        variant="outlined"
        sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '320px 1fr' }, height: { md: 'calc(100dvh - 230px)' }, minHeight: 480, overflow: 'hidden' }}
      >
        {/* conversation list */}
        <Box sx={{ borderRight: { md: 1 }, borderColor: 'divider', display: { xs: selected ? 'none' : 'flex', md: 'flex' }, flexDirection: 'column', minHeight: 0 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 1.5, borderBottom: 1, borderColor: 'divider' }}>
            <SearchField placeholder="Search name or number" label="Search conversations" onSearch={onSearch} width={240} />
            <Tooltip title="Refresh">
              <IconButton aria-label="Refresh" onClick={loadList}>
                <Refresh fontSize="small" />
              </IconButton>
            </Tooltip>
          </Box>
          <Box sx={{ flex: 1, overflowY: 'auto' }}>
            {list?.items.map((c) => {
              const active = selected?.contactPhone === c.contactPhone && selected?.senderNumberId === c.senderNumberId;
              return (
                <ButtonBase
                  key={`${c.senderNumberId}-${c.contactPhone}`}
                  onClick={() => {
                    setSelected(c);
                    setThread(null);
                  }}
                  aria-current={active ? 'true' : undefined}
                  sx={{
                    display: 'block',
                    width: '100%',
                    textAlign: 'left',
                    px: 2,
                    py: 1.5,
                    borderBottom: 1,
                    borderColor: 'divider',
                    bgcolor: active ? brand.bubble : undefined,
                    '&:hover': { bgcolor: active ? brand.bubble : 'background.default' },
                  }}
                >
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 1 }}>
                    <Typography sx={{ fontWeight: 600 }} noWrap>
                      {c.contactName || formatPhone(c.contactPhone)}
                    </Typography>
                    <Typography variant="body2" color="text.secondary" sx={{ whiteSpace: 'nowrap' }}>
                      {formatDate(c.lastAt).split(',')[0]}
                    </Typography>
                  </Box>
                  {c.contactName && (
                    <Typography variant="body2" color="text.secondary">
                      {formatPhone(c.contactPhone)}
                    </Typography>
                  )}
                  <Typography variant="body2" noWrap sx={{ mt: 0.25 }}>
                    {c.lastDirection === 'OUT' ? 'You: ' : ''}
                    {c.lastBody || 'Media message'}
                  </Typography>
                </ButtonBase>
              );
            })}
            {list && list.items.length === 0 && (
              <Box sx={{ p: 3, textAlign: 'center' }}>
                <Typography sx={{ fontWeight: 600 }}>{query ? 'No matches' : 'No replies yet'}</Typography>
                <Typography variant="body2" color="text.secondary">
                  {query ? 'Try another name or number.' : 'When someone answers a campaign, the chat appears here.'}
                </Typography>
              </Box>
            )}
          </Box>
          <Typography variant="body2" color="text.secondary" sx={{ p: 1, textAlign: 'center', borderTop: 1, borderColor: 'divider' }}>
            {list ? `${list.total} conversation${list.total === 1 ? '' : 's'}` : ''}
          </Typography>
        </Box>

        {/* thread */}
        <Box sx={{ display: { xs: selected ? 'flex' : 'none', md: 'flex' }, flexDirection: 'column', minHeight: 0, bgcolor: '#E9EFEC' }}>
          {!selected ? (
            <Box sx={{ m: 'auto', textAlign: 'center', p: 3 }}>
              <Typography color="text.secondary">Choose a conversation to read it.</Typography>
            </Box>
          ) : (
            <>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 2, py: 1.25, bgcolor: 'background.paper', borderBottom: 1, borderColor: 'divider' }}>
                <IconButton aria-label="Back to conversations" onClick={() => setSelected(null)} sx={{ display: { md: 'none' } }}>
                  <ArrowBack />
                </IconButton>
                <Box>
                  <Typography sx={{ fontWeight: 650 }}>{thread?.contactName || formatPhone(selected.contactPhone)}</Typography>
                  <Typography variant="body2" color="text.secondary">
                    {formatPhone(selected.contactPhone)}, on {selected.numberLabel}
                  </Typography>
                </Box>
              </Box>

              <Box sx={{ flex: 1, overflowY: 'auto', p: 2, display: 'flex', flexDirection: 'column', gap: 1 }}>
                {thread?.messages.map((m) => {
                  const out = m.direction === 'OUT';
                  const day = dayFmt.format(new Date(m.createdAt));
                  const showDay = day !== lastDay;
                  lastDay = day;
                  return (
                    <Box key={m.id} sx={{ display: 'contents' }}>
                      {showDay && (
                        <Typography variant="body2" sx={{ alignSelf: 'center', bgcolor: 'background.paper', px: 1.5, py: 0.25, borderRadius: 2, my: 1 }}>
                          {day}
                        </Typography>
                      )}
                      <Box
                        sx={{
                          alignSelf: out ? 'flex-end' : 'flex-start',
                          maxWidth: '72%',
                          bgcolor: out ? brand.bubble : 'background.paper',
                          borderRadius: out ? '12px 12px 3px 12px' : '12px 12px 12px 3px',
                          px: 1.5,
                          py: 1,
                          boxShadow: '0 1px 0.5px rgba(0,0,0,.1)',
                        }}
                      >
                        {m.imageUrl && (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={m.imageUrl} alt="" style={{ width: '100%', maxWidth: 260, borderRadius: 8, display: 'block', marginBottom: 6 }} />
                        )}
                        <Typography sx={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', fontSize: '0.9375rem' }}>
                          {m.body || 'Media message'}
                        </Typography>
                        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 0.75, mt: 0.5 }}>
                          {m.campaignNo && (
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.4, fontSize: '0.75rem', fontWeight: 600, color: brand.action }}>
                              <CampaignOutlined sx={{ fontSize: 14 }} />
                              {m.campaignNo}
                            </Box>
                          )}
                          <Typography sx={{ fontSize: '0.75rem', color: 'text.secondary' }}>{timeOnly(m.createdAt)}</Typography>
                          {out && (
                            <Tooltip title={m.status === 'FAILED' ? (m.errorMessage ?? 'Failed') : m.status.toLowerCase()}>
                              <DoneAll
                                aria-label={m.status.toLowerCase()}
                                sx={{
                                  fontSize: 15,
                                  color: m.status === 'READ' ? '#2E9CDB' : m.status === 'FAILED' ? 'error.main' : 'text.secondary',
                                }}
                              />
                            </Tooltip>
                          )}
                        </Box>
                      </Box>
                    </Box>
                  );
                })}
                <div ref={bottom} />
              </Box>

              <Box component="form" onSubmit={send} sx={{ p: 1.5, bgcolor: 'background.paper', borderTop: 1, borderColor: 'divider' }}>
                {thread && !thread.canReply ? (
                  <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'center', py: 1 }}>
                    More than 24 hours since they last wrote. WhatsApp only allows a new campaign message now.
                  </Typography>
                ) : (
                  <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-end' }}>
                    <TextField
                      value={reply}
                      onChange={(e) => setReply(e.target.value)}
                      placeholder="Type a reply"
                      multiline
                      maxRows={5}
                      fullWidth
                      slotProps={{ htmlInput: { 'aria-label': 'Reply', maxLength: 4096 } }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault();
                          void send(e as unknown as FormEvent);
                        }
                      }}
                    />
                    <Button type="submit" variant="contained" disabled={sending || !reply.trim()} aria-label="Send reply" sx={{ minWidth: 48, height: 40 }}>
                      <Send fontSize="small" />
                    </Button>
                  </Box>
                )}
                {thread?.canReply && thread.replyWindowEndsAt && (
                  <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                    You can reply until {formatDate(thread.replyWindowEndsAt)}.
                  </Typography>
                )}
              </Box>
            </>
          )}
        </Box>
      </Paper>
    </>
  );
}
