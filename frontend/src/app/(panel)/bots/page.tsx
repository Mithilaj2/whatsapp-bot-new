'use client';
import Add from '@mui/icons-material/Add';
import SmartToyOutlined from '@mui/icons-material/SmartToyOutlined';
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Paper,
  TextField,
  Typography,
} from '@mui/material';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { FormEvent, useEffect, useState } from 'react';
import PageHeader from '@/components/PageHeader';
import { ToneChip } from '@/components/StatusChip';
import { api, Bot, BotListItem, TreeNode } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatDate, formatNumber, formatPhone } from '@/lib/format';
import { brand } from '@/lib/theme';

export default function BotsPage() {
  const { me } = useAuth();
  const [bots, setBots] = useState<BotListItem[] | null>(null);
  const [error, setError] = useState('');
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    api<BotListItem[]>('/bots').then(setBots).catch((e) => setError(e.message));
  }, []);
  const showAccount = me?.account.type !== 'CUSTOMER';

  return (
    <>
      <PageHeader
        title="Bot Studio"
        description="Chatbots that answer on your WhatsApp number: menus, questions, handing over to your team, and AI answers from your business information."
        actions={
          <Button variant="contained" startIcon={<Add />} onClick={() => setCreating(true)}>
            New bot
          </Button>
        }
      />
      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

      {bots && bots.length === 0 && (
        <Paper variant="outlined" sx={{ p: { xs: 3, sm: 5 }, display: 'grid', gap: 1.5, justifyItems: 'center', textAlign: 'center' }}>
          <Box sx={{ width: 56, height: 56, borderRadius: '16px 16px 4px 16px', bgcolor: brand.bubble, color: brand.pine, display: 'grid', placeItems: 'center' }}>
            <SmartToyOutlined />
          </Box>
          <Typography variant="h3">Make your first bot</Typography>
          <Typography color="text.secondary" sx={{ maxWidth: '56ch' }}>
            It starts with a ready-made welcome menu, a callback form and a hand-over to your team. Change the words,
            test it here, then switch it on.
          </Typography>
          <Button variant="contained" onClick={() => setCreating(true)} sx={{ mt: 1 }}>
            New bot
          </Button>
        </Paper>
      )}

      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: 'repeat(2, 1fr)', xl: 'repeat(3, 1fr)' }, gap: 2 }}>
        {bots?.map((b) => (
          <Paper
            key={b.id}
            variant="outlined"
            component={Link}
            href={`/bots/${b.id}`}
            sx={{
              p: 2.5,
              display: 'grid',
              gap: 1.5,
              alignContent: 'start',
              color: 'inherit',
              textDecoration: 'none',
              '&:hover': { borderColor: brand.action },
              '&:focus-visible': { outline: `2px solid ${brand.action}`, outlineOffset: 2 },
            }}
          >
            <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1.5 }}>
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography variant="h3" noWrap>
                  {b.name}
                </Typography>
                <Typography variant="body2" color="text.secondary" noWrap>
                  {b.numberPhone ? `${formatPhone(b.numberPhone)}, ${b.numberLabel}` : 'No WhatsApp number yet'}
                  {showAccount ? ` (${b.accountUsername})` : ''}
                </Typography>
              </Box>
              <ToneChip label={b.isActive ? 'Live' : 'Off'} tone={b.isActive ? 'good' : 'plain'} />
            </Box>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75, minHeight: 24 }}>
              {b.keywords.map((k) => (
                <Chip key={k} size="small" variant="outlined" label={k} />
              ))}
              {b.usesAi && <Chip size="small" label="AI answers" sx={{ bgcolor: '#FBF0DC', color: '#7A4A06' }} />}
            </Box>
            <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', borderTop: 1, borderColor: 'divider', pt: 1.5 }}>
              <Stat label="Chats today" value={b.chatsToday} />
              <Stat label="All chats" value={b.chats} />
              <Stat label="Need your team" value={b.handoffs} warn={b.handoffs > 0} />
            </Box>
            <Typography variant="body2" color="text.secondary">
              {b.steps} steps, changed {formatDate(b.updatedAt)}
            </Typography>
          </Paper>
        ))}
      </Box>

      <NewBotDialog open={creating} onClose={() => setCreating(false)} />
    </>
  );
}

function Stat({ label, value, warn }: { label: string; value: number; warn?: boolean }) {
  return (
    <Box>
      <Typography sx={{ fontSize: '1.25rem', fontWeight: 650, fontVariantNumeric: 'tabular-nums', color: warn ? '#8E2A18' : undefined }}>
        {formatNumber(value)}
      </Typography>
      <Typography variant="body2" color="text.secondary">
        {label}
      </Typography>
    </Box>
  );
}

function NewBotDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { me } = useAuth();
  const router = useRouter();
  const isCustomer = me?.account.type === 'CUSTOMER';
  const [name, setName] = useState('');
  const [accounts, setAccounts] = useState<TreeNode[]>([]);
  const [account, setAccount] = useState<TreeNode | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setName('');
    setError('');
    if (!isCustomer) {
      api<TreeNode[]>('/accounts/tree').then((t) => {
        setAccounts(t);
        setAccount(t.find((n) => n.id === me?.account.id) ?? null);
      });
    }
  }, [open, isCustomer, me]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const b = await api<Bot>('/bots', { method: 'POST', body: { name, accountId: isCustomer ? undefined : account?.id } });
      router.push(`/bots/${b.id}`);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth component="form" onSubmit={submit}>
      <DialogTitle>New bot</DialogTitle>
      <DialogContent sx={{ display: 'grid', gap: 2, pt: '8px !important' }}>
        {error && <Alert severity="error">{error}</Alert>}
        <TextField label="Bot name" value={name} onChange={(e) => setName(e.target.value)} placeholder="Shop assistant" autoFocus required />
        {!isCustomer && (
          <Autocomplete
            options={accounts}
            value={account}
            onChange={(_, v) => setAccount(v)}
            getOptionLabel={(o) => (o.id === me?.account.id ? `${o.name} (you)` : `${o.name} (${o.username})`)}
            renderInput={(p) => <TextField {...p} label="For account" />}
            disableClearable={Boolean(account)}
          />
        )}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose}>Cancel</Button>
        <Button type="submit" variant="contained" disabled={busy}>
          Create
        </Button>
      </DialogActions>
    </Dialog>
  );
}
