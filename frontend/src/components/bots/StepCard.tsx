'use client';
import Add from '@mui/icons-material/Add';
import ArrowDownward from '@mui/icons-material/ArrowDownward';
import ArrowUpward from '@mui/icons-material/ArrowUpward';
import Close from '@mui/icons-material/Close';
import DeleteOutline from '@mui/icons-material/DeleteOutline';
import ExpandMore from '@mui/icons-material/ExpandMore';
import { Box, Button, Chip, Collapse, IconButton, MenuItem, Paper, TextField, Tooltip, Typography } from '@mui/material';
import ImageUpload from '@/components/campaigns/ImageUpload';
import { BotNode, BotNodeType, BotOption } from '@/lib/api';
import { brand } from '@/lib/theme';

export const stepTypes: Record<BotNodeType, { label: string; help: string; color: string }> = {
  MESSAGE: { label: 'Message', help: 'Says something, then goes on to the next step', color: '#E3ECF7' },
  BUTTONS: { label: 'Buttons', help: 'Up to 3 buttons to tap', color: brand.bubble },
  LIST: { label: 'List menu', help: 'A menu of up to 10 options', color: '#E6F0EA' },
  QUESTION: { label: 'Question', help: 'Asks and saves the answer', color: '#FBF0DC' },
  HANDOFF: { label: 'Talk to a person', help: 'Hands the chat to your team; the bot goes quiet', color: '#F8E1DC' },
};

const END = '__end';

