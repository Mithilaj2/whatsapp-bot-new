'use client';
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  MenuItem,
  Stack,
  Switch,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material';
import { FormEvent, useEffect, useState } from 'react';
import { api, SenderNumber, TreeNode } from '@/lib/api';

interface Props {
  open: boolean;
  number: SenderNumber | null;
  onClose: () => void;
  onSaved: (n: SenderNumber, message: string) => void;
}

export default function NumberDialog({ open, number, onClose, onSaved }: Props) {
  const isEdit = Boolean(number);
  const [provider, setProvider] = useState<'META' | 'TEST'>('META');
  const [service, setService] = useState<'PREMIUM' | 'BRANDED'>('PREMIUM');
  const [owner, setOwner] = useState('');
  const [label, setLabel] = useState('');
  const [phone, setPhone] = useState('');
  const [phoneNumberId, setPhoneNumberId] = useState('');
  const [wabaId, setWabaId] = useState('');
  const [token, setToken] = useState('');
  const [rate, setRate] = useState('20');
  const [isDefault, setIsDefault] = useState(true);
  const [active, setActive] = useState(true);
  const [customers, setCustomers] = useState<TreeNode[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setError('');
    setToken('');
    if (number) {
      setLabel(number.label);
      setRate(String(number.ratePerSecond));
      setIsDefault(number.isDefault);
      setActive(number.status === 'ACTIVE');
    } else {
      setProvider('META');
      setService('PREMIUM');
      setOwner('');
      setLabel('');
      setPhone('');
      setPhoneNumberId('');
      setWabaId('');
      setRate('20');
      setIsDefault(true);
      api<TreeNode[]>('/accounts/tree').then((t) => setCustomers(t.filter((n) => n.type === 'CUSTOMER')));
    }
  }, [open, number]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      if (number) {
        const saved = await api<SenderNumber>(`/gateway/numbers/${number.id}`, {
          method: 'PATCH',
          body: {
            label,
            ratePerSecond: Number(rate),
            isDefault,
            status: active ? 'ACTIVE' : 'DISABLED',
            ...(token ? { accessToken: token } : {}),
          },
        });
        onSaved(saved, `${saved.label} saved`);
      } else {
        const saved = await api<SenderNumber>('/gateway/numbers', {
          method: 'POST',
          body: {
            label,
            provider,
            service,
            ownerAccountId: service === 'BRANDED' && owner ? owner : undefined,
            phoneNumber: phone,
            ...(provider === 'META' ? { phoneNumberId, wabaId, ...(token ? { accessToken: token } : {}) } : {}),
            ratePerSecond: Number(rate),
            isDefault,
          },
        });
        onSaved(
          saved,
          saved.lastError ? `${saved.label} added, but WhatsApp reported a problem` : `${saved.label} added and connected`,
        );
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <form onSubmit={submit}>
        <DialogTitle>{isEdit ? `Edit ${number?.label}` : 'Add WhatsApp number'}</DialogTitle>
        <DialogContent>
          <Stack spacing={2.25} sx={{ pt: 1 }}>
            {error && <Alert severity="error">{error}</Alert>}

            {!isEdit && (
              <>
                <ToggleButtonGroup exclusive size="small" color="primary" value={provider} onChange={(_, v) => v && setProvider(v)}>
                  <ToggleButton value="META">WhatsApp (Meta)</ToggleButton>
                  <ToggleButton value="TEST">Test mode</ToggleButton>
                </ToggleButtonGroup>
                <Typography variant="body2" color="text.secondary" sx={{ mt: '8px !important' }}>
                  {provider === 'META'
                    ? 'Copy the IDs from Meta: WhatsApp Manager or your app > WhatsApp > API Setup.'
                    : 'Nothing is really sent. Messages show as sent, delivered and read after a few seconds. Numbers ending in 0000 fail.'}
                </Typography>

                <TextField select label="Used for" value={service} onChange={(e) => setService(e.target.value as 'PREMIUM')}>
                  <MenuItem value="PREMIUM">Premium Campaigns (shared number)</MenuItem>
                  <MenuItem value="BRANDED">Branded Campaigns</MenuItem>
                </TextField>
                {service === 'BRANDED' && (
                  <TextField
                    select
                    label="Belongs to customer"
                    value={owner}
                    onChange={(e) => setOwner(e.target.value)}
                    helperText="Leave empty if any branded customer may use it"
                  >
                    <MenuItem value="">Nobody (shared)</MenuItem>
                    {customers.map((c) => (
                      <MenuItem key={c.id} value={c.id}>
                        {c.name} ({c.username})
                      </MenuItem>
                    ))}
                  </TextField>
                )}
              </>
            )}

            <TextField label="Name in the panel" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Main promotions number" required />

            {!isEdit && (
              <TextField
                label="Phone number"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+1 555 010 0001"
                helperText="With country code"
                required
              />
            )}

            {!isEdit && provider === 'META' && (
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                <TextField label="Phone number ID" value={phoneNumberId} onChange={(e) => setPhoneNumberId(e.target.value)} fullWidth required />
                <TextField label="WhatsApp Business Account ID" value={wabaId} onChange={(e) => setWabaId(e.target.value)} fullWidth required />
              </Stack>
            )}

            {(isEdit ? number?.provider === 'META' : provider === 'META') && (
              <TextField
                label={isEdit ? 'New access token' : 'Access token (optional)'}
                value={token}
                onChange={(e) => setToken(e.target.value)}
                type="password"
                autoComplete="off"
                helperText={
                  isEdit
                    ? `Current: ${number?.accessToken ?? 'platform token'}. Leave empty to keep it.`
                    : 'Leave empty to use the platform token from the server settings. Stored encrypted.'
                }
              />
            )}

            <TextField
              label="Messages per second"
              value={rate}
              onChange={(e) => setRate(e.target.value.replace(/[^\d]/g, ''))}
              helperText="WhatsApp allows about 80 per second per number. Start lower for new numbers."
              sx={{ maxWidth: 260 }}
            />

            <FormControlLabel
              control={<Switch checked={isDefault} onChange={(e) => setIsDefault(e.target.checked)} />}
              label="Default number for this service"
            />
            {isEdit && (
              <FormControlLabel
                control={<Switch checked={active} onChange={(e) => setActive(e.target.checked)} />}
                label={active ? 'On: messages are sent' : 'Off: queued messages from this number will fail'}
              />
            )}
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="contained" disabled={busy}>
            {isEdit ? 'Save changes' : busy ? 'Connecting…' : 'Add number'}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}
