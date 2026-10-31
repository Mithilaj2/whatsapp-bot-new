'use client';
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  Paper,
  Snackbar,
  Switch,
  TextField,
  Typography,
} from '@mui/material';
import NextLink from 'next/link';
import { FormEvent, useCallback, useEffect, useState } from 'react';
import PageHeader from '@/components/PageHeader';
import { ToneChip } from '@/components/StatusChip';
import { api, AutoResponderRow } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatDate, formatPhone } from '@/lib/format';
import { brand } from '@/lib/theme';

export default function AutoResponderPage() {
  const { me } = useAuth();
  const showAccount = me?.account.type !== 'CUSTOMER';
  const [rows, setRows] = useState<AutoResponderRow[] | null>(null);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<AutoResponderRow | null>(null);
  const [toast, setToast] = useState('');

  const load = useCallback(() => {
    api<AutoResponderRow[]>('/auto-responders').then(setRows).catch((e) => setError(e.message));
  }, []);
  useEffect(load, [load]);

  return (
    <>
      <PageHeader
        title="Auto responder"
        description="Replies sent automatically when someone writes to your WhatsApp number. They are free: no credits are used."
      />
      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

      {rows && rows.length === 0 && (
        <Paper variant="outlined" sx={{ p: 4, textAlign: 'center' }}>
          <Typography variant="h3">No WhatsApp number yet</Typography>
          <Typography color="text.secondary" sx={{ mt: 0.5, mb: 2 }}>
            Auto replies work on your own number. Fill in the onboarding form to get one.
          </Typography>
          <Button component={NextLink} href="/campaigns/branded/onboarding" variant="contained">
            Onboarding form
          </Button>
        </Paper>
      )}

      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: 'repeat(2, 1fr)' }, gap: 2 }}>
        {rows?.map((r) => {
          const on = Boolean(r.responder?.isActive);
          return (
            <Paper key={r.senderNumberId} variant="outlined" sx={{ p: 2.5, display: 'grid', gap: 1.5, alignContent: 'start' }}>
              <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1.5 }}>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography variant="h3" noWrap>
                    {r.brandName ?? r.label}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {formatPhone(r.phoneNumber)}
                    {r.service === 'PREMIUM' ? ', shared Premium number' : showAccount && r.accountUsername ? `, ${r.accountUsername}` : ''}
                  </Typography>
                </Box>
                <ToneChip label={on ? 'On' : 'Off'} tone={on ? 'good' : 'plain'} />
              </Box>
              <Reply title="When someone writes" text={r.responder?.normalMessage} hint="Once a day per person" />
              <Reply title="When someone replies STOP" text={r.responder?.optOutMessage} />
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1 }}>
                <Typography variant="body2" color="text.secondary">
                  {r.responder ? `Changed ${formatDate(r.responder.updatedAt)}` : 'Not set up'}
                </Typography>
                <Button variant={r.responder ? 'outlined' : 'contained'} onClick={() => setEditing(r)}>
                  {r.responder ? 'Edit' : 'Set up'}
                </Button>
              </Box>
            </Paper>
          );
        })}
      </Box>

      <EditDialog
        row={editing}
        onClose={() => setEditing(null)}
        onSaved={(msg) => {
          setEditing(null);
          setToast(msg);
          load();
        }}
      />
      <Snackbar open={Boolean(toast)} autoHideDuration={4000} onClose={() => setToast('')} message={toast} anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }} />
    </>
  );
}

function Reply({ title, text, hint }: { title: string; text?: string | null; hint?: string }) {
  return (
    <Box>
      <Typography variant="body2" sx={{ fontWeight: 600, mb: 0.5 }}>
        {title}
        {hint && (
          <Typography component="span" variant="body2" color="text.secondary" sx={{ fontWeight: 400 }}>
            {' '}
            ({hint})
          </Typography>
        )}
      </Typography>
      {text ? (
        <Box
          sx={{
            bgcolor: brand.bubble,
            borderRadius: '12px 12px 3px 12px',
            px: 1.5,
            py: 1,
            whiteSpace: 'pre-wrap',
            fontSize: '0.875rem',
            maxWidth: '52ch',
          }}
        >
          {text}
        </Box>
      ) : (
        <Typography variant="body2" color="text.secondary">
          No reply
        </Typography>
      )}
    </Box>
  );
}

function EditDialog({ row, onClose, onSaved }: { row: AutoResponderRow | null; onClose: () => void; onSaved: (msg: string) => void }) {
  const [name, setName] = useState('');
  const [normal, setNormal] = useState('');
  const [optOut, setOptOut] = useState('');
  const [active, setActive] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!row) return;
    const r = row.responder;
    setName(r?.name ?? 'Auto reply');
    setNormal(r?.normalMessage ?? '');
    setOptOut(r?.optOutMessage ?? 'You will not receive offers from us on WhatsApp again.');
    setActive(r?.isActive ?? true);
    setError('');
  }, [row]);

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api(`/auto-responders/${row!.senderNumberId}`, {
        method: 'PUT',
        body: { name, normalMessage: normal, optOutMessage: optOut, isActive: active },
      });
      onSaved(active ? 'Auto replies are on' : 'Auto replies are off');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={Boolean(row)} onClose={onClose} maxWidth="sm" fullWidth component="form" onSubmit={save}>
      <DialogTitle>Auto replies for {row?.brandName ?? row?.label}</DialogTitle>
      <DialogContent sx={{ display: 'grid', gap: 2.25, pt: '8px !important' }}>
        {error && <Alert severity="error">{error}</Alert>}
        <TextField label="Name" value={name} onChange={(e) => setName(e.target.value)} helperText="Only you see this" required />
        <TextField
          label="When someone writes"
          value={normal}
          onChange={(e) => setNormal(e.target.value)}
          multiline
          minRows={3}
          placeholder="Thanks for messaging us! We reply between 9 am and 9 pm."
          helperText="Sent at most once a day to each person. Leave empty for no reply."
          slotProps={{ htmlInput: { maxLength: 1000 } }}
        />
        <TextField
          label="When someone replies STOP"
          value={optOut}
          onChange={(e) => setOptOut(e.target.value)}
          multiline
          minRows={2}
          helperText="They are removed from your campaigns either way."
          slotProps={{ htmlInput: { maxLength: 1000 } }}
        />
        <FormControlLabel control={<Switch checked={active} onChange={(e) => setActive(e.target.checked)} />} label="Auto replies on" />
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose}>Cancel</Button>
        <Button type="submit" variant="contained" disabled={busy}>
          Save
        </Button>
      </DialogActions>
    </Dialog>
  );
}
