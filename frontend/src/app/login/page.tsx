'use client';
import Visibility from '@mui/icons-material/Visibility';
import VisibilityOff from '@mui/icons-material/VisibilityOff';
import { Alert, Box, Button, IconButton, InputAdornment, Stack, TextField, Typography } from '@mui/material';
import { useRouter } from 'next/navigation';
import { FormEvent, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { brand } from '@/lib/theme';

interface Branding {
  brandName: string;
  logoUrl: string | null;
}

export default function LoginPage() {
  const router = useRouter();
  const { me, login } = useAuth();
  const [branding, setBranding] = useState<Branding>({ brandName: '', logoUrl: null });
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (me) router.replace('/dashboard');
  }, [me, router]);

  useEffect(() => {
    // A reseller's own domain shows the reseller's name and logo
    api<Branding>('/public/branding', { query: { host: window.location.host } })
      .then((b) => {
        setBranding(b);
        document.title = b.brandName;
      })
      .catch(() => setBranding({ brandName: 'We Brand 360', logoUrl: null }));
  }, []);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await login(username, password);
      router.replace('/dashboard');
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <Box sx={{ minHeight: '100dvh', display: 'grid', gridTemplateColumns: { xs: '1fr', md: '5fr 6fr' } }}>
      <Box
        sx={{
          display: { xs: 'none', md: 'flex' },
          flexDirection: 'column',
          justifyContent: 'space-between',
          bgcolor: brand.pine,
          color: '#E8F2EE',
          p: 6,
        }}
      >
        <BrandMark name={branding.brandName} logoUrl={branding.logoUrl} light />
        <Stack spacing={1.5} sx={{ maxWidth: 380 }}>
          <Bubble side="in">Hi, do you deliver to Koramangala?</Bubble>
          <Bubble side="out">Yes! Same-day delivery before 6 pm. Want the menu?</Bubble>
          <Bubble side="in">Send it 🙌</Bubble>
        </Stack>
        <Typography variant="body2" sx={{ color: '#A9C4BB', maxWidth: 360 }}>
          Send WhatsApp campaigns, answer replies and run chatbots for every business you manage.
        </Typography>
      </Box>

      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', p: { xs: 3, sm: 6 } }}>
        <Box component="form" onSubmit={submit} sx={{ width: '100%', maxWidth: 360 }}>
          <Box sx={{ display: { md: 'none' }, mb: 4 }}>
            <BrandMark name={branding.brandName} logoUrl={branding.logoUrl} />
          </Box>
          <Typography variant="h1" sx={{ mb: 0.5 }}>
            Log in
          </Typography>
          <Typography color="text.secondary" sx={{ mb: 3 }}>
            Use the username and password your provider gave you.
          </Typography>

          <Stack spacing={2}>
            {error && <Alert severity="error">{error}</Alert>}
            <TextField
              label="Username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoComplete="username"
              autoFocus
              required
              size="medium"
            />
            <TextField
              label="Password"
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              required
              size="medium"
              slotProps={{
                input: {
                  endAdornment: (
                    <InputAdornment position="end">
                      <IconButton
                        aria-label={showPassword ? 'Hide password' : 'Show password'}
                        onClick={() => setShowPassword((s) => !s)}
                        edge="end"
                      >
                        {showPassword ? <VisibilityOff /> : <Visibility />}
                      </IconButton>
                    </InputAdornment>
                  ),
                },
              }}
            />
            <Button type="submit" variant="contained" size="large" disabled={busy}>
              {busy ? 'Logging in…' : 'Log in'}
            </Button>
          </Stack>
        </Box>
      </Box>
    </Box>
  );
}

function BrandMark({ name, logoUrl, light }: { name: string; logoUrl: string | null; light?: boolean }) {
  if (logoUrl) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={logoUrl} alt={name} style={{ height: 36, objectFit: 'contain', alignSelf: 'flex-start' }} />;
  }
  return (
    <Typography sx={{ fontWeight: 700, fontSize: '1.25rem', color: light ? '#FFFFFF' : brand.pine, minHeight: 30 }}>
      {name}
    </Typography>
  );
}

function Bubble({ side, children }: { side: 'in' | 'out'; children: React.ReactNode }) {
  const out = side === 'out';
  return (
    <Box
      sx={{
        alignSelf: out ? 'flex-end' : 'flex-start',
        maxWidth: '82%',
        px: 1.75,
        py: 1,
        fontSize: '0.9375rem',
        bgcolor: out ? brand.bubble : brand.pineSoft,
        color: out ? brand.pine : '#E8F2EE',
        borderRadius: out ? '14px 14px 4px 14px' : '14px 14px 14px 4px',
      }}
    >
      {children}
    </Box>
  );
}
