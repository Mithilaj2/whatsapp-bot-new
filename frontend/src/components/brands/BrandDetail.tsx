'use client';
import {
  Alert,
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
import { useEffect, useState } from 'react';
import { ToneChip } from '@/components/StatusChip';
import { api, Brand, SenderNumber } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatDate, formatPhone } from '@/lib/format';
import { brand as palette } from '@/lib/theme';
import { brandStatus } from './status';

/** A brand's details. The platform admin approves it here, linking the WhatsApp number. */
export default function BrandDetail({
  brand,
  onClose,
  onEdit,
  onChanged,
}: {
  brand: Brand | null;
  onClose: () => void;
  onEdit: (b: Brand) => void;
  onChanged: (b: Brand) => void;
}) {
  const { me } = useAuth();
  const isAdmin = me?.account.type === 'ADMIN';
  const [numbers, setNumbers] = useState<SenderNumber[]>([]);
  const [numberId, setNumberId] = useState('');
  const [note, setNote] = useState('');
  const [mode, setMode] = useState<'' | 'APPROVE' | 'REJECT'>('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setMode('');
    setNote('');
    setError('');
    if (!brand || !isAdmin) return;
    api<SenderNumber[]>('/gateway/numbers').then((all) => {
      // Branded numbers that are free or already this customer's; the brand's own number first
      const usable = all.filter((n) => n.service === 'BRANDED' && (!n.ownerAccountId || n.ownerAccountId === brand.accountId));
      usable.sort((a, b) => Number(b.phoneNumber === brand.phoneNumber) - Number(a.phoneNumber === brand.phoneNumber));
      setNumbers(usable);
      setNumberId(usable.find((n) => n.phoneNumber === brand.phoneNumber)?.id ?? '');
    });
  }, [brand, isAdmin]);

  if (!brand) return null;
  const st = brandStatus[brand.status];

  async function review() {
    setBusy(true);
    setError('');
    try {
      const b = await api<Brand>(`/brands/${brand!.id}/review`, {
        method: 'POST',
        body: { decision: mode, note: note || undefined, senderNumberId: mode === 'APPROVE' ? numberId : undefined },
      });
      onChanged(b);
      setMode('');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const rows: [string, string][] = [
    ['Business name', brand.organizationName],
    ['Category', brand.category],
    ['WhatsApp number', formatPhone(brand.phoneNumber)],
    ['Email', brand.email],
    ['Contact person', brand.contactName],
    ['Website', brand.website || '—'],
    ['GST number', brand.taxId || '—'],
    ['Address', brand.address],
    ['About', brand.description || '—'],
    ['Account', `${brand.accountName} (${brand.accountUsername})`],
    ['Submitted', formatDate(brand.createdAt)],
  ];
  if (brand.reviewedAt) rows.push(['Reviewed', `${formatDate(brand.reviewedAt)}${brand.reviewedBy ? ` by ${brand.reviewedBy}` : ''}`]);

  return (
    <Dialog open onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
        {brand.logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={brand.logoUrl} alt="" width={40} height={40} style={{ borderRadius: '50%', objectFit: 'cover', background: palette.surface }} />
        ) : null}
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="h3" noWrap>
            {brand.displayName}
          </Typography>
        </Box>
        <ToneChip label={st.label} tone={st.tone} />
      </DialogTitle>
      <DialogContent>
        {brand.status === 'APPROVED' && brand.number && (
          <Alert severity="success" sx={{ mb: 2 }}>
            Live on {formatPhone(brand.number.phoneNumber)}. Branded campaigns can be sent from this number.
          </Alert>
        )}
        {brand.status === 'SUBMITTED' && !isAdmin && (
          <Alert severity="info" sx={{ mb: 2 }}>
            Your provider is setting up this number with WhatsApp. This usually takes 1 to 3 working days.
          </Alert>
        )}
        {brand.status === 'REJECTED' && (
          <Alert severity="warning" sx={{ mb: 2 }}>
            Sent back: {brand.reviewNote}
          </Alert>
        )}
        {rows.map(([k, v]) => (
          <Box key={k} sx={{ display: 'grid', gridTemplateColumns: '140px 1fr', gap: 1, py: 0.75, borderTop: 1, borderColor: 'divider' }}>
            <Typography variant="body2" color="text.secondary">
              {k}
            </Typography>
            <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
              {v}
            </Typography>
          </Box>
        ))}

        {isAdmin && brand.status !== 'APPROVED' && mode && (
          <Box sx={{ mt: 2.5, p: 2, borderRadius: 2, bgcolor: palette.surface, display: 'grid', gap: 2 }}>
            {mode === 'APPROVE' ? (
              <>
                <Typography variant="body2">
                  Register {formatPhone(brand.phoneNumber)} in Meta first, add it under WhatsApp numbers as a Branded
                  number, then pick it here.
                </Typography>
                <TextField select label="WhatsApp number" value={numberId} onChange={(e) => setNumberId(e.target.value)} required>
                  {numbers.length === 0 && (
                    <MenuItem value="" disabled>
                      No free Branded numbers. Add one first.
                    </MenuItem>
                  )}
                  {numbers.map((n) => (
                    <MenuItem key={n.id} value={n.id}>
                      {n.label}, {formatPhone(n.phoneNumber)}
                    </MenuItem>
                  ))}
                </TextField>
              </>
            ) : (
              <TextField
                label="What should the customer fix?"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                multiline
                minRows={2}
                required
                autoFocus
              />
            )}
            {error && <Alert severity="error">{error}</Alert>}
          </Box>
        )}
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2 }}>
        <Button onClick={onClose}>Close</Button>
        {!isAdmin && brand.status !== 'APPROVED' && (
          <Button variant="outlined" onClick={() => onEdit(brand)}>
            Edit details
          </Button>
        )}
        {isAdmin && brand.status !== 'APPROVED' && !mode && (
          <>
            {brand.status === 'SUBMITTED' && (
              <Button color="error" onClick={() => setMode('REJECT')}>
                Send back
              </Button>
            )}
            <Button variant="contained" onClick={() => setMode('APPROVE')}>
              Approve
            </Button>
          </>
        )}
        {mode && (
          <>
            <Button onClick={() => setMode('')}>Back</Button>
            <Button
              variant="contained"
              color={mode === 'REJECT' ? 'error' : 'primary'}
              disabled={busy || (mode === 'APPROVE' ? !numberId : !note.trim())}
              onClick={review}
            >
              {mode === 'APPROVE' ? 'Approve and link number' : 'Send back'}
            </Button>
          </>
        )}
      </DialogActions>
    </Dialog>
  );
}
