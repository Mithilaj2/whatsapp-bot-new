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
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { FormEvent, useEffect, useRef, useState } from 'react';
import { MessageStatusChip } from '@/components/StatusChip';
import WhatsAppPreview from '@/components/WhatsAppPreview';
import { api, Message, MessageTemplate, Page, SenderNumber } from '@/lib/api';

const FINAL = ['READ', 'FAILED'];

export default function TestSendDialog({
  number,
  onClose,
}: {
  number: SenderNumber | null;
  onClose: () => void;
}) {
  const [templates, setTemplates] = useState<MessageTemplate[]>([]);
  const [templateId, setTemplateId] = useState('');
  const [to, setTo] = useState('');
  const [params, setParams] = useState<string[]>([]);
  const [message, setMessage] = useState<Message | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const poll = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!number) return;
    setMessage(null);
    setError('');
    setTemplateId('');
    api<Page<MessageTemplate>>('/gateway/templates', {
      query: { senderNumberId: number.id, status: 'APPROVED', pageSize: 100 },
    }).then((r) => {
      setTemplates(r.items);
      if (r.items[0]) setTemplateId(r.items[0].id);
    });
    return () => {
      if (poll.current) clearInterval(poll.current);
    };
  }, [number]);

  const template = templates.find((t) => t.id === templateId);
  const placeholders = template ? Math.max(0, ...[...template.content.body.matchAll(/\{\{(\d+)\}\}/g)].map((m) => Number(m[1]))) : 0;

  useEffect(() => {
    setParams(template?.content.bodyExamples ?? []);
  }, [template]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!number) return;
    setBusy(true);
    setError('');
    try {
      const m = await api<Message>(`/gateway/numbers/${number.id}/test`, {
        method: 'POST',
        body: { to, templateId, bodyParams: params.slice(0, placeholders) },
      });
      setMessage(m);
      // Follow the message until it is read or fails
      if (poll.current) clearInterval(poll.current);
      poll.current = setInterval(async () => {
        const latest = await api<Message>(`/gateway/messages/${m.id}`).catch(() => null);
        if (!latest) return;
        setMessage(latest);
        if (FINAL.includes(latest.status) && poll.current) clearInterval(poll.current);
      }, 1500);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={Boolean(number)} onClose={onClose} fullWidth maxWidth="md">
      <form onSubmit={submit}>
        <DialogTitle>Send a test message from {number?.label}</DialogTitle>
        <DialogContent>
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 300px' }, gap: 3, pt: 1 }}>
            <Stack spacing={2.25}>
              {error && <Alert severity="error">{error}</Alert>}
              {templates.length === 0 ? (
                <Alert severity="info">
                  This number has no approved template yet. WhatsApp only allows approved templates to start a
                  conversation. Create one in Templates.
                </Alert>
              ) : (
                <TextField select label="Template" value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
                  {templates.map((t) => (
                    <MenuItem key={t.id} value={t.id}>
                      {t.name}
                    </MenuItem>
                  ))}
                </TextField>
              )}
              {Array.from({ length: placeholders }, (_, i) => (
                <TextField
                  key={i}
                  label={`Value for {{${i + 1}}}`}
                  value={params[i] ?? ''}
                  onChange={(e) => setParams((p) => Object.assign([...p], { [i]: e.target.value }))}
                  required
                />
              ))}
              <TextField
                label="Send to"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                placeholder="98456 62183"
                helperText="Your own WhatsApp number. Without a country code, India is assumed."
                required
              />
              {message && (
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, p: 1.5, bgcolor: 'background.default', borderRadius: 2 }}>
                  <MessageStatusChip status={message.status} />
                  <Typography variant="body2" color={message.status === 'FAILED' ? 'error' : 'text.secondary'}>
                    {message.status === 'FAILED'
                      ? `${message.errorMessage ?? 'Failed'}${message.errorCode ? ` (code ${message.errorCode})` : ''}`
                      : message.status === 'READ'
                        ? 'Opened on the phone.'
                        : 'Updates on its own as WhatsApp reports back.'}
                  </Typography>
                </Box>
              )}
            </Stack>
            {template && (
              <WhatsAppPreview content={template.content} values={params} senderName={number?.displayName ?? number?.label} />
            )}
          </Box>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={onClose}>Close</Button>
          <Button type="submit" variant="contained" disabled={busy || !templateId}>
            Send test
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}
