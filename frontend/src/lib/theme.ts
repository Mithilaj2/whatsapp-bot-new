'use client';
import { createTheme } from '@mui/material/styles';

/** We Brand 360 palette: deep pine chrome, pine actions, saffron only for warnings. */
export const brand = {
  pine: '#123B33',
  pineSoft: '#1B4A40',
  action: '#0F7A62',
  bubble: '#DDF3E7',
  surface: '#F4F7F6',
  paper: '#FFFFFF',
  ink: '#18211F',
  muted: '#5E6B68',
  line: '#DCE3E1',
  saffron: '#D98E1F',
  danger: '#C2412D',
};

export const theme = createTheme({
  palette: {
    primary: { main: brand.action, contrastText: '#FFFFFF' },
    secondary: { main: brand.pine },
    warning: { main: brand.saffron },
    error: { main: brand.danger },
    background: { default: brand.surface, paper: brand.paper },
    text: { primary: brand.ink, secondary: brand.muted },
    divider: brand.line,
  },
  shape: { borderRadius: 10 },
  typography: {
    fontFamily: '"Onest", system-ui, sans-serif',
    h1: { fontSize: '1.625rem', fontWeight: 650, letterSpacing: '-0.01em' },
    h2: { fontSize: '1.25rem', fontWeight: 650 },
    h3: { fontSize: '1.0625rem', fontWeight: 600 },
    body1: { fontSize: '0.9375rem', lineHeight: 1.55 },
    body2: { fontSize: '0.875rem', lineHeight: 1.5 },
    button: { textTransform: 'none', fontWeight: 600 },
  },
  components: {
    MuiButton: {
      defaultProps: { disableElevation: true },
      styleOverrides: { root: { borderRadius: 8, paddingInline: 16 } },
    },
    MuiPaper: {
      defaultProps: { elevation: 0 },
      styleOverrides: { outlined: { borderColor: brand.line } },
    },
    MuiTableCell: {
      styleOverrides: {
        head: { fontWeight: 600, color: brand.muted, fontSize: '0.8125rem', backgroundColor: brand.surface },
        body: { fontVariantNumeric: 'tabular-nums' },
      },
    },
    MuiTab: { styleOverrides: { root: { textTransform: 'none', fontWeight: 600, minHeight: 44 } } },
    MuiTabs: { styleOverrides: { root: { minHeight: 44 } } },
    MuiChip: { styleOverrides: { root: { fontWeight: 600, borderRadius: 6 } } },
    MuiTextField: { defaultProps: { size: 'small' } },
    MuiButtonBase: {
      styleOverrides: {
        root: { '&.Mui-focusVisible': { outline: `2px solid ${brand.action}`, outlineOffset: 2 } },
      },
    },
  },
});
