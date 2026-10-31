'use client';
import AccountTreeOutlined from '@mui/icons-material/AccountTreeOutlined';
import Add from '@mui/icons-material/Add';
import DeleteOutline from '@mui/icons-material/DeleteOutline';
import EditOutlined from '@mui/icons-material/EditOutlined';
import Search from '@mui/icons-material/Search';
import ViewListOutlined from '@mui/icons-material/ViewListOutlined';
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  InputAdornment,
  Paper,
  Snackbar,
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
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from '@mui/material';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import PageHeader from '@/components/PageHeader';
import { Account, api, Page, TreeNode } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { formatDate, typeLabel } from '@/lib/format';
import { brand } from '@/lib/theme';
import AccountDialog from './AccountDialog';
import AccountTree from './AccountTree';

export type AccountsTab = 'all' | 'resellers' | 'customers';

const tabs: { value: AccountsTab; label: string; href: string; type?: 'RESELLER' | 'CUSTOMER' }[] = [
  { value: 'all', label: 'All', href: '/accounts' },
  { value: 'resellers', label: 'Resellers', href: '/accounts/resellers', type: 'RESELLER' },
  { value: 'customers', label: 'Customers', href: '/accounts/customers', type: 'CUSTOMER' },
];

export default function AccountsView({ tab }: { tab: AccountsTab }) {
  const { me } = useAuth();
  const router = useRouter();
  const params = useSearchParams();
  const current = tabs.find((t) => t.value === tab)!;

  const [view, setView] = useState<'list' | 'tree'>('list');
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(10);
  const [data, setData] = useState<Page<Account> | null>(null);
  const [tree, setTree] = useState<TreeNode[]>([]);
  const [error, setError] = useState('');
  const [dialog, setDialog] = useState<
    { kind: 'create'; defaultType: 'RESELLER' | 'CUSTOMER' } | { kind: 'edit'; account: Account } | null
  >(null);
  const [toDelete, setToDelete] = useState<Account | null>(null);
  const [deleteError, setDeleteError] = useState('');
  const [toast, setToast] = useState('');

  // Wait a moment after typing before searching
  useEffect(() => {
    const t = setTimeout(() => {
      setQuery(search.trim());
      setPage(0);
    }, 300);
    return () => clearTimeout(t);
  }, [search]);

  const load = useCallback(() => {
    setError('');
    api<Page<Account>>('/accounts', {
      query: { type: current.type, search: query, page: page + 1, pageSize },
    })
      .then(setData)
      .catch((e) => setError(e.message));
  }, [current.type, query, page, pageSize]);

  const loadTree = useCallback(() => {
    api<TreeNode[]>('/accounts/tree').then(setTree).catch(() => setTree([]));
  }, []);

  useEffect(load, [load]);
  useEffect(loadTree, [loadTree]);

  // Dashboard "Add customer" link opens the form straight away
  useEffect(() => {
    if (params.get('new')) {
      setDialog({ kind: 'create', defaultType: 'CUSTOMER' });
      router.replace(current.href);
    }
  }, [params, router, current.href]);

  const parents = useMemo(() => tree.filter((n) => n.type !== 'CUSTOMER'), [tree]);
  if (!me) return null;

  async function confirmDelete() {
    if (!toDelete) return;
    setDeleteError('');
    try {
      await api(`/accounts/${toDelete.id}`, { method: 'DELETE' });
      setToast(`${toDelete.username} deleted`);
      setToDelete(null);
      load();
      loadTree();
    } catch (e) {
      setDeleteError((e as Error).message);
    }
  }

  const addType = tab === 'resellers' ? 'RESELLER' : 'CUSTOMER';
  const hasFilter = query !== '';

  return (
    <>
      <PageHeader
        title="Resellers & customers"
        description="Everyone who buys from you, and everyone your resellers add."
        actions={
          <Button
            variant="contained"
            startIcon={<Add />}
            onClick={() => setDialog({ kind: 'create', defaultType: addType })}
          >
            Add {addType === 'RESELLER' ? 'reseller' : 'customer'}
          </Button>
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
          <Tabs value={tab} sx={{ flex: '1 1 auto' }}>
            {tabs.map((t) => (
              <Tab key={t.value} value={t.value} label={t.label} component={Link} href={t.href} />
            ))}
          </Tabs>
          <TextField
            placeholder="Search name, username, email or domain"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            sx={{ width: { xs: '100%', sm: 320 }, my: 1 }}
            slotProps={{
              input: {
                startAdornment: (
                  <InputAdornment position="start">
                    <Search fontSize="small" />
                  </InputAdornment>
                ),
              },
              htmlInput: { 'aria-label': 'Search accounts' },
            }}
          />
          <ToggleButtonGroup
            exclusive
            size="small"
            value={view}
            onChange={(_, v) => v && setView(v)}
            aria-label="View"
            sx={{ my: 1 }}
          >
            <ToggleButton value="list" aria-label="List view">
              <ViewListOutlined fontSize="small" />
            </ToggleButton>
            <ToggleButton value="tree" aria-label="Tree view">
              <AccountTreeOutlined fontSize="small" />
            </ToggleButton>
          </ToggleButtonGroup>
        </Box>

        {error && (
          <Alert severity="error" sx={{ m: 2 }}>
            {error}
          </Alert>
        )}

        {view === 'tree' ? (
          <AccountTree nodes={tree} rootId={me.account.id} />
        ) : (
          <>
            <TableContainer>
              <Table size="medium">
                <TableHead>
                  <TableRow>
                    <TableCell>Business</TableCell>
                    <TableCell>Type</TableCell>
                    <TableCell>Under</TableCell>
                    <TableCell>Contact</TableCell>
                    <TableCell>Domain</TableCell>
                    <TableCell>Added</TableCell>
                    <TableCell align="right">
                      <Box component="span" sx={{ position: 'absolute', left: -9999 }}>
                        Actions
                      </Box>
                    </TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {data?.items.map((a) => (
                    <TableRow key={a.id} hover>
                      <TableCell>
                        <Typography sx={{ fontWeight: 600 }}>{a.name}</Typography>
                        <Typography variant="body2" color="text.secondary">
                          {a.username}
                        </Typography>
                      </TableCell>
                      <TableCell>
                        <Box sx={{ display: 'flex', gap: 0.75, flexWrap: 'wrap' }}>
                          <Chip
                            size="small"
                            label={typeLabel[a.type]}
                            sx={{
                              bgcolor: a.type === 'RESELLER' ? brand.bubble : 'background.default',
                              color: brand.pine,
                            }}
                          />
                          {a.status === 'SUSPENDED' && <Chip size="small" color="warning" label="Suspended" />}
                        </Box>
                      </TableCell>
                      <TableCell>{a.parent?.id === me.account.id ? 'You' : a.parent?.username}</TableCell>
                      <TableCell>
                        <Typography variant="body2">{a.email || '—'}</Typography>
                        {a.phone && (
                          <Typography variant="body2" color="text.secondary">
                            {a.phone}
                          </Typography>
                        )}
                      </TableCell>
                      <TableCell>{a.domain || '—'}</TableCell>
                      <TableCell sx={{ whiteSpace: 'nowrap' }}>{formatDate(a.createdAt)}</TableCell>
                      <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                        <Tooltip title="Edit">
                          <IconButton aria-label={`Edit ${a.username}`} onClick={() => setDialog({ kind: 'edit', account: a })}>
                            <EditOutlined fontSize="small" />
                          </IconButton>
                        </Tooltip>
                        <Tooltip title="Delete">
                          <IconButton
                            aria-label={`Delete ${a.username}`}
                            onClick={() => {
                              setDeleteError('');
                              setToDelete(a);
                            }}
                          >
                            <DeleteOutline fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>

            {data && data.items.length === 0 && (
              <Box sx={{ py: 6, px: 3, textAlign: 'center' }}>
                <Typography variant="h3">
                  {hasFilter ? `Nothing matches "${query}"` : `No ${current.label.toLowerCase()} yet`}
                </Typography>
                <Typography color="text.secondary" sx={{ mt: 0.5 }}>
                  {hasFilter
                    ? 'Try a different name, username or email.'
                    : 'Add an account and give them their username and password.'}
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
              rowsPerPageOptions={[10, 25, 50]}
            />
          </>
        )}
      </Paper>

      {dialog && (
        <AccountDialog
          open
          mode={dialog}
          myAccountId={me.account.id}
          parents={parents}
          onClose={() => setDialog(null)}
          onSaved={(_, message) => {
            setDialog(null);
            setToast(message);
            load();
            loadTree();
          }}
        />
      )}

      <Dialog open={Boolean(toDelete)} onClose={() => setToDelete(null)} maxWidth="xs" fullWidth>
        <DialogTitle>Delete {toDelete?.username}?</DialogTitle>
        <DialogContent>
          {deleteError ? (
            <Alert severity="error">{deleteError}</Alert>
          ) : (
            <Typography>
              {toDelete?.name} will no longer be able to log in. Their history is kept for your records.
            </Typography>
          )}
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button onClick={() => setToDelete(null)}>Cancel</Button>
          {!deleteError && (
            <Button color="error" variant="contained" onClick={confirmDelete}>
              Delete
            </Button>
          )}
        </DialogActions>
      </Dialog>

      <Snackbar
        open={Boolean(toast)}
        autoHideDuration={4000}
        onClose={() => setToast('')}
        message={toast}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      />
    </>
  );
}
