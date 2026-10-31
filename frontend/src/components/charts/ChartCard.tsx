'use client';
import TableChartOutlined from '@mui/icons-material/TableChartOutlined';
import InsertChartOutlined from '@mui/icons-material/InsertChartOutlined';
import { Box, IconButton, Paper, Table, TableBody, TableCell, TableHead, TableRow, Tooltip, Typography } from '@mui/material';
import { useState } from 'react';
import { ink } from './tokens';

export interface LegendItem {
  label: string;
  color: string;
  kind?: 'bar' | 'line';
}

/** A chart's frame: title, legend, and a switch to see the same numbers as a table. */
export default function ChartCard({
  title,
  subtitle,
  legend,
  table,
  children,
  dim,
}: {
  title: string;
  subtitle?: string;
  legend?: LegendItem[];
  table?: { columns: string[]; rows: (string | number)[][] };
  children: React.ReactNode;
  /** Reloading: keep the old chart, faded. */
  dim?: boolean;
}) {
  const [asTable, setAsTable] = useState(false);
  return (
    <Paper variant="outlined" sx={{ p: 2.5, display: 'flex', flexDirection: 'column', gap: 1.5, minWidth: 0 }}>
      <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="h3">{title}</Typography>
          {subtitle && (
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25 }}>
              {subtitle}
            </Typography>
          )}
        </Box>
        {table && (
          <Tooltip title={asTable ? 'Show chart' : 'Show as table'}>
            <IconButton size="small" aria-label={asTable ? `Show ${title} as chart` : `Show ${title} as table`} onClick={() => setAsTable((v) => !v)}>
              {asTable ? <InsertChartOutlined fontSize="small" /> : <TableChartOutlined fontSize="small" />}
            </IconButton>
          </Tooltip>
        )}
      </Box>
      {legend && legend.length > 1 && !asTable && (
        <Box component="ul" sx={{ display: 'flex', flexWrap: 'wrap', gap: 2, m: 0, p: 0, listStyle: 'none' }}>
          {legend.map((l) => (
            <Box component="li" key={l.label} sx={{ display: 'flex', alignItems: 'center', gap: 0.75, fontSize: '0.8125rem', color: ink.secondary }}>
              <Box
                aria-hidden
                sx={l.kind === 'line' ? { width: 14, height: 2, borderRadius: 1, bgcolor: l.color } : { width: 10, height: 10, borderRadius: '3px', bgcolor: l.color }}
              />
              {l.label}
            </Box>
          ))}
        </Box>
      )}
      <Box sx={{ opacity: dim ? 0.55 : 1, transition: 'opacity .2s', minWidth: 0 }}>
        {asTable && table ? (
          <Box sx={{ overflowX: 'auto', maxHeight: 320 }}>
            <Table size="small" stickyHeader>
              <TableHead>
                <TableRow>
                  {table.columns.map((c, i) => (
                    <TableCell key={c} align={i ? 'right' : 'left'}>
                      {c}
                    </TableCell>
                  ))}
                </TableRow>
              </TableHead>
              <TableBody>
                {table.rows.map((r, i) => (
                  <TableRow key={i}>
                    {r.map((v, j) => (
                      <TableCell key={j} align={j ? 'right' : 'left'} sx={{ fontVariantNumeric: 'tabular-nums' }}>
                        {typeof v === 'number' ? v.toLocaleString('en-IN') : v}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Box>
        ) : (
          children
        )}
      </Box>
    </Paper>
  );
}
