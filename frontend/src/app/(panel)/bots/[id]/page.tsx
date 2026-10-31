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
  FormControlLabel,
  ListItemText,
  Menu,
  MenuItem,
  Snackbar,
  Switch,
  Tab,
  Tabs,
  TextField,
  Typography,
} from '@mui/material';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import Sessions from '@/components/bots/Sessions';
import StepCard, { stepTypes } from '@/components/bots/StepCard';
import TestChat from '@/components/bots/TestChat';
import { AiEditor, TriggersEditor } from '@/components/bots/Triggers';
import { api, Bot, BotFlow, BotNode, BotNodeType, BotNumber, BotSettings } from '@/lib/api';
import { formatPhone } from '@/lib/format';

const newStep = (type: BotNodeType, id: string): BotNode => {
  switch (type) {
    case 'BUTTONS':
      return { id, type, name: 'New buttons', text: 'What would you like to do?', options: [{ id: 'o1', title: 'Option 1' }, { id: 'o2', title: 'Option 2' }] };
    case 'LIST':
      return { id, type, name: 'New menu', text: 'Please choose from the menu.', listButton: 'See options', options: [{ id: 'o1', title: 'Option 1' }] };
    case 'QUESTION':
      return { id, type, name: 'New question', text: 'What is your email address?', variable: `answer_${id.slice(-4)}`, validation: 'TEXT' };
    case 'HANDOFF':
      return { id, type, name: 'Talk to a person', text: 'Okay, someone from our team will reply here shortly.' };
    default:
      return { id, type, name: 'New message', text: '' };
  }
};

/** Takes out links to a deleted step. */
function unlink(flow: BotFlow, id: string): BotFlow {
  return {
    ...flow,
    nodes: flow.nodes
      .filter((n) => n.id !== id)
      .map((n) => ({
        ...n,
        next: n.next === id ? undefined : n.next,
        options: n.options?.map((o) => (o.next === id ? { ...o, next: undefined } : o)),
      })),
    triggers: flow.triggers.map((t) => (t.startNodeId === id ? { ...t, startNodeId: '' } : t)),
    fallback: flow.fallback.startNodeId === id ? { ...flow.fallback, startNodeId: undefined } : flow.fallback,
  };
}

