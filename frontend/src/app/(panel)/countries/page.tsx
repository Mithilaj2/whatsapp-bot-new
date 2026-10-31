'use client';
import Search from '@mui/icons-material/Search';
import {
  Alert,
  Box,
  Chip,
  InputAdornment,
  Paper,
  Switch,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TablePagination,
  TableRow,
  Tabs,
  TextField,
  Typography,
} from '@mui/material';
import { useCallback, useEffect, useState } from 'react';
import PageHeader from '@/components/PageHeader';
import { api, Country, Page } from '@/lib/api';
import { useAuth } from '@/lib/auth';

type Status = 'all' | 'active' | 'inactive';

export default function CountriesPage() {
  const { me } = useAuth();
  const isAdmin = me?.account.type === 'ADMIN';
  const [status, setStatus] = useState<Status>('all');
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const [data, setData] = useState<Page<Country> | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    const t = setTimeout(() => {
      setQuery(search.trim());
      setPage(0);
    }, 300);
    return () => clearTimeout(t);
  }, [search]);

  const load = useCallback(() => {
    api<Page<Country>>('/countries', { query: { status, search: query, page: page + 1, pageSize } })
      .then(setData)
      .catch((e) => setError(e.message));
  }, [status, query, page, pageSize]);

  useEffect(load, [load]);

  async function toggle(c: Country) {
    setError('');
    // Update the row straight away, then confirm with the server
    setData((d) => d && { ...d, items: d.items.map((x) => (x.id === c.id ? { ...x, isActive: !c.isActive } : x)) });
    try {
      await api(`/countries/${c.id}`, { method: 'PATCH', body: { isActive: !c.isActive } });
      if (status !== 'all') load();
    } catch (e) {
      setError((e as Error).message);
      load();
    }
  }

  return (
    <>
      <PageHeader
        title="Countries"
        description={
          isAdmin
            ? 'Campaigns can only go to numbers in active countries. Switch a country off to stop sending there.'
            : 'Campaigns can only go to numbers in active countries.'
        }
      />
      <Paper variant="outlined">
        <Box
          sx={{
            display: 'flex',
            flexWrap: 'wrap',
            alignItems: 'center',
            gap: 2,
            px: 2,
            borderBottom: 1,
            borderColor: 'divider',
          }}
        >
          <Tabs
            value={status}
            onChange={(_, v) => {
              setStatus(v);
              setPage(0);
            }}
            sx={{ flex: '1 1 auto' }}
          >
            <Tab value="all" label="All" />
            <Tab value="active" label="Active" />
            <Tab value="inactive" label="Inactive" />
          </Tabs>
          <TextField
            placeholder="Search name, code or +91"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            sx={{ width: { xs: '100%', sm: 280 }, my: 1 }}
            slotProps={{
              input: {
                startAdornment: (
                  <InputAdornment position="start">
                    <Search fontSize="small" />
                  </InputAdornment>
                ),
              },
              htmlInput: { 'aria-label': 'Search countries' },
            }}
          />
        </Box>

        {error && (
          <Alert severity="error" sx={{ m: 2 }}>
            {error}
          </Alert>
        )}

        <TableContainer>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>Country</TableCell>
                <TableCell>Code</TableCell>
                <TableCell>Dialling code</TableCell>
                <TableCell align="right">Status</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {data?.items.map((c) => (
                <TableRow key={c.id} hover>
                  <TableCell sx={{ fontWeight: 500 }}>{c.name}</TableCell>
                  <TableCell>{c.code}</TableCell>
                  <TableCell>+{c.isd}</TableCell>
                  <TableCell align="right">
                    {isAdmin ? (
                      <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5 }}>
                        <Typography variant="body2" color={c.isActive ? 'primary' : 'warning.main'} sx={{ fontWeight: 600 }}>
                          {c.isActive ? 'Active' : 'Inactive'}
                        </Typography>
                        <Switch
                          checked={c.isActive}
                          onChange={() => toggle(c)}
                          slotProps={{ input: { 'aria-label': `${c.name} active` } }}
                        />
                      </Box>
                    ) : (
                      <Chip
                        size="small"
                        label={c.isActive ? 'Active' : 'Inactive'}
                        color={c.isActive ? 'primary' : 'warning'}
                        variant="outlined"
                      />
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>

        {data && data.items.length === 0 && (
          <Box sx={{ py: 6, textAlign: 'center' }}>
            <Typography variant="h3">No countries match &ldquo;{query}&rdquo;</Typography>
            <Typography color="text.secondary" sx={{ mt: 0.5 }}>
              Search by country name, 2-letter code or dialling code.
            </Typography>
          </Box>
        )}

        <TablePagination
          component="div"
          count={data?.total ?? 0}
          page={page}
          onPageChange={(_, p) => setPage(p)}
          rowsPerPage={pageSize}
          onRowsPerPageChange={(e) => {
            setPageSize(Number(e.target.value));
            setPage(0);
          }}
          rowsPerPageOptions={[25, 50, 100]}
        />
      </Paper>
    </>
  );
}
