'use client';
import MenuIcon from '@mui/icons-material/Menu';
import { Box, CircularProgress, Drawer, IconButton } from '@mui/material';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import AccountMenu from '@/components/AccountMenu';
import Sidebar from '@/components/Sidebar';
import { useAuth } from '@/lib/auth';
import { brand } from '@/lib/theme';

const SIDEBAR_WIDTH = 264;

export default function PanelLayout({ children }: { children: React.ReactNode }) {
  const { me, loading } = useAuth();
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    if (!loading && !me) router.replace('/login');
  }, [loading, me, router]);

  if (loading || !me) {
    return (
      <Box sx={{ minHeight: '100dvh', display: 'grid', placeItems: 'center' }}>
        <CircularProgress aria-label="Loading" />
      </Box>
    );
  }

  return (
    <Box sx={{ display: 'flex', minHeight: '100dvh' }}>
      <Box sx={{ width: SIDEBAR_WIDTH, flexShrink: 0, display: { xs: 'none', md: 'block' } }}>
        <Box sx={{ position: 'fixed', width: SIDEBAR_WIDTH, height: '100dvh' }}>
          <Sidebar me={me} />
        </Box>
      </Box>
      <Drawer
        open={mobileOpen}
        onClose={() => setMobileOpen(false)}
        sx={{ display: { md: 'none' } }}
        slotProps={{ paper: { sx: { width: SIDEBAR_WIDTH, bgcolor: brand.pine } } }}
      >
        <Sidebar me={me} onNavigate={() => setMobileOpen(false)} />
      </Drawer>

      <Box sx={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        <Box
          component="header"
          sx={{
            height: 60,
            px: { xs: 1.5, sm: 3 },
            display: 'flex',
            alignItems: 'center',
            borderBottom: 1,
            borderColor: 'divider',
            bgcolor: 'background.paper',
            position: 'sticky',
            top: 0,
            zIndex: 10,
          }}
        >
          <IconButton
            aria-label="Open menu"
            onClick={() => setMobileOpen(true)}
            sx={{ display: { md: 'none' } }}
          >
            <MenuIcon />
          </IconButton>
          <Box sx={{ flex: 1 }} />
          <AccountMenu />
        </Box>
        <Box component="main" sx={{ flex: 1, p: { xs: 2, sm: 3, lg: 4 }, maxWidth: 1400, width: '100%' }}>
          {children}
        </Box>
      </Box>
    </Box>
  );
}
