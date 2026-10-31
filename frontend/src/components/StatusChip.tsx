import { Chip } from '@mui/material';
import type { MessageStatus, TemplateStatus } from '@/lib/api';
import { messageStatusLabel, templateStatusLabel } from '@/lib/format';
import { brand } from '@/lib/theme';

type Tone = 'good' | 'wait' | 'bad' | 'plain';
const tones: Record<Tone, { bg: string; fg: string }> = {
  good: { bg: brand.bubble, fg: brand.pine },
  wait: { bg: '#FBF0DC', fg: '#7A4A06' },
  bad: { bg: '#F8E1DC', fg: '#8E2A18' },
  plain: { bg: brand.surface, fg: brand.ink },
};

const messageTone: Record<MessageStatus, Tone> = {
  QUEUED: 'plain',
  SENDING: 'plain',
  SENT: 'plain',
  DELIVERED: 'good',
  READ: 'good',
  FAILED: 'bad',
  RECEIVED: 'good',
};
const templateTone: Record<TemplateStatus, Tone> = {
  DRAFT: 'plain',
  PENDING: 'wait',
  APPROVED: 'good',
  REJECTED: 'bad',
  PAUSED: 'wait',
  DISABLED: 'bad',
};

export function MessageStatusChip({ status }: { status: MessageStatus }) {
  const t = tones[messageTone[status]];
  return <Chip size="small" label={messageStatusLabel[status]} sx={{ bgcolor: t.bg, color: t.fg }} />;
}

export function TemplateStatusChip({ status }: { status: TemplateStatus }) {
  const t = tones[templateTone[status]];
  return <Chip size="small" label={templateStatusLabel[status]} sx={{ bgcolor: t.bg, color: t.fg }} />;
}

export function ToneChip({ label, tone }: { label: string; tone: Tone }) {
  const t = tones[tone];
  return <Chip size="small" label={label} sx={{ bgcolor: t.bg, color: t.fg }} />;
}
