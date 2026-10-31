'use client';
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  MenuItem,
  Stack,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material';
import { FormEvent, useEffect, useState } from 'react';
import { Account, api, TreeNode } from '@/lib/api';
import { typeLabel } from '@/lib/format';

type Mode = { kind: 'create'; defaultType: 'RESELLER' | 'CUSTOMER' } | { kind: 'edit'; account: Account };

interface Props {
  open: boolean;
  mode: Mode;
  myAccountId: string;
  parents: TreeNode[];
  onClose: () => void;
  onSaved: (account: Account, message: string) => void;
}

const empty = {
  type: 'CUSTOMER' as 'RESELLER' | 'CUSTOMER',
  parentId: '',
  username: '',
  name: '',
  password: '',
  email: '',
  phone: '',
  domain: '',
  brandName: '',
  logoUrl: '',
  status: 'ACTIVE' as 'ACTIVE' | 'SUSPENDED',
};

export default function AccountDialog({ open, mode, myAccountId, parents, onClose, onSaved }: Props) {
  const [f, setF] = useState(empty);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const isEdit = mode.kind === 'edit';

  useEffect(() => {
    if (!open) return;
    setError('');
    if (mode.kind === 'edit') {
      const a = mode.account;
      setF({
        ...empty,
        type: a.type === 'RESELLER' ? 'RESELLER' : 'CUSTOMER',
        username: a.username,
        name: a.name,
        email: a.email ?? '',
        phone: a.phone ?? '',
        domain: a.domain ?? '',
        brandName: a.brandName ?? '',
        logoUrl: a.logoUrl ?? '',
        status: a.status,
      });
    } else {
      setF({ ...empty, type: mode.defaultType, parentId: myAccountId });
    }
  }, [open, mode, myAccountId]);

  const set = (k: keyof typeof empty) => (e: { target: { value: string } }) =>
    setF((prev) => ({ ...prev, [k]: e.target.value }));
  const isReseller = f.type === 'RESELLER';

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      if (mode.kind === 'create') {
        const created = await api<Account>('/accounts', {
          method: 'POST',
          body: {
            type: f.type,
            parentId: f.parentId || undefined,
            username: f.username,
            name: f.name,
            password: f.password,
            email: f.email || undefined,
            phone: f.phone || undefined,
            ...(isReseller ? { domain: f.domain || undefined, brandName: f.brandName || undefined } : {}),
          },
        });
        onSaved(created, `${typeLabel[created.type]} ${created.username} added`);
      } else {
        const updated = await api<Account>(`/accounts/${mode.account.id}`, {
          method: 'PATCH',
          body: {
            name: f.name,
            status: f.status,
            email: f.email,
            phone: f.phone,
            ...(isReseller ? { domain: f.domain, brandName: f.brandName, logoUrl: f.logoUrl } : {}),
            ...(f.password ? { password: f.password } : {}),
          },
        });
        onSaved(updated, `${updated.username} saved`);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <form onSubmit={submit} noValidate>
        <DialogTitle>{isEdit ? `Edit ${f.username}` : `Add ${typeLabel[f.type].toLowerCase()}`}</DialogTitle>
        <DialogContent>
          <Stack spacing={2.25} sx={{ pt: 1 }}>
            {error && <Alert severity="error">{error}</Alert>}

            {!isEdit && (
              <>
                <ToggleButtonGroup
                  exclusive
                  value={f.type}
                  onChange={(_, v) => v && setF((p) => ({ ...p, type: v }))}
                  size="small"
                  color="primary"
                  aria-label="Account type"
                >
                  <ToggleButton value="CUSTOMER">Customer</ToggleButton>
                  <ToggleButton value="RESELLER">Reseller</ToggleButton>
                </ToggleButtonGroup>
                <Typography variant="body2" color="text.secondary" sx={{ mt: '8px !important' }}>
                  {isReseller
                    ? 'A reseller can add their own customers and resell under their own brand.'
                    : 'A customer is a business that sends campaigns. It cannot add accounts.'}
                </Typography>

                {parents.length > 1 && (
                  <TextField select label="Add under" value={f.parentId} onChange={set('parentId')}>
                    {parents.map((p) => (
                      <MenuItem key={p.id} value={p.id}>
                        {p.id === myAccountId ? `${p.name} (you)` : `${p.name} (${p.username})`}
                      </MenuItem>
                    ))}
                  </TextField>
                )}
                <TextField
                  label="Username"
                  value={f.username}
                  onChange={set('username')}
                  helperText="Used to log in. Letters, numbers, dot, dash or underscore."
                  autoComplete="off"
                  required
                />
              </>
            )}

            <TextField label="Business name" value={f.name} onChange={set('name')} required />
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
              <TextField label="Email" type="email" value={f.email} onChange={set('email')} fullWidth />
              <TextField label="Phone" value={f.phone} onChange={set('phone')} fullWidth />
            </Stack>

            <TextField
              label={isEdit ? 'New password' : 'Password'}
              type="password"
              value={f.password}
              onChange={set('password')}
              autoComplete="new-password"
              helperText={isEdit ? 'Leave empty to keep the current password' : 'At least 8 characters'}
              required={!isEdit}
            />

            {isEdit && (
              <TextField select label="Status" value={f.status} onChange={set('status')}>
                <MenuItem value="ACTIVE">Active: can log in</MenuItem>
                <MenuItem value="SUSPENDED">Suspended: cannot log in</MenuItem>
              </TextField>
            )}

            {isReseller && (
              <>
                <Divider />
                <Typography variant="h3">White-label branding</Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mt: '4px !important' }}>
                  Their customers log in on this domain and see this name instead of yours. Point the domain to
                  the panel server first.
                </Typography>
                <TextField
                  label="Panel domain"
                  placeholder="panel.theirbrand.com"
                  value={f.domain}
                  onChange={set('domain')}
                />
                <TextField label="Brand name" value={f.brandName} onChange={set('brandName')} />
                {isEdit && (
                  <TextField
                    label="Logo link"
                    placeholder="https://…/logo.png"
                    value={f.logoUrl}
                    onChange={set('logoUrl')}
                  />
                )}
              </>
            )}
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="contained" disabled={busy}>
            {isEdit ? 'Save changes' : `Add ${typeLabel[f.type].toLowerCase()}`}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}
