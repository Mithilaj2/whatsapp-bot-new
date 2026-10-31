'use client';
import { Box, Button, Paper, Tab, TablePagination, Tabs, Typography } from '@mui/material';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { NotificationRow } from '@/components/NotificationBell';
import PageHeader from '@/components/PageHeader';
import { api, AppNotification, Page } from '@/lib/api';

export default function NotificationsPage() {
  const router = useRouter();
  const [tab, setTab] = useState<'all' | 'unread'>('all');
  const [page, setPage] = useState(0);
  const [data, setData] = useState<(Page<AppNotification> & { unread: number }) | null>(null);

  const load = useCallback(() => {
    api<Page<AppNotification> & { unread: number }>('/notifications', { query: { unread: tab === 'unread' ? 'true' : undefined, page: page + 1, pageSize: 25 } })
      .then(setData)
      .catch(() => {});
  }, [tab, page]);
  useEffect(load, [load]);

  async function open(n: AppNotification) {
    if (!n.readAt) await api(`/notifications/${n.id}/read`, { method: 'POST' }).catch(() => {});
    if (n.link) router.push(n.link);
    else load();
  }

  return (
    <>
      <PageHeader
        title="Notifications"
        description="Campaign results, credits, brand reviews, bot hand-overs and number alerts. Kept for 90 days."
        actions={
          data && data.unread > 0 ? (
            <Button variant="outlined" onClick={() => api('/notifications/read-all', { method: 'POST' }).then(load)}>
              Mark all read
            </Button>
          ) : undefined
        }
      />
      <Paper variant="outlined" sx={{ overflow: 'hidden' }}>
        <Tabs value={tab} onChange={(_, v) => { setTab(v); setPage(0); }} sx={{ px: 2, borderBottom: 1, borderColor: 'divider' }}>
          <Tab value="all" label="All" />
          <Tab value="unread" label={`Unread${data ? ` (${data.unread})` : ''}`} />
        </Tabs>
        {data?.items.map((n) => (
          <Box key={n.id} sx={{ borderBottom: 1, borderColor: 'divider' }}>
            <NotificationRow n={n} onOpen={open} />
          </Box>
        ))}
        {data && data.items.length === 0 && (
          <Typography color="text.secondary" sx={{ p: 5, textAlign: 'center' }}>
            {tab === 'unread' ? "You're all caught up." : 'Nothing yet. Campaign results, credits and alerts show up here.'}
          </Typography>
        )}
        <TablePagination component="div" count={data?.total ?? 0} page={page} onPageChange={(_, p) => setPage(p)} rowsPerPage={25} rowsPerPageOptions={[25]} />
      </Paper>
    </>
  );
}
