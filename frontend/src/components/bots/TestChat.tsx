'use client';
import FormatListBulleted from '@mui/icons-material/FormatListBulleted';
import RestartAlt from '@mui/icons-material/RestartAlt';
import Send from '@mui/icons-material/Send';
import { Box, Button, IconButton, InputBase, Tooltip, Typography } from '@mui/material';
import { FormEvent, useEffect, useRef, useState } from 'react';
import { api, BotFlow, BotState, SimMessage } from '@/lib/api';
import { brand } from '@/lib/theme';

type Line = { from: 'me'; text: string } | { from: 'bot'; msg: SimMessage; id: number } | { from: 'note'; text: string };

/** Chat with the bot as it is in the editor (saved or not). Nothing is sent on WhatsApp. */
export default function TestChat({ flow, title }: { flow: BotFlow; title: string }) {
  const [lines, setLines] = useState<Line[]>([]);
  const [state, setState] = useState<BotState | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [openList, setOpenList] = useState<number | null>(null);
  const end = useRef<HTMLDivElement>(null);
  const seq = useRef(0);

  useEffect(() => {
    end.current?.scrollIntoView({ block: 'nearest' });
  }, [lines]);

  function restart() {
    setLines([]);
    setState(null);
    setOpenList(null);
  }

  async function say(t: string, replyId?: string) {
    if (!t.trim() || busy) return;
    setBusy(true);
    setOpenList(null);
    setLines((l) => [...l, { from: 'me', text: t }]);
    try {
      const res = await api<{ messages: SimMessage[]; state: BotState | null }>('/bots/simulate', {
        method: 'POST',
        body: { flow, state, text: t, replyId },
      });
      const out: Line[] = res.messages.map((m) => ({ from: 'bot', msg: m, id: ++seq.current }));
      if (!res.messages.length) out.push({ from: 'note', text: 'The bot does not reply to this.' });
      if (res.state?.status === 'HANDOFF') out.push({ from: 'note', text: 'Handed over to your team. The bot stays quiet for this person.' });
      if (res.state?.status === 'COMPLETED') out.push({ from: 'note', text: 'End of this chat. The next message starts again.' });
      setLines((l) => [...l, ...out]);
      setState(res.state?.status === 'ACTIVE' ? res.state : res.state ? { ...res.state, status: 'COMPLETED', nodeId: null } : null);
    } catch (e) {
      setLines((l) => [...l, { from: 'note', text: (e as Error).message }]);
    } finally {
      setBusy(false);
    }
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    const t = text;
    setText('');
    void say(t);
  }

  const lastBot = [...lines].reverse().find((l) => l.from === 'bot') as Extract<Line, { from: 'bot' }> | undefined;

  return (
    <Box
      aria-label="Test chat"
      sx={{ border: 1, borderColor: 'divider', borderRadius: 3, overflow: 'hidden', display: 'flex', flexDirection: 'column', height: { xs: 520, lg: 'calc(100vh - 220px)' }, minHeight: 440, bgcolor: '#E9EFEC' }}
    >
      <Box sx={{ bgcolor: brand.pine, color: '#fff', px: 2, py: 1.25, display: 'flex', alignItems: 'center', gap: 1 }}>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography sx={{ fontWeight: 600, fontSize: '0.9375rem' }} noWrap>
            {title}
          </Typography>
          <Typography sx={{ fontSize: '0.75rem', color: '#A9C4BB' }}>Test chat, nothing is sent</Typography>
        </Box>
        <Tooltip title="Start again">
          <IconButton aria-label="Start again" onClick={restart} sx={{ color: '#fff' }}>
            <RestartAlt />
          </IconButton>
        </Tooltip>
      </Box>

      <Box sx={{ flex: 1, overflowY: 'auto', p: 1.5, display: 'flex', flexDirection: 'column', gap: 0.75 }}>
        {lines.length === 0 && (
          <Box sx={{ m: 'auto', textAlign: 'center', px: 2 }}>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1.5 }}>
              Type a message as your customer would.
            </Typography>
            <Box sx={{ display: 'flex', gap: 1, justifyContent: 'center', flexWrap: 'wrap' }}>
              {[...new Set(['hi', ...flow.triggers.flatMap((t) => t.keywords)])].slice(0, 4).map((k) => (
                <Button key={k} size="small" variant="outlined" onClick={() => say(k)} sx={{ bgcolor: 'background.paper' }}>
                  {k}
                </Button>
              ))}
            </Box>
          </Box>
        )}
        {lines.map((l, i) =>
          l.from === 'me' ? (
            <Bubble key={i} mine>
              {l.text}
            </Bubble>
          ) : l.from === 'note' ? (
            <Typography key={i} variant="body2" sx={{ alignSelf: 'center', textAlign: 'center', bgcolor: 'rgba(255,255,255,.7)', borderRadius: 2, px: 1.5, py: 0.5, my: 0.5, maxWidth: '90%' }}>
              {l.text}
            </Typography>
          ) : (
            <BotLine
              key={i}
              msg={l.msg}
              live={l.id === lastBot?.id && !busy}
              listOpen={openList === l.id}
              onToggleList={() => setOpenList((o) => (o === l.id ? null : l.id))}
              onPick={(title, id) => say(title, id)}
            />
          ),
        )}
        {busy && (
          <Typography variant="body2" color="text.secondary" sx={{ alignSelf: 'flex-start', px: 1 }}>
            typing…
          </Typography>
        )}
        <div ref={end} />
      </Box>

      <Box component="form" onSubmit={submit} sx={{ display: 'flex', gap: 1, p: 1, bgcolor: '#F0F2F1' }}>
        <InputBase
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Message"
          inputProps={{ 'aria-label': 'Test message' }}
          sx={{ flex: 1, bgcolor: 'background.paper', borderRadius: 5, px: 2, py: 0.75 }}
        />
        <IconButton type="submit" aria-label="Send test message" disabled={!text.trim() || busy} sx={{ bgcolor: brand.action, color: '#fff', '&:hover': { bgcolor: brand.pine }, '&.Mui-disabled': { bgcolor: '#C9D3CF', color: '#fff' } }}>
          <Send fontSize="small" />
        </IconButton>
      </Box>
    </Box>
  );
}

