'use client';
import ExpandMore from '@mui/icons-material/ExpandMore';
import { Box, ButtonBase, Collapse, Typography } from '@mui/material';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import type { Me } from '@/lib/api';
import { typeLabel } from '@/lib/format';
import { brand } from '@/lib/theme';
import { nav, NavSection } from './nav';

const textOn = '#E3EEEA';
const textDim = '#93B1A7';

/** Active item is shaped like an outgoing WhatsApp bubble: one tight corner. */
const bubbleActive = {
  bgcolor: brand.bubble,
  color: brand.pine,
  borderRadius: '12px 12px 3px 12px',
};

export default function Sidebar({ me, onNavigate }: { me: Me; onNavigate?: () => void }) {
  const pathname = usePathname();
  const sections = nav.filter((s) => !s.only || s.only.includes(me.account.type));
  const brandName = me.account.type === 'ADMIN' ? me.account.brandName || me.account.name : me.account.name;

  return (
    <Box
      component="nav"
      aria-label="Main"
      sx={{ height: '100%', bgcolor: brand.pine, color: textOn, display: 'flex', flexDirection: 'column' }}
    >
      <Box sx={{ px: 2.5, pt: 3, pb: 2.5 }}>
        <Typography sx={{ fontWeight: 700, fontSize: '1.0625rem', color: '#FFFFFF' }} noWrap>
          {brandName}
        </Typography>
        <Typography sx={{ fontSize: '0.8125rem', color: textDim }}>{typeLabel[me.account.type]} panel</Typography>
      </Box>

      <Box sx={{ flex: 1, overflowY: 'auto', px: 1.5, pb: 3 }}>
        {sections.map((s) => (
          <Section key={s.label} section={s} pathname={pathname} onNavigate={onNavigate} />
        ))}
      </Box>
    </Box>
  );
}

function isActive(pathname: string, href: string) {
  return pathname === href;
}

function Section({
  section,
  pathname,
  onNavigate,
}: {
  section: NavSection;
  pathname: string;
  onNavigate?: () => void;
}) {
  const Icon = section.icon;
  const hasActiveChild = section.children?.some((c) => isActive(pathname, c.href)) ?? false;
  const [open, setOpen] = useState(hasActiveChild || section.children?.some((c) => !c.soon) || false);

  const rowSx = {
    width: '100%',
    justifyContent: 'flex-start',
    gap: 1.5,
    px: 1.5,
    py: 1,
    my: 0.25,
    borderRadius: '12px',
    fontSize: '0.9375rem',
    fontWeight: 500,
    color: textOn,
    '&:hover': { bgcolor: brand.pineSoft },
  };

  if (!section.children) {
    const active = section.href ? isActive(pathname, section.href) : false;
    if (section.soon || !section.href) {
      return (
        <Box sx={{ ...rowSx, display: 'flex', alignItems: 'center', color: textDim, '&:hover': {} }}>
          <Icon fontSize="small" />
          <span style={{ flex: 1 }}>{section.label}</span>
          <SoonTag />
        </Box>
      );
    }
    return (
      <ButtonBase
        component={Link}
        href={section.href}
        onClick={onNavigate}
        aria-current={active ? 'page' : undefined}
        sx={{ ...rowSx, ...(active ? { ...bubbleActive, '&:hover': bubbleActive } : {}) }}
      >
        <Icon fontSize="small" />
        {section.label}
      </ButtonBase>
    );
  }

  return (
    <Box sx={{ mt: 0.5 }}>
      <ButtonBase onClick={() => setOpen((o) => !o)} aria-expanded={open} sx={rowSx}>
        <Icon fontSize="small" />
        <span style={{ flex: 1, textAlign: 'left' }}>{section.label}</span>
        <ExpandMore
          fontSize="small"
          sx={{ color: textDim, transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .15s' }}
        />
      </ButtonBase>
      <Collapse in={open}>
        <Box sx={{ ml: 3.25, pl: 1.25, borderLeft: `1px solid ${brand.pineSoft}` }}>
          {section.children.map((c) => {
            const active = isActive(pathname, c.href);
            const childSx = {
              display: 'flex',
              width: '100%',
              justifyContent: 'flex-start',
              alignItems: 'center',
              px: 1.5,
              py: 0.75,
              my: 0.25,
              borderRadius: '12px',
              fontSize: '0.875rem',
            };
            if (c.soon) {
              return (
                <Box key={c.href} sx={{ ...childSx, color: textDim }}>
                  <span style={{ flex: 1 }}>{c.label}</span>
                  <SoonTag />
                </Box>
              );
            }
            return (
              <ButtonBase
                key={c.href}
                component={Link}
                href={c.href}
                onClick={onNavigate}
                aria-current={active ? 'page' : undefined}
                sx={{
                  ...childSx,
                  color: textOn,
                  '&:hover': { bgcolor: brand.pineSoft },
                  ...(active ? { ...bubbleActive, fontWeight: 600, '&:hover': bubbleActive } : {}),
                }}
              >
                {c.label}
              </ButtonBase>
            );
          })}
        </Box>
      </Collapse>
    </Box>
  );
}

function SoonTag() {
  return (
    <Typography component="span" sx={{ fontSize: '0.6875rem', color: textDim, border: `1px solid ${brand.pineSoft}`, px: 0.75, borderRadius: 1 }}>
      Soon
    </Typography>
  );
}
