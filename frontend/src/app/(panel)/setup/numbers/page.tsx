'use client';
import Add from '@mui/icons-material/Add';
import CheckCircle from '@mui/icons-material/CheckCircle';
import ContentCopy from '@mui/icons-material/ContentCopy';
import RadioButtonUnchecked from '@mui/icons-material/RadioButtonUnchecked';
import {
  Alert,
  Box,
  Button,
  IconButton,
  Paper,
  Snackbar,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tooltip,
  Typography,
} from '@mui/material';
import { useCallback, useEffect, useState } from 'react';
import PageHeader from '@/components/PageHeader';
import NumberDialog from '@/components/setup/NumberDialog';
import TestSendDialog from '@/components/setup/TestSendDialog';
import { ToneChip } from '@/components/StatusChip';
import { api, GatewaySetup, SenderNumber } from '@/lib/api';
import { formatPhone, serviceLabel } from '@/lib/format';

export default function NumbersPage() {
  const [numbers, setNumbers] = useState<SenderNumber[] | null>(null);
  const [setup, setSetup] = useState<GatewaySetup | null>(null);
  const [editing, setEditing] = useState<SenderNumber | null | 'new'>(null);
  const [testing, setTesting] = useState<SenderNumber | null>(null);
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');

  const load = useCallback(() => {
    api<SenderNumber[]>('/gateway/numbers').then(setNumbers).catch((e) => setError(e.message));
    api<GatewaySetup>('/gateway/setup').then(setSetup).catch(() => {});
  }, []);
  useEffect(load, [load]);

  async function refresh(n: SenderNumber) {
    try {
      await api(`/gateway/numbers/${n.id}/refresh`, { method: 'POST' });
      setToast(`${n.label}: connection is working`);
    } catch (e) {
      setToast((e as Error).message);
    }
    load();
  }

  const hasMeta = numbers?.some((n) => n.provider === 'META');

  return (
    <>
      <PageHeader
        title="WhatsApp numbers"
        description="The numbers campaigns are sent from. Premium Campaigns use the shared default number."
        actions={
          <Button variant="contained" startIcon={<Add />} onClick={() => setEditing('new')}>
            Add number
          </Button>
        }
      />

      {setup && (
        <Paper variant="outlined" sx={{ p: 3, mb: 3 }}>
          <Typography variant="h3">Connection to WhatsApp</Typography>
          <Typography color="text.secondary" sx={{ mt: 0.5, mb: 2, maxWidth: '70ch' }}>
            These come from the server settings file. In Meta, open your app, then WhatsApp &gt; Configuration, and
            paste this callback URL with your verify token. Subscribe to messages, message_template_status_update and
            phone_number_quality_update.
          </Typography>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, p: 1.25, bgcolor: 'background.default', borderRadius: 2, mb: 2, maxWidth: 640 }}>
            <Typography sx={{ flex: 1, fontFamily: 'ui-monospace, monospace', fontSize: '0.875rem', wordBreak: 'break-all' }}>
              {setup.webhookUrl}
            </Typography>
            <Tooltip title="Copy">
              <IconButton
                aria-label="Copy callback URL"
                onClick={() => {
                  void navigator.clipboard.writeText(setup.webhookUrl);
                  setToast('Callback URL copied');
                }}
              >
                <ContentCopy fontSize="small" />
              </IconButton>
            </Tooltip>
          </Box>
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 1, maxWidth: 640 }}>
            <Check ok={setup.verifyTokenSet} label="Verify token (META_VERIFY_TOKEN)" />
            <Check ok={setup.appSecretSet} label="App secret (META_APP_SECRET)" />
            <Check ok={setup.platformTokenSet} label="Platform access token (META_ACCESS_TOKEN)" />
            <Check ok={setup.appIdSet} label="App ID, for image templates (META_APP_ID)" />
            <Check ok={setup.workerRunning} label="Sending worker running" />
          </Box>
        </Paper>
      )}

      {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

      <Paper variant="outlined">
        <TableContainer>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>Number</TableCell>
                <TableCell>Used for</TableCell>
                <TableCell>Quality</TableCell>
                <TableCell>Daily limit</TableCell>
                <TableCell>Speed</TableCell>
                <TableCell>Status</TableCell>
                <TableCell align="right">
                  <Box component="span" sx={{ position: 'absolute', left: -9999 }}>
                    Actions
                  </Box>
                </TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {numbers?.map((n) => (
                <TableRow key={n.id} hover>
                  <TableCell>
                    <Typography sx={{ fontWeight: 600 }}>
                      {n.label}
                      {n.isDefault && (
                        <Typography component="span" variant="body2" color="primary" sx={{ ml: 1, fontWeight: 600 }}>
                          Default
                        </Typography>
                      )}
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      {formatPhone(n.phoneNumber)}
                      {n.displayName ? `, shown as ${n.displayName}` : ''}
                    </Typography>
                    {n.lastError && (
                      <Typography variant="body2" color="error" sx={{ maxWidth: 360 }}>
                        {n.lastError}
                      </Typography>
                    )}
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2">{serviceLabel[n.service]}</Typography>
                    <Typography variant="body2" color="text.secondary">
                      {n.provider === 'TEST' ? 'Test mode' : n.ownerUsername ? `Owned by ${n.ownerUsername}` : 'Shared'}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    {n.qualityRating ? (
                      <ToneChip
                        label={n.qualityRating.charAt(0) + n.qualityRating.slice(1).toLowerCase()}
                        tone={n.qualityRating === 'GREEN' ? 'good' : n.qualityRating === 'YELLOW' ? 'wait' : 'bad'}
                      />
                    ) : (
                      '—'
                    )}
                  </TableCell>
                  <TableCell>{n.messagingLimit?.replace('TIER_', '') ?? '—'}</TableCell>
                  <TableCell>{n.ratePerSecond}/sec</TableCell>
                  <TableCell>
                    <ToneChip label={n.status === 'ACTIVE' ? 'On' : 'Off'} tone={n.status === 'ACTIVE' ? 'good' : 'wait'} />
                  </TableCell>
                  <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                    <Button size="small" onClick={() => setTesting(n)}>
                      Send test
                    </Button>
                    <Button size="small" onClick={() => refresh(n)}>
                      Check
                    </Button>
                    <Button size="small" onClick={() => setEditing(n)}>
                      Edit
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
        {numbers && numbers.length === 0 && (
          <Box sx={{ py: 6, px: 3, textAlign: 'center' }}>
            <Typography variant="h3">No numbers yet</Typography>
            <Typography color="text.secondary" sx={{ mt: 0.5, maxWidth: '60ch', mx: 'auto' }}>
              Add your WhatsApp number from Meta once your business is verified. Until then, add a test-mode number to try
              everything out.
            </Typography>
          </Box>
        )}
        {numbers && numbers.length > 0 && !hasMeta && (
          <Alert severity="info" sx={{ m: 2 }}>
            Only test-mode numbers so far: nothing reaches real phones until a WhatsApp (Meta) number is added.
          </Alert>
        )}
      </Paper>

      <NumberDialog
        open={editing !== null}
        number={editing === 'new' ? null : editing}
        onClose={() => setEditing(null)}
        onSaved={(_, msg) => {
          setEditing(null);
          setToast(msg);
          load();
        }}
      />
      <TestSendDialog number={testing} onClose={() => setTesting(null)} />
      <Snackbar open={Boolean(toast)} autoHideDuration={5000} onClose={() => setToast('')} message={toast} anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }} />
    </>
  );
}

function Check({ ok, label }: { ok: boolean; label: string }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
      {ok ? (
        <CheckCircle fontSize="small" color="primary" aria-label="Set" />
      ) : (
        <RadioButtonUnchecked fontSize="small" sx={{ color: 'text.disabled' }} aria-label="Not set" />
      )}
      <Typography variant="body2" color={ok ? 'text.primary' : 'text.secondary'}>
        {label}
      </Typography>
    </Box>
  );
}
