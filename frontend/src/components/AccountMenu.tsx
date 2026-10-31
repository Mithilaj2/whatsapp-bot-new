'use client';
import {
  Alert,
  Avatar,
  Box,
  Button,
  ButtonBase,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  Menu,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { FormEvent, useState } from 'react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { typeLabel } from '@/lib/format';
import { brand } from '@/lib/theme';

export default function AccountMenu() {
  const { me, logout } = useAuth();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [pwOpen, setPwOpen] = useState(false);
  if (!me) return null;

  const initials = me.name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join('');

  return (
    <>
      <ButtonBase
        onClick={(e) => setAnchor(e.currentTarget)}
        aria-label="Account menu"
        sx={{ borderRadius: 2, px: 1, py: 0.5, gap: 1.25 }}
      >
        <Box sx={{ textAlign: 'right', display: { xs: 'none', sm: 'block' } }}>
          <Typography sx={{ fontWeight: 600, fontSize: '0.875rem', lineHeight: 1.2 }}>{me.name}</Typography>
          <Typography sx={{ fontSize: '0.75rem', color: 'text.secondary' }}>{typeLabel[me.account.type]}</Typography>
        </Box>
        <Avatar sx={{ width: 34, height: 34, bgcolor: brand.pine, fontSize: '0.8125rem', fontWeight: 600 }}>
          {initials}
        </Avatar>
      </ButtonBase>
      <Menu
        anchorEl={anchor}
        open={Boolean(anchor)}
        onClose={() => setAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
      >
        <Box sx={{ px: 2, py: 1, minWidth: 220 }}>
          <Typography sx={{ fontWeight: 600 }}>{me.username}</Typography>
          {me.account.parent && (
            <Typography variant="body2" color="text.secondary">
              Provided by {me.account.parent.name}
            </Typography>
          )}
        </Box>
        <Divider />
        <MenuItem
          onClick={() => {
            setAnchor(null);
            setPwOpen(true);
          }}
        >
          Change password
        </MenuItem>
        <MenuItem onClick={logout}>Log out</MenuItem>
      </Menu>
      <ChangePasswordDialog open={pwOpen} onClose={() => setPwOpen(false)} />
    </>
  );
}

function ChangePasswordDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  function close() {
    setCurrent('');
    setNext('');
    setError('');
    setDone(false);
    onClose();
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api('/auth/change-password', { method: 'POST', body: { currentPassword: current, newPassword: next } });
      setDone(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onClose={close} fullWidth maxWidth="xs">
      <form onSubmit={submit}>
        <DialogTitle>Change password</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 1 }}>
            {error && <Alert severity="error">{error}</Alert>}
            {done ? (
              <Alert severity="success">Password changed. Use the new one next time you log in.</Alert>
            ) : (
              <>
                <TextField
                  label="Current password"
                  type="password"
                  value={current}
                  onChange={(e) => setCurrent(e.target.value)}
                  autoComplete="current-password"
                  required
                />
                <TextField
                  label="New password"
                  type="password"
                  value={next}
                  onChange={(e) => setNext(e.target.value)}
                  autoComplete="new-password"
                  helperText="At least 8 characters"
                  required
                />
              </>
            )}
          </Stack>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={close}>{done ? 'Close' : 'Cancel'}</Button>
          {!done && (
            <Button type="submit" variant="contained" disabled={busy || next.length < 8}>
              Change password
            </Button>
          )}
        </DialogActions>
      </form>
    </Dialog>
  );
}
