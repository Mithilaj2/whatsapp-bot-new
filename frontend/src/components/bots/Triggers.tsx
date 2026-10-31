'use client';
import Add from '@mui/icons-material/Add';
import Close from '@mui/icons-material/Close';
import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Chip,
  FormControlLabel,
  IconButton,
  MenuItem,
  Paper,
  Radio,
  RadioGroup,
  TextField,
  Typography,
} from '@mui/material';
import { BotFlow, BotSettings, BotTrigger } from '@/lib/api';

/** Keywords that start the bot, and what happens when nothing matches. */
export function TriggersEditor({ flow, onChange }: { flow: BotFlow; onChange: (f: BotFlow) => void }) {
  const setTrigger = (i: number, patch: Partial<BotTrigger>) =>
    onChange({ ...flow, triggers: flow.triggers.map((t, j) => (j === i ? { ...t, ...patch } : t)) });
  const add = () => {
    const used = new Set(flow.triggers.map((t) => t.id));
    let k = flow.triggers.length + 1;
    while (used.has(`t${k}`)) k++;
    onChange({ ...flow, triggers: [...flow.triggers, { id: `t${k}`, keywords: [], match: 'EXACT', startNodeId: flow.nodes[0]?.id ?? '' }] });
  };
  const stepSelect = (value: string | undefined, onSet: (v: string) => void, label: string) => (
    <TextField select label={label} value={value && flow.nodes.some((n) => n.id === value) ? value : ''} onChange={(e) => onSet(e.target.value)} size="small" sx={{ minWidth: 200 }}>
      {flow.nodes.map((n) => (
        <MenuItem key={n.id} value={n.id}>
          {n.name || n.id}
        </MenuItem>
      ))}
    </TextField>
  );
  const fb = flow.fallback;

  return (
    <Box sx={{ display: 'grid', gap: 2 }}>
      <Paper variant="outlined" sx={{ p: 2.5, display: 'grid', gap: 2 }}>
        <Box>
          <Typography variant="h3">Keywords</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            When someone sends one of these words, the bot starts at the step you pick. They also work in the middle of a
            chat, so &quot;menu&quot; can always bring the menu back.
          </Typography>
        </Box>
        {flow.triggers.map((t, i) => (
          <Box key={t.id} sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr auto', md: '1fr 170px 220px auto' }, gap: 1.5, alignItems: 'start', pt: i ? 2 : 0, borderTop: i ? 1 : 0, borderColor: 'divider' }}>
            <Autocomplete
              multiple
              freeSolo
              options={[]}
              value={t.keywords}
              onChange={(_, v) => setTrigger(i, { keywords: (v as string[]).map((k) => k.trim()).filter(Boolean).slice(0, 20) })}
              renderValue={(value, getItemProps) =>
                value.map((option, index) => {
                  const { key, ...rest } = getItemProps({ index });
                  return <Chip key={key} label={option} size="small" {...rest} />;
                })
              }
              renderInput={(p) => <TextField {...p} label="Keywords" size="small" placeholder="Type a word, press Enter" />}
            />
            <IconButton aria-label="Remove keywords" onClick={() => onChange({ ...flow, triggers: flow.triggers.filter((_, j) => j !== i) })} sx={{ gridColumn: { xs: 2, md: 4 }, gridRow: { xs: 1, md: 'auto' } }}>
              <Close fontSize="small" />
            </IconButton>
            <TextField select label="Match" value={t.match} onChange={(e) => setTrigger(i, { match: e.target.value as BotTrigger['match'] })} size="small" sx={{ gridColumn: { xs: '1 / -1', md: 'auto' }, gridRow: { md: 1 } }}>
              <MenuItem value="EXACT">Whole message</MenuItem>
              <MenuItem value="CONTAINS">Anywhere in message</MenuItem>
            </TextField>
            <Box sx={{ gridColumn: { xs: '1 / -1', md: 'auto' }, gridRow: { md: 1 }, display: 'grid' }}>
              {stepSelect(t.startNodeId, (v) => setTrigger(i, { startNodeId: v }), 'Starts at')}
            </Box>
          </Box>
        ))}
        <Box>
          <Button startIcon={<Add />} onClick={add}>
            Add keywords
          </Button>
        </Box>
      </Paper>

      <Paper variant="outlined" sx={{ p: 2.5, display: 'grid', gap: 1.5 }}>
        <Box>
          <Typography variant="h3">When no keyword matches</Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            For a new message that isn&apos;t a keyword and isn&apos;t an answer to the bot.
          </Typography>
        </Box>
        <RadioGroup
          value={fb.mode}
          onChange={(e) => {
            const mode = e.target.value as BotFlow['fallback']['mode'];
            onChange({ ...flow, fallback: { mode, startNodeId: fb.startNodeId ?? flow.nodes[0]?.id, text: fb.text } });
          }}
        >
          <FormControlLabel value="START" control={<Radio />} label="Start the bot anyway" />
          {fb.mode === 'START' && <Box sx={{ pl: 4, pb: 1, display: 'grid' }}>{stepSelect(fb.startNodeId, (v) => onChange({ ...flow, fallback: { ...fb, startNodeId: v } }), 'Start at')}</Box>}
          <FormControlLabel value="AI" control={<Radio />} label="Answer with AI from your business information" />
          {fb.mode === 'AI' && (
            <Typography variant="body2" color="text.secondary" sx={{ pl: 4, pb: 1 }}>
              Write the information in the AI answers tab. Questions asked in the middle of a menu are answered too, then
              the menu is shown again.
            </Typography>
          )}
          <FormControlLabel value="MESSAGE" control={<Radio />} label="Send a fixed message" />
          {fb.mode === 'MESSAGE' && (
            <TextField
              value={fb.text ?? ''}
              onChange={(e) => onChange({ ...flow, fallback: { ...fb, text: e.target.value.slice(0, 1000) } })}
              multiline
              minRows={2}
              placeholder='Sorry, I did not get that. Type "menu" to see what I can help with.'
              sx={{ ml: 4, mb: 1 }}
              aria-label="Fixed message"
            />
          )}
          <FormControlLabel value="NONE" control={<Radio />} label="Don't reply (your team answers in Incoming messages)" />
        </RadioGroup>
      </Paper>
    </Box>
  );
}

