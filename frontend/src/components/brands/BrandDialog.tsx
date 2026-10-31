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
  MenuItem,
  TextField,
  Typography,
} from '@mui/material';
import { FormEvent, useEffect, useState } from 'react';
import ImageUpload, { Uploaded } from '@/components/campaigns/ImageUpload';
import { api, Brand, BrandForm, TreeNode } from '@/lib/api';
import { useAuth } from '@/lib/auth';

const empty: BrandForm = {
  organizationName: '',
  displayName: '',
  category: '',
  description: '',
  website: '',
  email: '',
  phoneNumber: '',
  address: '',
  taxId: '',
  contactName: '',
};

/** The onboarding form: a new brand, or fixing one that was sent back. */
export default function BrandDialog({
  open,
  brand,
  onClose,
  onSaved,
}: {
  open: boolean;
  brand: Brand | null;
  onClose: () => void;
  onSaved: (b: Brand) => void;
}) {
  const { me } = useAuth();
  const isCustomer = me?.account.type === 'CUSTOMER';
  const [form, setForm] = useState<BrandForm>(empty);
  const [logo, setLogo] = useState<Uploaded | null>(null);
  const [categories, setCategories] = useState<string[]>([]);
  const [accounts, setAccounts] = useState<TreeNode[]>([]);
  const [account, setAccount] = useState<TreeNode | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setError('');
    api<string[]>('/brands/categories').then(setCategories);
    if (brand) {
      const { organizationName, displayName, category, description, website, email, address, taxId, contactName } = brand;
      setForm({
        organizationName,
        displayName,
        category,
        description: description ?? '',
        website: website ?? '',
        email,
        phoneNumber: `+${brand.phoneNumber}`,
        address,
        taxId: taxId ?? '',
        contactName,
      });
      setLogo(brand.logoMediaId && brand.logoUrl ? { id: brand.logoMediaId, url: brand.logoUrl, name: 'Current logo' } : null);
    } else {
      setForm(empty);
      setLogo(null);
    }
    if (!isCustomer) {
      api<TreeNode[]>('/accounts/tree').then((t) => {
        const choices = t.filter((n) => n.type !== 'ADMIN');
        setAccounts(choices);
        setAccount(choices.find((n) => n.id === (brand?.accountId ?? '')) ?? null);
      });
    }
  }, [open, brand, isCustomer]);

  const set = (k: keyof BrandForm) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!isCustomer && !account) return setError('Pick the customer this brand is for');
    setBusy(true);
    setError('');
    try {
      const body = { ...form, accountId: isCustomer ? undefined : account!.id, logoMediaId: logo?.id };
      const saved = await api<Brand>(brand ? `/brands/${brand.id}` : '/brands', { method: brand ? 'PUT' : 'POST', body });
      onSaved(saved);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth component="form" onSubmit={submit}>
      <DialogTitle>{brand ? 'Fix and send again' : 'Onboarding form'}</DialogTitle>
      <DialogContent>
        <Typography color="text.secondary" sx={{ mb: 2.5, maxWidth: '70ch' }}>
          These details go to WhatsApp to set up the business number. Use the registered business name and a number
          that is not active on the WhatsApp app (or that you are ready to move).
        </Typography>
        {brand?.status === 'REJECTED' && brand.reviewNote && (
          <Alert severity="warning" sx={{ mb: 2 }}>
            To fix: {brand.reviewNote}
          </Alert>
        )}
        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 2 }}>
          {!isCustomer && (
            <Autocomplete
              sx={{ gridColumn: '1 / -1' }}
              options={accounts}
              value={account}
              onChange={(_, v) => setAccount(v)}
              getOptionLabel={(o) => `${o.name} (${o.username})`}
              renderInput={(p) => <TextField {...p} label="Customer" required />}
            />
          )}
          <TextField label="Registered business name" value={form.organizationName} onChange={set('organizationName')} required />
          <TextField
            label="Display name on WhatsApp"
            value={form.displayName}
            onChange={set('displayName')}
            helperText="Should match or clearly relate to the business name"
            required
          />
          <TextField select label="Category" value={form.category} onChange={set('category')} required>
            {categories.map((c) => (
              <MenuItem key={c} value={c}>
                {c}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            label="WhatsApp number to use"
            value={form.phoneNumber}
            onChange={set('phoneNumber')}
            placeholder="+91 94470 12345"
            helperText="Include the country code"
            required
          />
          <TextField label="Website" value={form.website} onChange={set('website')} placeholder="https://www.example.com" />
          <TextField label="Business email" type="email" value={form.email} onChange={set('email')} required />
          <TextField label="Contact person" value={form.contactName} onChange={set('contactName')} required />
          <TextField label="GST number" value={form.taxId} onChange={set('taxId')} />
          <TextField label="Business address" value={form.address} onChange={set('address')} multiline minRows={2} required sx={{ gridColumn: '1 / -1' }} />
          <TextField
            label="About the business"
            value={form.description}
            onChange={set('description')}
            multiline
            minRows={2}
            sx={{ gridColumn: '1 / -1' }}
            helperText="Shown on the WhatsApp business profile"
            slotProps={{ htmlInput: { maxLength: 512 } }}
          />
          <Box sx={{ gridColumn: '1 / -1' }}>
            <Typography variant="body2" sx={{ fontWeight: 600, mb: 1 }}>
              Logo (profile photo)
            </Typography>
            <ImageUpload value={logo} onChange={setLogo} />
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.75 }}>
              Square image works best, at least 640 × 640 pixels.
            </Typography>
          </Box>
        </Box>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose}>Cancel</Button>
        <Button type="submit" variant="contained" disabled={busy}>
          {busy ? 'Sending…' : brand ? 'Send again' : 'Submit'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
