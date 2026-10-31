'use client';
import Add from '@mui/icons-material/Add';
import Close from '@mui/icons-material/Close';
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  MenuItem,
  Stack,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material';
import { FormEvent, useEffect, useMemo, useState } from 'react';
import WhatsAppPreview from '@/components/WhatsAppPreview';
import { api, MessageTemplate, SenderNumber, TemplateButton, TemplateContent } from '@/lib/api';

interface Props {
  open: boolean;
  numbers: SenderNumber[];
  onClose: () => void;
  onSaved: (t: MessageTemplate) => void;
}

type HeaderKind = 'NONE' | 'IMAGE' | 'TEXT';

export default function TemplateDialog({ open, numbers, onClose, onSaved }: Props) {
  const [numberId, setNumberId] = useState('');
  const [name, setName] = useState('');
  const [category, setCategory] = useState<'MARKETING' | 'UTILITY'>('MARKETING');
  const [language, setLanguage] = useState('en');
  const [headerKind, setHeaderKind] = useState<HeaderKind>('IMAGE');
  const [imageUrl, setImageUrl] = useState('');
  const [headerText, setHeaderText] = useState('');
  const [body, setBody] = useState('');
  const [examples, setExamples] = useState<string[]>([]);
  const [footer, setFooter] = useState('Reply STOP to unsubscribe');
  const [buttons, setButtons] = useState<TemplateButton[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setError('');
    setNumberId((id) => id || numbers.find((n) => n.status === 'ACTIVE')?.id || '');
  }, [open, numbers]);

  const placeholderCount = useMemo(
    () => Math.max(0, ...[...body.matchAll(/\{\{(\d+)\}\}/g)].map((m) => Number(m[1]))),
    [body],
  );

  const content: TemplateContent = {
    ...(headerKind === 'IMAGE' ? { header: { type: 'IMAGE' as const, exampleUrl: imageUrl } } : {}),
    ...(headerKind === 'TEXT' ? { header: { type: 'TEXT' as const, text: headerText } } : {}),
    body,
    footer: footer || undefined,
    buttons,
  };

  function addVariable() {
    setBody((b) => `${b}{{${placeholderCount + 1}}}`);
  }

  function setButton(i: number, patch: Partial<TemplateButton>) {
    setButtons((bs) => bs.map((b, j) => (j === i ? { ...b, ...patch } : b)));
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const t = await api<MessageTemplate>('/gateway/templates', {
        method: 'POST',
        body: {
          senderNumberId: numberId,
          name,
          language,
          category,
          ...(headerKind === 'IMAGE' ? { header: { type: 'IMAGE', exampleUrl: imageUrl } } : {}),
          ...(headerKind === 'TEXT' ? { header: { type: 'TEXT', text: headerText } } : {}),
          body,
          bodyExamples: examples.slice(0, placeholderCount),
          footer: footer || undefined,
          buttons,
        },
      });
      onSaved(t);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const number = numbers.find((n) => n.id === numberId);

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="md">
      <form onSubmit={submit}>
        <DialogTitle>New template</DialogTitle>
        <DialogContent>
          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 300px' }, gap: 3, pt: 1 }}>
            <Stack spacing={2.25}>
              {error && <Alert severity="error">{error}</Alert>}
              <TextField select label="Number" value={numberId} onChange={(e) => setNumberId(e.target.value)} required>
                {numbers.map((n) => (
                  <MenuItem key={n.id} value={n.id}>
                    {n.label}
                    {n.provider === 'TEST' ? ' (test mode)' : ''}
                  </MenuItem>
                ))}
              </TextField>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                <TextField
                  label="Template name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  helperText="Only you see this. Saved as lowercase_with_underscores."
                  fullWidth
                  required
                />
                <TextField select label="Language" value={language} onChange={(e) => setLanguage(e.target.value)} sx={{ minWidth: 140 }}>
                  <MenuItem value="en">English</MenuItem>
                  <MenuItem value="en_US">English (US)</MenuItem>
                  <MenuItem value="hi">Hindi</MenuItem>
                  <MenuItem value="ml">Malayalam</MenuItem>
                  <MenuItem value="ta">Tamil</MenuItem>
                  <MenuItem value="kn">Kannada</MenuItem>
                </TextField>
              </Stack>
              <TextField
                select
                label="Category"
                value={category}
                onChange={(e) => setCategory(e.target.value as 'MARKETING')}
                helperText={
                  category === 'MARKETING'
                    ? 'Offers, announcements, invitations. Costs more per message.'
                    : 'Order updates, reminders, alerts about something the person did. WhatsApp re-checks this.'
                }
              >
                <MenuItem value="MARKETING">Marketing</MenuItem>
                <MenuItem value="UTILITY">Utility</MenuItem>
              </TextField>

              <Box>
                <Typography variant="body2" sx={{ fontWeight: 600, mb: 1 }}>
                  Top of message
                </Typography>
                <ToggleButtonGroup exclusive size="small" value={headerKind} onChange={(_, v) => v && setHeaderKind(v)}>
                  <ToggleButton value="IMAGE">Image</ToggleButton>
                  <ToggleButton value="TEXT">Title</ToggleButton>
                  <ToggleButton value="NONE">Nothing</ToggleButton>
                </ToggleButtonGroup>
              </Box>
              {headerKind === 'IMAGE' && (
                <TextField
                  label="Sample image link"
                  value={imageUrl}
                  onChange={(e) => setImageUrl(e.target.value)}
                  placeholder="https://…/banner.jpg"
                  helperText="WhatsApp reviews this sample. Each campaign can use its own image."
                  required
                />
              )}
              {headerKind === 'TEXT' && (
                <TextField label="Title" value={headerText} onChange={(e) => setHeaderText(e.target.value)} slotProps={{ htmlInput: { maxLength: 60 } }} required />
              )}

              <TextField
                label="Message"
                value={body}
                onChange={(e) => setBody(e.target.value)}
                multiline
                minRows={4}
                slotProps={{ htmlInput: { maxLength: 1024 } }}
                helperText={`${body.length} / 1024. Use {{1}}, {{2}} for parts that change per message, like a name.`}
                required
              />
              <Box>
                <Button size="small" startIcon={<Add />} onClick={addVariable}>
                  Add a changing part ({`{{${placeholderCount + 1}}}`})
                </Button>
              </Box>
              {Array.from({ length: placeholderCount }, (_, i) => (
                <TextField
                  key={i}
                  label={`Sample for {{${i + 1}}}`}
                  value={examples[i] ?? ''}
                  onChange={(e) => setExamples((ex) => Object.assign([...ex], { [i]: e.target.value }))}
                  helperText={i === 0 ? 'WhatsApp needs a realistic example to approve the template' : undefined}
                  required
                />
              ))}

              <TextField label="Footer (optional)" value={footer} onChange={(e) => setFooter(e.target.value)} slotProps={{ htmlInput: { maxLength: 60 } }} />

              <Box>
                <Typography variant="body2" sx={{ fontWeight: 600, mb: 1 }}>
                  Buttons
                </Typography>
                <Stack spacing={1.5}>
                  {buttons.map((b, i) => (
                    <Stack key={i} direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ sm: 'flex-start' }}>
                      <TextField
                        label="Button text"
                        value={b.text}
                        onChange={(e) => setButton(i, { text: e.target.value })}
                        slotProps={{ htmlInput: { maxLength: 25 } }}
                        sx={{ width: { sm: 170 } }}
                        required
                      />
                      {b.type === 'PHONE_NUMBER' && (
                        <TextField label="Phone" value={b.phone ?? ''} onChange={(e) => setButton(i, { phone: e.target.value })} fullWidth required />
                      )}
                      {b.type === 'URL' && (
                        <TextField label="Link" value={b.url ?? ''} onChange={(e) => setButton(i, { url: e.target.value })} placeholder="https://" fullWidth required />
                      )}
                      {b.type === 'QUICK_REPLY' && <Box sx={{ flex: 1 }} />}
                      <IconButton aria-label="Remove button" onClick={() => setButtons((bs) => bs.filter((_, j) => j !== i))}>
                        <Close fontSize="small" />
                      </IconButton>
                    </Stack>
                  ))}
                  <Stack direction="row" spacing={1} flexWrap="wrap">
                    <Button size="small" variant="outlined" disabled={buttons.some((b) => b.type === 'PHONE_NUMBER')} onClick={() => setButtons((bs) => [...bs, { type: 'PHONE_NUMBER', text: 'Call now', phone: '' }])}>
                      Add call button
                    </Button>
                    <Button size="small" variant="outlined" disabled={buttons.filter((b) => b.type === 'URL').length >= 2} onClick={() => setButtons((bs) => [...bs, { type: 'URL', text: 'Visit website', url: '' }])}>
                      Add website button
                    </Button>
                    <Button size="small" variant="outlined" onClick={() => setButtons((bs) => [...bs, { type: 'QUICK_REPLY', text: 'Stop' }])}>
                      Add reply button
                    </Button>
                  </Stack>
                </Stack>
              </Box>
            </Stack>

            <Box sx={{ position: { md: 'sticky' }, top: 0, alignSelf: 'start' }}>
              <WhatsAppPreview content={content} values={examples} senderName={number?.displayName ?? number?.label} />
            </Box>
          </Box>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="contained" disabled={busy || !numberId}>
            {busy ? 'Submitting…' : 'Submit for approval'}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}