export default function StepCard({
  node,
  index,
  count,
  nodes,
  open,
  isStart,
  onToggle,
  onChange,
  onMove,
  onDelete,
}: {
  node: BotNode;
  index: number;
  count: number;
  nodes: BotNode[];
  open: boolean;
  isStart: boolean;
  onToggle: () => void;
  onChange: (n: BotNode) => void;
  onMove: (dir: -1 | 1) => void;
  onDelete: () => void;
}) {
  const t = stepTypes[node.type];
  const set = (patch: Partial<BotNode>) => onChange({ ...node, ...patch });
  const others = nodes.filter((n) => n.id !== node.id);
  const nameOf = (id?: string) => (id ? (nodes.find((n) => n.id === id)?.name ?? 'missing step') : 'End the chat');
  const options = node.options ?? [];
  const isMenu = node.type === 'BUTTONS' || node.type === 'LIST';
  const maxOptions = node.type === 'BUTTONS' ? 3 : 10;
  const titleMax = node.type === 'BUTTONS' ? 20 : 24;

  const setOption = (i: number, patch: Partial<BotOption>) =>
    set({ options: options.map((o, j) => (j === i ? { ...o, ...patch } : o)) });
  const addOption = () => {
    const used = new Set(options.map((o) => o.id));
    let k = options.length + 1;
    while (used.has(`o${k}`)) k++;
    set({ options: [...options, { id: `o${k}`, title: '' }] });
  };

  const nextSelect = (value: string | undefined, onSet: (v: string | undefined) => void, label = 'Then') => (
    <TextField select label={label} value={value ?? END} onChange={(e) => onSet(e.target.value === END ? undefined : e.target.value)} size="small" sx={{ minWidth: 180 }}>
      <MenuItem value={END}>End the chat</MenuItem>
      {others.map((n) => (
        <MenuItem key={n.id} value={n.id}>
          Go to: {n.name || n.id}
        </MenuItem>
      ))}
    </TextField>
  );

  // One line under the title when closed: where it leads
  const summary = isMenu
    ? options.map((o) => `${o.title || '…'} → ${nameOf(o.next)}`).join(', ')
    : node.type === 'HANDOFF'
      ? 'Bot goes quiet, your team replies'
      : node.type === 'QUESTION'
        ? `Saves to ${node.variable || '…'}, then ${nameOf(node.next).toLowerCase()}`
        : `Then ${nameOf(node.next).toLowerCase()}`;

  return (
    <Paper variant="outlined" sx={{ overflow: 'hidden', borderColor: open ? brand.action : undefined }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, pl: 2, pr: 1, py: 1.25 }}>
        <Box
          component="button"
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          sx={{ all: 'unset', flex: 1, minWidth: 0, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 1.5, '&:focus-visible': { outline: `2px solid ${brand.action}`, outlineOffset: 4, borderRadius: 1 } }}
        >
          <Typography sx={{ width: 22, color: 'text.secondary', fontVariantNumeric: 'tabular-nums', fontSize: '0.875rem' }}>{index + 1}</Typography>
          <Chip size="small" label={t.label} sx={{ bgcolor: t.color, color: brand.ink, fontWeight: 600, flexShrink: 0 }} />
          <Box sx={{ minWidth: 0 }}>
            <Typography sx={{ fontWeight: 650 }} noWrap>
              {node.name || 'Untitled step'}
              {isStart && (
                <Typography component="span" sx={{ ml: 1, fontSize: '0.75rem', fontWeight: 600, color: brand.action }}>
                  START
                </Typography>
              )}
            </Typography>
            {!open && (
              <Typography variant="body2" color="text.secondary" noWrap>
                {summary}
              </Typography>
            )}
          </Box>
        </Box>
        <Tooltip title="Move up">
          <Box component="span" sx={{ display: { xs: 'none', sm: 'inline-flex' } }}>
            <IconButton size="small" aria-label="Move step up" disabled={index === 0} onClick={() => onMove(-1)}>
              <ArrowUpward fontSize="small" />
            </IconButton>
          </Box>
        </Tooltip>
        <Tooltip title="Move down">
          <Box component="span" sx={{ display: { xs: 'none', sm: 'inline-flex' } }}>
            <IconButton size="small" aria-label="Move step down" disabled={index === count - 1} onClick={() => onMove(1)}>
              <ArrowDownward fontSize="small" />
            </IconButton>
          </Box>
        </Tooltip>
        <Tooltip title="Delete step">
          <IconButton size="small" aria-label="Delete step" onClick={onDelete}>
            <DeleteOutline fontSize="small" />
          </IconButton>
        </Tooltip>
        <IconButton size="small" aria-label={open ? 'Close step' : 'Open step'} onClick={onToggle} sx={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .15s' }}>
          <ExpandMore />
        </IconButton>
      </Box>

      <Collapse in={open} unmountOnExit>
        <Box sx={{ px: 2, pb: 2, pt: 0.5, display: 'grid', gap: 2, borderTop: 1, borderColor: 'divider' }}>
          <Typography variant="body2" color="text.secondary" sx={{ pt: 1 }}>
            {t.help}
          </Typography>
          <TextField label="Step name" value={node.name} onChange={(e) => set({ name: e.target.value.slice(0, 60) })} size="small" helperText="Only you see this" />
          <TextField
            label={node.type === 'QUESTION' ? 'Question' : 'Message'}
            value={node.text}
            onChange={(e) => set({ text: e.target.value })}
            multiline
            minRows={3}
            helperText={`Use {{name}} for the person's WhatsApp name${node.type === 'QUESTION' ? '' : ' or {{answer_name}} for a saved answer'}. ${node.text.length} / ${isMenu ? 1024 : 4096}`}
          />

          {(node.type === 'MESSAGE' || node.type === 'BUTTONS') && (
            <Box>
              <Typography variant="body2" sx={{ fontWeight: 600, mb: 0.75 }}>
                Image (optional)
              </Typography>
              <ImageUpload
                value={node.imageUrl ? { id: '', url: node.imageUrl, name: node.imageUrl.split('/').pop() ?? 'image' } : null}
                onChange={(v) => set({ imageUrl: v?.url })}
              />
            </Box>
          )}

          {node.type === 'LIST' && (
            <TextField
              label="Menu button"
              value={node.listButton ?? ''}
              onChange={(e) => set({ listButton: e.target.value.slice(0, 20) })}
              size="small"
              helperText={`What the button that opens the menu says, e.g. "See options". ${(node.listButton ?? '').length} / 20`}
            />
          )}

          {isMenu && (
            <Box sx={{ display: 'grid', gap: 1.25 }}>
              <Typography variant="body2" sx={{ fontWeight: 600 }}>
                {node.type === 'BUTTONS' ? 'Buttons' : 'Options'}
              </Typography>
              {options.map((o, i) => (
                <Box key={o.id} sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr auto', sm: node.type === 'LIST' ? '1fr 1fr 200px auto' : '1fr 220px auto' }, gap: 1, alignItems: 'start' }}>
                  <TextField
                    label={`${node.type === 'BUTTONS' ? 'Button' : 'Option'} ${i + 1}`}
                    value={o.title}
                    onChange={(e) => setOption(i, { title: e.target.value.slice(0, titleMax) })}
                    size="small"
                    helperText={`${o.title.length} / ${titleMax}`}
                  />
                  {node.type === 'LIST' && (
                    <TextField
                      label="Description (optional)"
                      value={o.description ?? ''}
                      onChange={(e) => setOption(i, { description: e.target.value.slice(0, 72) })}
                      size="small"
                      sx={{ gridColumn: { xs: '1 / 2', sm: 'auto' } }}
                    />
                  )}
                  <Box sx={{ gridColumn: { xs: '1 / 2', sm: 'auto' }, display: 'grid' }}>
                    {nextSelect(o.next, (v) => setOption(i, { next: v }), 'Goes to')}
                  </Box>
                  <IconButton aria-label={`Remove ${o.title || 'option'}`} onClick={() => set({ options: options.filter((_, j) => j !== i) })} sx={{ gridRow: { xs: '1', sm: 'auto' }, gridColumn: { xs: '2', sm: 'auto' } }}>
                    <Close fontSize="small" />
                  </IconButton>
                </Box>
              ))}
              {options.length < maxOptions && (
                <Box>
                  <Button size="small" startIcon={<Add />} onClick={addOption}>
                    Add {node.type === 'BUTTONS' ? 'button' : 'option'}
                  </Button>
                </Box>
              )}
              <TextField
                label="Save the choice as (optional)"
                value={node.variable ?? ''}
                onChange={(e) => set({ variable: e.target.value.replace(/[^\w]/g, '_').slice(0, 40) || undefined })}
                size="small"
                helperText="Shows up as a column in Chats and the download"
                sx={{ maxWidth: 360 }}
              />
            </Box>
          )}

          {node.type === 'QUESTION' && (
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 2 }}>
              <TextField
                label="Save the answer as"
                value={node.variable ?? ''}
                onChange={(e) => set({ variable: e.target.value.replace(/[^\w]/g, '_').slice(0, 40) })}
                size="small"
                helperText={node.variable ? `Use {{${node.variable}}} in later messages` : 'For example company_name'}
                required
              />
              <TextField select label="Answer must be" value={node.validation ?? 'TEXT'} onChange={(e) => set({ validation: e.target.value as BotNode['validation'] })} size="small">
                <MenuItem value="TEXT">Any text</MenuItem>
                <MenuItem value="NUMBER">A number</MenuItem>
                <MenuItem value="EMAIL">An email address</MenuItem>
                <MenuItem value="PHONE">A phone number</MenuItem>
              </TextField>
            </Box>
          )}

          {(node.type === 'MESSAGE' || node.type === 'QUESTION') && <Box>{nextSelect(node.next, (v) => set({ next: v }), 'After this')}</Box>}
          {node.type === 'HANDOFF' && (
            <Typography variant="body2" color="text.secondary">
              The chat shows up in Incoming messages for your team to answer. The bot stays quiet for this person until
              your team ends the chat in Chats, or for a day.
            </Typography>
          )}
        </Box>
      </Collapse>
    </Paper>
  );
}
