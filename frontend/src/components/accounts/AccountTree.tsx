'use client';
import { Box, Chip, Typography } from '@mui/material';
import { TreeNode } from '@/lib/api';
import { typeLabel } from '@/lib/format';
import { brand } from '@/lib/theme';

/** Indented view of who sits under whom. */
export default function AccountTree({ nodes, rootId }: { nodes: TreeNode[]; rootId: string }) {
  const byParent = new Map<string, TreeNode[]>();
  for (const n of nodes) {
    if (!n.parentId) continue;
    byParent.set(n.parentId, [...(byParent.get(n.parentId) ?? []), n]);
  }
  const root = nodes.find((n) => n.id === rootId);
  if (!root) return null;

  return (
    <Box component="ul" sx={{ listStyle: 'none', m: 0, p: 2 }} aria-label="Account tree">
      <Node node={root} byParent={byParent} isRoot />
    </Box>
  );
}

function Node({ node, byParent, isRoot }: { node: TreeNode; byParent: Map<string, TreeNode[]>; isRoot?: boolean }) {
  const children = byParent.get(node.id) ?? [];
  return (
    <Box component="li">
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, py: 0.75 }}>
        <Typography sx={{ fontWeight: isRoot ? 650 : 500 }}>{node.name}</Typography>
        <Typography variant="body2" color="text.secondary">
          {node.username}
        </Typography>
        {!isRoot && (
          <Chip
            size="small"
            label={typeLabel[node.type]}
            sx={{
              bgcolor: node.type === 'RESELLER' ? brand.bubble : 'background.default',
              color: brand.pine,
            }}
          />
        )}
        {node.status === 'SUSPENDED' && <Chip size="small" color="warning" label="Suspended" />}
      </Box>
      {children.length > 0 && (
        <Box
          component="ul"
          sx={{ listStyle: 'none', m: 0, pl: 2.5, ml: 1, borderLeft: 1, borderColor: 'divider' }}
        >
          {children.map((c) => (
            <Node key={c.id} node={c} byParent={byParent} />
          ))}
        </Box>
      )}
    </Box>
  );
}
