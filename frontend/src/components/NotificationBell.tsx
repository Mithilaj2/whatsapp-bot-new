'use client';
import CheckCircleOutline from '@mui/icons-material/CheckCircleOutline';
import ErrorOutline from '@mui/icons-material/ErrorOutline';
import InfoOutlined from '@mui/icons-material/InfoOutlined';
import NotificationsNoneOutlined from '@mui/icons-material/NotificationsNoneOutlined';
import WarningAmberOutlined from '@mui/icons-material/WarningAmberOutlined';
import { Badge, Box, Button, ButtonBase, Divider, IconButton, Popover, Tooltip, Typography } from '@mui/material';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { api, AppNotification, Page } from '@/lib/api';
import { brand } from '@/lib/theme';

const levelIcon = {
  INFO: { Icon: InfoOutlined, color: '#2a78d6', label: 'Info' },
  SUCCESS: { Icon: CheckCircleOutline, color: '#0b8a68', label: 'Done' },
  WARNING: { Icon: WarningAmberOutlined, color: '#b9770e', label: 'Needs attention' },
  ERROR: { Icon: ErrorOutline, color: '#d03b3b', label: 'Problem' },
} as const;

const ago = (iso: string) => {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 7 * 86400) return `${Math.floor(s / 86400)} d ago`;
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
};

/** One notification row, used in the bell and on the notifications page. */
export function NotificationRow({ n, onOpen }: { n: AppNotification; onOpen: (n: AppNotification) => void }) {
  const l = levelIcon[n.level];
  return (
    <ButtonBase
      onClick={() => onOpen(n)}
      sx={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 1.5,
        width: '100%',
        textAlign: 'left',
        px: 2,
        py: 1.5,
        bgcolor: n.readAt ? 'transparent' : '#F1F8F5',
        '&:hover, &.Mui-focusVisible': { bgcolor: brand.surface },
      }}
    >
      <l.Icon aria-label={l.label} sx={{ color: l.color, fontSize: 20, mt: 0.25 }} />
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography sx={{ fontWeight: n.readAt ? 500 : 650, fontSize: '0.9rem' }}>{n.title}</Typography>
        {n.body && (
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25 }}>
            {n.body}
          </Typography>
        )}
        <Typography sx={{ fontSize: '0.75rem', color: brand.muted, mt: 0.5 }}>{ago(n.createdAt)}</Typography>
      </Box>
      {!n.readAt && <Box aria-label="Unread" sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: brand.action, mt: 0.75, flexShrink: 0 }} />}
    </ButtonBase>
  );
}

/** The bell in the top bar: unread count, latest notifications. */
export default function NotificationBell() {
  const router = useRouter();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [unread, setUnread] = useState(0);
  const [items, setItems] = useState<AppNotification[] | null>(null);

  const refreshCount = useCallback(() => {
    api<{ unread: number }>('/notifications/unread-count')
      .then((r) => setUnread(r.unread))
      .catch(() => {});
  }, []);

  useEffect(() => {
    refreshCount();
    const t = setInterval(() => {
      if (document.visibilityState === 'visible') refreshCount();
    }, 30_000);
    return () => clearInterval(t);
  }, [refreshCount]);

  function open(e: React.MouseEvent<HTMLElement>) {
    setAnchor(e.currentTarget);
    setItems(null);
    api<Page<AppNotification> & { unread: number }>('/notifications', { query: { pageSize: 8 } })
      .then((r) => {
        setItems(r.items);
        setUnread(r.unread);
      })
      .catch(() => setItems([]));
  }

  async function go(n: AppNotification) {
    if (!n.readAt) {
      await api(`/notifications/${n.id}/read`, { method: 'POST' }).catch(() => {});
      setUnread((u) => Math.max(0, u - 1));
    }
    setAnchor(null);
    if (n.link) router.push(n.link);
  }

  async function readAll() {
    await api('/notifications/read-all', { method: 'POST' }).catch(() => {});
    setUnread(0);
    setItems((list) => list?.map((x) => ({ ...x, readAt: x.readAt ?? new Date().toISOString() })) ?? null);
  }

  return (
    <>
      <Tooltip title="Notifications">
        <IconButton aria-label={unread ? `Notifications, ${unread} unread` : 'Notifications'} onClick={open} sx={{ mr: 1 }}>
          <Badge badgeContent={unread} color="error" max={99}>
            <NotificationsNoneOutlined />
          </Badge>
        </IconButton>
      </Tooltip>
      <Popover
        open={Boolean(anchor)}
        anchorEl={anchor}
        onClose={() => setAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        slotProps={{ paper: { sx: { width: 380, maxWidth: 'calc(100vw - 24px)', mt: 1 } } }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', px: 2, py: 1.25 }}>
          <Typography variant="h3" sx={{ flex: 1 }}>
            Notifications
          </Typography>
          {unread > 0 && (
            <Button size="small" onClick={readAll}>
              Mark all read
            </Button>
          )}
        </Box>
        <Divider />
        <Box sx={{ maxHeight: 420, overflowY: 'auto' }}>
          {items === null ? (
            <Typography color="text.secondary" sx={{ p: 3, textAlign: 'center' }}>
              Loading…
            </Typography>
          ) : items.length === 0 ? (
            <Typography color="text.secondary" sx={{ p: 3, textAlign: 'center' }}>
              Nothing yet. Campaign results, credits and alerts show up here.
            </Typography>
          ) : (
            items.map((n) => (
              <Box key={n.id} sx={{ borderBottom: 1, borderColor: 'divider' }}>
                <NotificationRow n={n} onOpen={go} />
              </Box>
            ))
          )}
        </Box>
        <Box sx={{ p: 1, textAlign: 'center' }}>
          <Button component={Link} href="/notifications" onClick={() => setAnchor(null)} size="small">
            See all
          </Button>
        </Box>
      </Popover>
    </>
  );
}