function Bubble({ children, mine, tag }: { children: React.ReactNode; mine?: boolean; tag?: string }) {
  return (
    <Box
      sx={{
        alignSelf: mine ? 'flex-end' : 'flex-start',
        maxWidth: '85%',
        bgcolor: mine ? brand.bubble : 'background.paper',
        borderRadius: mine ? '12px 12px 3px 12px' : '12px 12px 12px 3px',
        px: 1.5,
        py: 0.75,
        boxShadow: '0 1px 0.5px rgba(0,0,0,.1)',
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
        fontSize: '0.875rem',
      }}
    >
      {children}
      {tag && <Typography sx={{ fontSize: '0.6875rem', fontWeight: 600, color: brand.pine, mt: 0.25, textAlign: 'right' }}>{tag}</Typography>}
    </Box>
  );
}

function BotLine({
  msg,
  live,
  listOpen,
  onToggleList,
  onPick,
}: {
  msg: SimMessage;
  live: boolean;
  listOpen: boolean;
  onToggleList: () => void;
  onPick: (title: string, id: string) => void;
}) {
  if (msg.kind === 'text') return <Bubble tag={msg.ai ? 'AI answer' : undefined}>{msg.text}</Bubble>;
  const r = msg.rich;
  const img = (url?: string) =>
    url ? (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={url} alt="" style={{ width: '100%', maxWidth: 240, borderRadius: 8, display: 'block', marginBottom: 6 }} />
    ) : null;
  if (r.kind === 'image') {
    return (
      <Bubble>
        {img(r.imageUrl)}
        {r.caption}
      </Bubble>
    );
  }
  const choiceSx = {
    bgcolor: 'background.paper',
    color: brand.action,
    fontWeight: 600,
    borderRadius: 2,
    boxShadow: '0 1px 0.5px rgba(0,0,0,.1)',
    textTransform: 'none',
    '&:hover': { bgcolor: '#F5FAF8' },
    '&.Mui-disabled': { color: '#8BA59C', bgcolor: 'background.paper' },
  } as const;
  return (
    <Box sx={{ alignSelf: 'flex-start', maxWidth: '85%', display: 'grid', gap: 0.5 }}>
      <Bubble>
        {r.kind === 'buttons' && img(r.imageUrl)}
        {r.body}
      </Bubble>
      {r.kind === 'buttons' ? (
        r.buttons.map((b) => (
          <Button key={b.id} disabled={!live} onClick={() => onPick(b.title, b.id)} sx={choiceSx}>
            {b.title}
          </Button>
        ))
      ) : (
        <>
          <Button disabled={!live} onClick={onToggleList} startIcon={<FormatListBulleted />} sx={choiceSx} aria-expanded={listOpen}>
            {r.button}
          </Button>
          {listOpen && live && (
            <Box sx={{ bgcolor: 'background.paper', borderRadius: 2, overflow: 'hidden', boxShadow: '0 1px 2px rgba(0,0,0,.15)' }}>
              {r.rows.map((row) => (
                <Box
                  key={row.id}
                  component="button"
                  type="button"
                  onClick={() => onPick(row.title, row.id)}
                  sx={{ all: 'unset', display: 'block', width: '100%', boxSizing: 'border-box', px: 1.5, py: 1, cursor: 'pointer', borderTop: 1, borderColor: 'divider', '&:first-of-type': { borderTop: 0 }, '&:hover, &:focus-visible': { bgcolor: '#F5FAF8' } }}
                >
                  <Typography sx={{ fontSize: '0.875rem', fontWeight: 600 }}>{row.title}</Typography>
                  {row.description && (
                    <Typography variant="body2" color="text.secondary">
                      {row.description}
                    </Typography>
                  )}
                </Box>
              ))}
            </Box>
          )}
        </>
      )}
    </Box>
  );
}