export default function BotEditorPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [bot, setBot] = useState<Bot | null>(null);
  const [name, setName] = useState('');
  const [numberId, setNumberId] = useState<string>('');
  const [flow, setFlow] = useState<BotFlow | null>(null);
  const [dirty, setDirty] = useState(false);
  const [numbers, setNumbers] = useState<BotNumber[]>([]);
  const [settings, setSettings] = useState<BotSettings | null>(null);
  const [tab, setTab] = useState('steps');
  const [open, setOpen] = useState<string | null>(null);
  const [addAnchor, setAddAnchor] = useState<HTMLElement | null>(null);
  const [deleting, setDeleting] = useState<BotNode | null>(null);
  const [removeBot, setRemoveBot] = useState(false);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');
  const [busy, setBusy] = useState(false);

  const take = useCallback((b: Bot) => {
    setBot(b);
    setName(b.name);
    setNumberId(b.senderNumberId ?? '');
    setFlow(b.flow);
    setDirty(false);
  }, []);

  useEffect(() => {
    api<Bot>(`/bots/${id}`).then(take).catch((e) => setError(e.message));
    api<BotNumber[]>('/bots/numbers').then(setNumbers);
    api<BotSettings>('/bots/settings').then(setSettings);
  }, [id, take]);

  // Don't lose work by closing the tab
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const edit = (f: BotFlow) => {
    setFlow(f);
    setDirty(true);
  };
  const starts = useMemo(() => {
    const s = new Set<string>();
    flow?.triggers.forEach((t) => s.add(t.startNodeId));
    if (flow?.fallback.mode === 'START' && flow.fallback.startNodeId) s.add(flow.fallback.startNodeId);
    return s;
  }, [flow]);

  if (error && !bot) return <Alert severity="error">{error}</Alert>;
  if (!bot || !flow) return null;

  async function save(extra: { isActive?: boolean } = {}) {
    setBusy(true);
    setError('');
    try {
      const b = await api<Bot>(`/bots/${id}`, {
        method: 'PATCH',
        body: { name, senderNumberId: numberId || null, flow, ...extra },
      });
      take(b);
      setToast(extra.isActive === true ? 'The bot is live on WhatsApp' : extra.isActive === false ? 'The bot is off' : 'Saved');
      api<BotNumber[]>('/bots/numbers').then(setNumbers);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function addStep(type: BotNodeType) {
    setAddAnchor(null);
    const sid = `s${Date.now().toString(36)}`;
    edit({ ...flow!, nodes: [...flow!.nodes, newStep(type, sid)] });
    setOpen(sid);
    setTab('steps');
  }

  function move(i: number, dir: -1 | 1) {
    const nodes = [...flow!.nodes];
    [nodes[i], nodes[i + dir]] = [nodes[i + dir], nodes[i]];
    edit({ ...flow!, nodes });
  }

  async function deleteBot() {
    try {
      await api(`/bots/${id}`, { method: 'DELETE' });
      router.push('/bots');
    } catch (e) {
      setError((e as Error).message);
      setRemoveBot(false);
    }
  }

  const number = numbers.find((n) => n.id === numberId);
  const takenBy = number?.botId && number.botId !== bot.id ? number.botName : null;

  return (
    <>
      <Typography component={Link} href="/bots" variant="body2" sx={{ color: 'text.secondary', textDecoration: 'none' }}>
        Bot Studio
      </Typography>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 2, mt: 1, mb: 2 }}>
        <TextField
          value={name}
          onChange={(e) => {
            setName(e.target.value.slice(0, 120));
            setDirty(true);
          }}
          variant="standard"
          aria-label="Bot name"
          slotProps={{ input: { disableUnderline: !dirty, sx: { fontSize: '1.75rem', fontWeight: 650 } } }}
          sx={{ flex: '1 1 260px', minWidth: 0 }}
        />
        <TextField
          select
          label="WhatsApp number"
          value={numberId}
          onChange={(e) => {
            setNumberId(e.target.value);
            setDirty(true);
          }}
          size="small"
          sx={{ minWidth: 240 }}
          disabled={bot.isActive}
          helperText={bot.isActive ? 'Turn the bot off to change' : takenBy ? `"${takenBy}" is live on this number` : ' '}
        >
          <MenuItem value="">Not on a number</MenuItem>
          {numbers.map((n) => (
            <MenuItem key={n.id} value={n.id}>
              {n.brandName ?? n.label}, {formatPhone(n.phoneNumber)}
            </MenuItem>
          ))}
        </TextField>
        <FormControlLabel
          control={<Switch checked={bot.isActive} onChange={(e) => save({ isActive: e.target.checked })} disabled={busy} />}
          label={bot.isActive ? 'Live' : 'Off'}
          sx={{ mb: 2.5 }}
        />
        <Button variant="contained" onClick={() => save()} disabled={!dirty || busy} sx={{ mb: 2.5 }}>
          {dirty ? 'Save changes' : 'Saved'}
        </Button>
      </Box>

      {numbers.length === 0 && (
        <Alert severity="info" sx={{ mb: 2 }} action={<Button component={Link} href="/campaigns/branded/onboarding" color="inherit" size="small">Onboarding form</Button>}>
          Bots answer on your own WhatsApp number. Get one through the onboarding form; until then you can build and test
          the bot here.
        </Alert>
      )}
      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError('')}>
          {error}
        </Alert>
      )}
      {!dirty && bot.problems.length > 0 && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          <Typography variant="body2" sx={{ fontWeight: 600, mb: 0.5 }}>
            Fix before going live:
          </Typography>
          {bot.problems.slice(0, 6).map((p) => (
            <Typography key={p} variant="body2">
              {p}
            </Typography>
          ))}
        </Alert>
      )}
      {bot.isActive && dirty && (
        <Alert severity="info" sx={{ mb: 2 }}>
          The bot is live: changes reach WhatsApp when you save.
        </Alert>
      )}

      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: 'minmax(0, 1fr) 360px' }, gap: 2.5, alignItems: 'start' }}>
        <Box sx={{ minWidth: 0 }}>
          <Tabs value={tab} onChange={(_, v) => setTab(v)} variant="scrollable" sx={{ mb: 2, borderBottom: 1, borderColor: 'divider' }}>
            <Tab value="steps" label={`Steps (${flow.nodes.length})`} />
            <Tab value="keywords" label="Keywords" />
            <Tab value="ai" label="AI answers" />
            <Tab value="chats" label="Chats" />
          </Tabs>

          {tab === 'steps' && (
            <Box sx={{ display: 'grid', gap: 1.25 }}>
              {flow.nodes.map((n, i) => (
                <StepCard
                  key={n.id}
                  node={n}
                  index={i}
                  count={flow.nodes.length}
                  nodes={flow.nodes}
                  open={open === n.id}
                  isStart={starts.has(n.id)}
                  onToggle={() => setOpen((o) => (o === n.id ? null : n.id))}
                  onChange={(node) => edit({ ...flow, nodes: flow.nodes.map((x) => (x.id === node.id ? node : x)) })}
                  onMove={(dir) => move(i, dir)}
                  onDelete={() => setDeleting(n)}
                />
              ))}
              <Box>
                <Button variant="outlined" startIcon={<Add />} onClick={(e) => setAddAnchor(e.currentTarget)}>
                  Add step
                </Button>
                <Menu anchorEl={addAnchor} open={Boolean(addAnchor)} onClose={() => setAddAnchor(null)}>
                  {(Object.keys(stepTypes) as BotNodeType[]).map((t) => (
                    <MenuItem key={t} onClick={() => addStep(t)} sx={{ maxWidth: 360 }}>
                      <ListItemText primary={stepTypes[t].label} secondary={stepTypes[t].help} />
                    </MenuItem>
                  ))}
                </Menu>
              </Box>
            </Box>
          )}
          {tab === 'keywords' && <TriggersEditor flow={flow} onChange={edit} />}
          {tab === 'ai' && <AiEditor flow={flow} settings={settings} onChange={edit} />}
          {tab === 'chats' && <Sessions botId={bot.id} botName={bot.name} nodes={flow.nodes} />}

          {!bot.isActive && (
            <Box sx={{ mt: 4 }}>
              <Button color="error" onClick={() => setRemoveBot(true)}>
                Delete this bot
              </Button>
            </Box>
          )}
        </Box>

        <Box sx={{ position: { lg: 'sticky' }, top: { lg: 84 } }}>
          <TestChat flow={flow} title={number?.brandName ?? name} />
        </Box>
      </Box>

      <Dialog open={Boolean(deleting)} onClose={() => setDeleting(null)} maxWidth="xs" fullWidth>
        <DialogTitle>Delete &quot;{deleting?.name}&quot;?</DialogTitle>
        <DialogContent>
          <Typography>Buttons, keywords and steps that lead here will lead nowhere until you point them somewhere else.</Typography>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setDeleting(null)}>Keep</Button>
          <Button
            color="error"
            variant="contained"
            onClick={() => {
              edit(unlink(flow, deleting!.id));
              setDeleting(null);
            }}
          >
            Delete step
          </Button>
        </DialogActions>
      </Dialog>
      <Dialog open={removeBot} onClose={() => setRemoveBot(false)} maxWidth="xs" fullWidth>
        <DialogTitle>Delete {bot.name}?</DialogTitle>
        <DialogContent>
          <Typography>The bot and its saved chats and answers are deleted. Messages in Incoming messages stay.</Typography>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setRemoveBot(false)}>Keep</Button>
          <Button color="error" variant="contained" onClick={deleteBot}>
            Delete bot
          </Button>
        </DialogActions>
      </Dialog>
      <Snackbar open={Boolean(toast)} autoHideDuration={4000} onClose={() => setToast('')} message={toast} anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }} />
    </>
  );
}
