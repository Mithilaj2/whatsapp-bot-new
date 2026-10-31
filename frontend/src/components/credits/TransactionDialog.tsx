'use client';
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material';
import { FormEvent, useEffect, useMemo, useState } from 'react';
import { api, Balance, Country, Page, Service, TreeNode } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatNumber, serviceLabel, typeLabel } from '@/lib/format';
import { brand } from '@/lib/theme';

interface Props {
  open: boolean;
  onClose: () => void;
  onDone: (message: string) => void;
}

/** Balance of one account for one service + country (0 if none). */
async function balanceOf(accountId: string, service: Service, countryCode: string) {
  const res = await api<Page<Balance>>('/credits/balances', {
    query: { accountId, service, pageSize: 200 },
  });
  return res.items.find((b) => b.countryCode === countryCode)?.balance ?? 0;
}

export default function TransactionDialog({ open, onClose, onDone }: Props) {
  const { me } = useAuth();
  const isAdmin = me?.account.type === 'ADMIN';

  const [targets, setTargets] = useState<TreeNode[]>([]);
  const [countries, setCountries] = useState<Country[]>([]);
  const [target, setTarget] = useState<TreeNode | null>(null);
  const [service, setService] = useState<Service>('PREMIUM');
  const [direction, setDirection] = useState<'GIVE' | 'TAKE'>('GIVE');
  const [country, setCountry] = useState<Country | null>(null);
  const [amount, setAmount] = useState('');
  const [remarks, setRemarks] = useState('');
  const [available, setAvailable] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open || !me) return;
    setTarget(null);
    setAmount('');
    setRemarks('');
    setDirection('GIVE');
    setError('');
    // Admin can credit anyone below; resellers only their direct accounts
    api<TreeNode[]>('/accounts/tree').then((nodes) =>
      setTargets(
        nodes.filter((n) => n.id !== me.account.id && (isAdmin || n.parentId === me.account.id)),
      ),
    );
    api<Page<Country>>('/countries', { query: { status: 'active', pageSize: 200 } }).then((r) => {
      setCountries(r.items);
      setCountry((c) => c ?? r.items.find((x) => x.code === 'IN') ?? r.items[0] ?? null);
    });
  }, [open, me, isAdmin]);

  // Who the credits come from: me when giving (admin creates them), the account when taking back
  const sourceId = direction === 'GIVE' ? (isAdmin ? null : me?.account.id) : target?.id;
  useEffect(() => {
    setAvailable(null);
    if (!sourceId || !country) return;
    balanceOf(sourceId, service, country.code).then(setAvailable).catch(() => setAvailable(null));
  }, [sourceId, service, country]);

  const n = Number(amount);
  const validAmount = Number.isInteger(n) && n > 0;
  const tooMuch = validAmount && available !== null && n > available;

  const summary = useMemo(() => {
    if (!target || !country || !validAmount) return '';
    const what = `${formatNumber(n)} ${serviceLabel[service]} credits (${country.name})`;
    if (direction === 'GIVE') return isAdmin ? `Add ${what} to ${target.name}` : `Give ${what} to ${target.name}`;
    return isAdmin ? `Remove ${what} from ${target.name}` : `Take back ${what} from ${target.name}`;
  }, [target, country, validAmount, n, service, direction, isAdmin]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!target || !country) return;
    setBusy(true);
    setError('');
    try {
      await api('/credits/transactions', {
        method: 'POST',
        body: { accountId: target.id, service, countryCode: country.code, direction, amount: n, remarks },
      });
      onDone(`Done: ${summary.charAt(0).toLowerCase()}${summary.slice(1)}`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <form onSubmit={submit}>
        <DialogTitle>New transaction</DialogTitle>
        <DialogContent>
          <Stack spacing={2.25} sx={{ pt: 1 }}>
            {error && <Alert severity="error">{error}</Alert>}

            <ToggleButtonGroup
              exclusive
              size="small"
              color="primary"
              value={direction}
              onChange={(_, v) => v && setDirection(v)}
              aria-label="Direction"
            >
              <ToggleButton value="GIVE">{isAdmin ? 'Add credits' : 'Give credits'}</ToggleButton>
              <ToggleButton value="TAKE">{isAdmin ? 'Remove credits' : 'Take back'}</ToggleButton>
            </ToggleButtonGroup>

            <Autocomplete
              options={targets}
              value={target}
              onChange={(_, v) => setTarget(v)}
              getOptionLabel={(o) => `${o.name} (${o.username})`}
              renderOption={(props, o) => (
                <li {...props} key={o.id}>
                  <Box>
                    <Typography>{o.name}</Typography>
                    <Typography variant="body2" color="text.secondary">
                      {o.username}, {typeLabel[o.type].toLowerCase()}
                    </Typography>
                  </Box>
                </li>
              )}
              renderInput={(params) => (
                <TextField
                  {...params}
                  label={direction === 'GIVE' ? 'To' : 'From'}
                  helperText={isAdmin ? undefined : 'Only accounts directly under you'}
                  required
                />
              )}
              noOptionsText="No accounts yet. Add one in Resellers & customers."
            />

            <ToggleButtonGroup
              exclusive
              size="small"
              value={service}
              onChange={(_, v) => v && setService(v)}
              aria-label="Service"
            >
              <ToggleButton value="PREMIUM">Premium Campaigns</ToggleButton>
              <ToggleButton value="BRANDED">Branded Campaigns</ToggleButton>
            </ToggleButtonGroup>

            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <Autocomplete
                options={countries}
                value={country}
                onChange={(_, v) => setCountry(v)}
                getOptionLabel={(o) => `${o.name} (+${o.isd})`}
                isOptionEqualToValue={(a, b) => a.id === b.id}
                renderInput={(params) => <TextField {...params} label="Country" required />}
                sx={{ flex: 1 }}
                disableClearable={Boolean(country)}
              />
              <TextField
                label="Credits"
                value={amount}
                onChange={(e) => setAmount(e.target.value.replace(/[^\d]/g, ''))}
                slotProps={{ htmlInput: { inputMode: 'numeric' } }}
                error={tooMuch}
                helperText={
                  available === null
                    ? ' '
                    : `${direction === 'GIVE' ? 'You have' : `${target?.username} has`} ${formatNumber(available)}`
                }
                sx={{ width: { sm: 180 } }}
                required
              />
            </Stack>

            <TextField
              label="Note (optional)"
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
              placeholder="e.g. Invoice 1042, paid by UPI"
              slotProps={{ htmlInput: { maxLength: 200 } }}
            />

            {summary && (
              <Box sx={{ bgcolor: brand.bubble, color: brand.pine, px: 2, py: 1.25, borderRadius: '12px 12px 3px 12px' }}>
                <Typography sx={{ fontWeight: 600 }}>{summary}</Typography>
              </Box>
            )}
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="contained" disabled={busy || !target || !country || !validAmount || tooMuch}>
            {direction === 'GIVE' ? (isAdmin ? 'Add credits' : 'Give credits') : isAdmin ? 'Remove credits' : 'Take back'}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}
