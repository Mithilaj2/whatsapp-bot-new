'use client';
import Send from '@mui/icons-material/Send';
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Checkbox,
  FormControlLabel,
  Link as MuiLink,
  MenuItem,
  Paper,
  Snackbar,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material';
import NextLink from 'next/link';
import { useRouter } from 'next/navigation';
import { FormEvent, useEffect, useMemo, useState } from 'react';
import PageHeader from '@/components/PageHeader';
import WhatsAppPreview from '@/components/WhatsAppPreview';
import { ApprovedBrand, api, CampaignDetail, RecipientCheck, Service, TemplateButton, TreeNode } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatNumber, formatPhone } from '@/lib/format';
import { brand } from '@/lib/theme';
import ImageUpload, { Uploaded } from './ImageUpload';

const MESSAGE_MAX = 850;

export default function Composer({ service }: { service: Service }) {
  const { me } = useAuth();
  const router = useRouter();
  const branded = service === 'BRANDED';
  const base = `/campaigns/${service.toLowerCase()}`;
  const [brands, setBrands] = useState<ApprovedBrand[] | null>(null);
  const [brandId, setBrandId] = useState('');
  const [accounts, setAccounts] = useState<TreeNode[]>([]);
  const [account, setAccount] = useState<TreeNode | null>(null);
  const [title, setTitle] = useState('');
  const [numbers, setNumbers] = useState('');
  const [check, setCheck] = useState<RecipientCheck | null>(null);
  const [checkError, setCheckError] = useState('');
  const [image, setImage] = useState<Uploaded | null>(null);
  const [message, setMessage] = useState('');
  const [callNumber, setCallNumber] = useState('');
  const [visitUrl, setVisitUrl] = useState('');
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState('');

  const isCustomer = me?.account.type === 'CUSTOMER';

  useEffect(() => {
    if (!me) return;
    api<{ message?: string; callNumber?: string; visitUrl?: string }>('/campaigns/defaults').then((d) => {
      setMessage((m) => m || d.message || '');
      setCallNumber((c) => c || d.callNumber || '');
      setVisitUrl((v) => v || d.visitUrl || '');
    });
    if (!isCustomer) {
      api<TreeNode[]>('/accounts/tree').then((t) => {
        setAccounts(t);
        setAccount(t.find((n) => n.id === me.account.id) ?? null);
      });
    }
  }, [me, isCustomer]);

  const accountId = account?.id;

  // Branded: the brands this account can send from
  useEffect(() => {
    if (!branded || !me) return;
    if (!isCustomer && !accountId) return;
    setBrands(null);
    api<ApprovedBrand[]>('/brands/approved', { query: { accountId } })
      .then((b) => {
        setBrands(b);
        setBrandId(b.length === 1 ? b[0].id : '');
      })
      .catch(() => setBrands([]));
  }, [branded, me, isCustomer, accountId]);

  // Count numbers and credits a moment after typing stops
  useEffect(() => {
    if (!numbers.trim() || (branded && !brandId)) {
      setCheck(null);
      setCheckError('');
      return;
    }
    const t = setTimeout(() => {
      api<RecipientCheck>('/campaigns/check', { method: 'POST', body: { service, brandId: brandId || undefined, numbers, accountId } })
        .then((c) => {
          setCheck(c);
          setCheckError('');
        })
        .catch((e) => setCheckError(e.message));
    }, 600);
    return () => clearTimeout(t);
  }, [numbers, accountId, service, branded, brandId]);

  const buttons: TemplateButton[] = useMemo(() => {
    const b: TemplateButton[] = [];
    if (callNumber.trim()) b.push({ type: 'PHONE_NUMBER', text: 'Call now', phone: callNumber });
    if (visitUrl.trim()) b.push({ type: 'URL', text: 'Visit website', url: visitUrl });
    b.push({ type: 'QUICK_REPLY', text: 'Stop' });
    return b;
  }, [callNumber, visitUrl]);

  async function saveDefaults() {
    try {
      await api('/campaigns/defaults', { method: 'PUT', body: { message, callNumber, visitUrl } });
      setToast('Saved. New campaigns will start with this message, number and link.');
    } catch (e) {
      setToast((e as Error).message);
    }
  }

  const blocker = branded && !brandId
    ? 'Pick a brand'
    : !title.trim()
    ? 'Add a title'
    : !check || check.recipients === 0
      ? 'Add the phone numbers'
      : check.problem
        ? check.problem
        : !check.enoughCredits
          ? 'Not enough credits'
          : !image
            ? 'Upload an image'
            : !message.trim()
              ? 'Write the message'
              : !consent
                ? 'Tick the confirmation box'
                : null;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (blocker) return;
    setBusy(true);
    setError('');
    try {
      const c = await api<CampaignDetail>('/campaigns', {
        method: 'POST',
        body: {
          service,
          brandId: brandId || undefined,
          accountId,
          title,
          numbers,
          mediaId: image!.id,
          message,
          callNumber,
          visitUrl,
          consent,
        },
      });
      router.push(`${base}/reports/${c.id}?new=1`);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  const counters = [
    { label: 'Total', value: check?.total },
    { label: 'Will send', value: check?.recipients, tone: 'good' },
    { label: 'Invalid', value: check ? check.invalid + check.countryOff : undefined, tone: 'bad' },
    { label: 'Duplicates', value: check?.duplicates, tone: 'wait' },
    { label: 'Opted out', value: check?.optedOut, tone: 'wait' },
  ] as const;
  const toneBg = { good: brand.bubble, bad: '#F8E1DC', wait: '#FBF0DC' } as const;

  return (
    <Box component="form" onSubmit={submit}>
      <PageHeader
        title={branded ? 'New Branded campaign' : 'New Premium campaign'}
        description={
          branded
            ? 'Sent from your own WhatsApp number, with your business name and logo. One Branded credit per message.'
            : 'Sent from our shared WhatsApp number. One credit per message.'
        }
        actions={
          <>
            <Button onClick={() => router.push(`${base}/reports`)}>Cancel</Button>
            <Button type="submit" variant="contained" startIcon={<Send />} disabled={Boolean(blocker) || busy}>
              {busy ? 'Submitting…' : check?.isDemo ? 'Send demo' : 'Send campaign'}
            </Button>
          </>
        }
      />
      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      {branded && brands && brands.length === 0 && (
        <Alert
          severity="info"
          sx={{ mb: 2 }}
          action={
            <Button component={NextLink} href={`${base}/onboarding`} color="inherit" size="small">
              Onboarding form
            </Button>
          }
        >
          {isCustomer || account?.id === me?.account.id ? 'You have' : `${account?.name ?? 'This account'} has`} no approved brand yet.
          Fill in the onboarding form; once your number is set up, you can send from it here.
        </Alert>
      )}

      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: {
            xs: '1fr',
            md: [!isCustomer && '280px', branded && '280px', '1fr'].filter(Boolean).join(' '),
          },
          gap: 2,
          mb: 2,
        }}
      >
        {!isCustomer && (
          <Autocomplete
            options={accounts}
            value={account}
            onChange={(_, v) => setAccount(v)}
            getOptionLabel={(o) => (o.id === me?.account.id ? `${o.name} (you)` : `${o.name} (${o.username})`)}
            renderInput={(p) => <TextField {...p} label="Send for account" helperText="Credits are taken from this account" />}
            disableClearable={Boolean(account)}
          />
        )}
        {branded && (
          <TextField
            select
            label="Brand"
            value={brandId}
            onChange={(e) => setBrandId(e.target.value)}
            helperText={brands?.find((b) => b.id === brandId) ? `Sends from ${formatPhone(brands.find((b) => b.id === brandId)!.phoneNumber)}` : 'Your WhatsApp business'}
            disabled={!brands || brands.length === 0}
            required
          >
            {brands?.map((b) => (
              <MenuItem key={b.id} value={b.id}>
                {b.displayName}
              </MenuItem>
            ))}
          </TextField>
        )}
        <TextField label="Campaign title" value={title} onChange={(e) => setTitle(e.target.value)} helperText="Only you see this" required />
      </Box>

      <Paper
        variant="outlined"
        sx={{ display: 'grid', gridTemplateColumns: { xs: 'repeat(2, 1fr)', sm: 'repeat(5, 1fr)' }, mb: 2, overflow: 'hidden' }}
        aria-label="Phone number counts"
      >
        {counters.map((c) => (
          <Box
            key={c.label}
            sx={{
              px: 2,
              py: 1.5,
              boxShadow: (t) => `-1px -1px 0 ${t.palette.divider}`,
              bgcolor: 'tone' in c && c.value ? toneBg[c.tone] : undefined,
            }}
          >
            <Typography variant="body2" color="text.secondary">
              {c.label}
            </Typography>
            <Typography sx={{ fontSize: '1.375rem', fontWeight: 650, fontVariantNumeric: 'tabular-nums' }}>
              {c.value === undefined ? '0' : formatNumber(c.value)}
            </Typography>
          </Box>
        ))}
      </Paper>

      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: '300px 1fr 320px' }, gap: 2, alignItems: 'start' }}>
        <Paper variant="outlined" sx={{ p: 2 }}>
          <TextField
            label="Phone numbers"
            value={numbers}
            onChange={(e) => setNumbers(e.target.value)}
            multiline
            minRows={14}
            maxRows={24}
            fullWidth
            placeholder={'One number per line\n98456 62183\n+91 99725 55555'}
            slotProps={{ htmlInput: { spellCheck: false } }}
          />
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            {check
              ? `Up to ${check.limits.demoMax} numbers is a demo. Full campaigns: ${formatNumber(check.limits.min)} to ${formatNumber(check.limits.max)}.`
              : 'Paste from Excel or type one per line. Without a country code, India is assumed.'}
          </Typography>
          {check?.problem && check.recipients > 0 && (
            <Alert severity="warning" sx={{ mt: 1.5 }}>
              {check.problem}
            </Alert>
          )}
          {check && check.invalidSamples.length > 0 && (
            <Typography variant="body2" color="error" sx={{ mt: 1 }}>
              Not valid: {check.invalidSamples.join(', ')}
              {check.invalid > check.invalidSamples.length ? ` and ${check.invalid - check.invalidSamples.length} more` : ''}
            </Typography>
          )}
          {check && check.countryOff > 0 && (
            <Typography variant="body2" color="error" sx={{ mt: 0.5 }}>
              {check.countryOff} number(s) are in countries we don&apos;t send to.
            </Typography>
          )}
          {checkError && (
            <Typography variant="body2" color="error" sx={{ mt: 1 }}>
              {checkError}
            </Typography>
          )}
        </Paper>

        <Paper variant="outlined" sx={{ p: 2, display: 'grid', gap: 2.25 }}>
          <Box>
            <Typography variant="body2" sx={{ fontWeight: 600, mb: 1 }}>
              Image
            </Typography>
            <ImageUpload value={image} onChange={setImage} />
          </Box>
          <TextField
            label="Message"
            value={message}
            onChange={(e) => setMessage(e.target.value.slice(0, MESSAGE_MAX))}
            multiline
            minRows={5}
            helperText={`${message.length} / ${MESSAGE_MAX}`}
            required
          />
          <TextField
            label="Call button number (optional)"
            value={callNumber}
            onChange={(e) => setCallNumber(e.target.value)}
            placeholder="98989 89898"
          />
          <TextField
            label="Website button link (optional)"
            value={visitUrl}
            onChange={(e) => setVisitUrl(e.target.value)}
            placeholder="https://www.example.com"
          />
          <Box>
            <MuiLink component="button" type="button" onClick={saveDefaults} sx={{ fontWeight: 600 }}>
              Use as my default message
            </MuiLink>
          </Box>
          <Box sx={{ bgcolor: '#FBF0DC', borderRadius: 2, p: 1.5 }}>
            <FormControlLabel
              control={<Checkbox checked={consent} onChange={(e) => setConsent(e.target.checked)} />}
              label={
                <Typography variant="body2">
                  These people agreed to receive WhatsApp messages from this business. I won&apos;t send spam or deceptive,
                  fraudulent, offensive or threatening messages, and I am responsible for what I send. People who reply
                  STOP are removed automatically.
                </Typography>
              }
              sx={{ alignItems: 'flex-start', m: 0, '& .MuiCheckbox-root': { mt: -0.75 } }}
            />
          </Box>
          <Typography variant="body2" color="text.secondary">
            New messages are checked by WhatsApp before sending, usually within minutes. The campaign starts on its own
            when approved. If WhatsApp says no, every credit comes back.
          </Typography>
        </Paper>

        <Box sx={{ display: 'grid', gap: 2 }}>
          <WhatsAppPreview
            senderName={brands?.find((b) => b.id === brandId)?.displayName}
            content={{
              header: { type: 'IMAGE', exampleUrl: image?.url ?? '' },
              body: message,
              footer: 'Reply STOP to unsubscribe',
              buttons,
            }}
          />
          <Paper variant="outlined">
            <Table size="small" aria-label="Credits needed">
              <TableHead>
                <TableRow>
                  <TableCell>Country</TableCell>
                  <TableCell align="right">Credits</TableCell>
                  <TableCell align="right">You have</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {check?.byCountry.map((c) => (
                  <TableRow key={c.code}>
                    <TableCell>{c.name}</TableCell>
                    <TableCell align="right">{formatNumber(c.credits)}</TableCell>
                    <TableCell align="right" sx={{ color: c.enough ? 'text.primary' : 'error.main', fontWeight: c.enough ? 400 : 650 }}>
                      {c.balance === null || c.balance === undefined ? 'Free' : formatNumber(c.balance)}
                    </TableCell>
                  </TableRow>
                ))}
                <TableRow>
                  <TableCell sx={{ fontWeight: 650 }}>Total</TableCell>
                  <TableCell align="right" sx={{ fontWeight: 650 }}>
                    {formatNumber(check?.creditsNeeded ?? 0)}
                  </TableCell>
                  <TableCell />
                </TableRow>
              </TableBody>
            </Table>
            {check && !check.enoughCredits && (
              <Typography variant="body2" color="error" sx={{ p: 1.5 }}>
                Not enough credits. {isCustomer ? 'Ask your provider to add more.' : 'Add credits in Transactions first.'}
              </Typography>
            )}
          </Paper>
          {blocker && (
            <Typography variant="body2" color="text.secondary" sx={{ textAlign: 'center' }}>
              To send: {blocker.charAt(0).toLowerCase() + blocker.slice(1)}
            </Typography>
          )}
        </Box>
      </Box>
      <Snackbar open={Boolean(toast)} autoHideDuration={5000} onClose={() => setToast('')} message={toast} anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }} />
    </Box>
  );
}