export function AiEditor({ flow, settings, onChange }: { flow: BotFlow; settings: BotSettings | null; onChange: (f: BotFlow) => void }) {
  return (
    <Paper variant="outlined" sx={{ p: 2.5, display: 'grid', gap: 2 }}>
      <Box>
        <Typography variant="h3">AI answers</Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, maxWidth: '75ch' }}>
          The AI answers questions using only what you write here. If the answer isn&apos;t here, it sends your
          &quot;no answer&quot; message instead of guessing. Up to {settings?.aiDailyLimit ?? 20} AI answers per person per day.
        </Typography>
      </Box>
      {settings && !settings.aiAvailable && (
        <Alert severity="info">AI isn&apos;t switched on for the platform yet. Your provider can turn it on; until then the &quot;no answer&quot; message is sent.</Alert>
      )}
      {flow.fallback.mode !== 'AI' && (
        <Alert
          severity="warning"
          action={
            <Button color="inherit" size="small" onClick={() => onChange({ ...flow, fallback: { mode: 'AI' } })}>
              Use AI
            </Button>
          }
        >
          AI answers are off. Turn them on under Keywords, &quot;When no keyword matches&quot;.
        </Alert>
      )}
      <TextField
        label="Business information"
        value={flow.ai.knowledge}
        onChange={(e) => onChange({ ...flow, ai: { ...flow.ai, knowledge: e.target.value.slice(0, 20000) } })}
        multiline
        minRows={12}
        placeholder={'Opening hours: 9 am to 9 pm, Monday to Saturday\nAddress: 12 MG Road, Kochi\nDelivery: free within 5 km, Rs 40 beyond\nPayment: UPI, cards, cash on delivery\nReturns: within 7 days with the bill'}
        helperText={`Products, prices, timings, address, delivery, policies, common questions. ${flow.ai.knowledge.length.toLocaleString('en-IN')} / 20,000`}
      />
      <TextField
        label="When the AI doesn't know"
        value={flow.ai.noAnswerText ?? ''}
        onChange={(e) => onChange({ ...flow, ai: { ...flow.ai, noAnswerText: e.target.value.slice(0, 500) } })}
        placeholder="Sorry, I don't have that information. Our team will get back to you."
      />
    </Paper>
  );
}
