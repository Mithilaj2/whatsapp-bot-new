'use client';
import CallOutlined from '@mui/icons-material/CallOutlined';
import ImageOutlined from '@mui/icons-material/ImageOutlined';
import OpenInNew from '@mui/icons-material/OpenInNew';
import Reply from '@mui/icons-material/Reply';
import { Box, Typography } from '@mui/material';
import { useState } from 'react';
import type { TemplateContent } from '@/lib/api';
import { brand } from '@/lib/theme';

/** Fills {{1}}, {{2}}... with sample values; unfilled ones stay visible. */
export const fill = (text: string, values: string[] = []) =>
  text.replace(/\{\{(\d+)\}\}/g, (m, n) => values[Number(n) - 1] || m);

/** How a template message will look on the recipient's phone. */
export default function WhatsAppPreview({
  content,
  values,
  senderName,
}: {
  content: TemplateContent;
  values?: string[];
  senderName?: string;
}) {
  const icons = { PHONE_NUMBER: CallOutlined, URL: OpenInNew, QUICK_REPLY: Reply };
  const imageUrl = content.header?.type === 'IMAGE' ? content.header.exampleUrl : '';
  const [brokenUrl, setBrokenUrl] = useState('');
  const showImage = Boolean(imageUrl) && brokenUrl !== imageUrl;

  return (
    <Box
      aria-label="Message preview"
      sx={{ bgcolor: '#E9EFEC', borderRadius: 3, overflow: 'hidden', border: 1, borderColor: 'divider' }}
    >
      <Box sx={{ bgcolor: brand.pine, color: '#fff', px: 2, py: 1.25 }}>
        <Typography sx={{ fontWeight: 600, fontSize: '0.9375rem' }} noWrap>
          {senderName || 'Your business'}
        </Typography>
        <Typography sx={{ fontSize: '0.75rem', color: '#A9C4BB' }}>Preview</Typography>
      </Box>
      <Box sx={{ p: 1.5, minHeight: 200 }}>
        <Box
          sx={{
            bgcolor: '#fff',
            borderRadius: '4px 12px 12px 12px',
            maxWidth: 320,
            overflow: 'hidden',
            boxShadow: '0 1px 0.5px rgba(0,0,0,.13)',
          }}
        >
          {content.header?.type === 'IMAGE' &&
            (showImage ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={imageUrl}
                alt=""
                onError={() => setBrokenUrl(imageUrl)}
                style={{ width: '100%', aspectRatio: '1.91 / 1', objectFit: 'cover', display: 'block' }}
              />
            ) : (
              <Box sx={{ aspectRatio: '1.91 / 1', display: 'grid', placeItems: 'center', bgcolor: brand.surface }}>
                <ImageOutlined sx={{ color: 'text.secondary' }} />
              </Box>
            ))}
          <Box sx={{ px: 1.25, pt: 1, pb: 0.75 }}>
            {content.header?.type === 'TEXT' && (
              <Typography sx={{ fontWeight: 650, mb: 0.5 }}>{fill(content.header.text, values)}</Typography>
            )}
            <Typography sx={{ whiteSpace: 'pre-wrap', fontSize: '0.875rem', wordBreak: 'break-word' }}>
              {fill(content.body, values) || 'Your message appears here'}
            </Typography>
            {content.footer && (
              <Typography sx={{ fontSize: '0.75rem', color: 'text.secondary', mt: 0.5 }}>{content.footer}</Typography>
            )}
          </Box>
          {content.buttons?.map((b, i) => {
            const Icon = icons[b.type];
            return (
              <Box
                key={i}
                sx={{
                  borderTop: 1,
                  borderColor: 'divider',
                  py: 0.9,
                  display: 'flex',
                  justifyContent: 'center',
                  alignItems: 'center',
                  gap: 0.75,
                  color: '#1A7FC1',
                  fontSize: '0.875rem',
                  fontWeight: 500,
                }}
              >
                <Icon sx={{ fontSize: 16 }} />
                {b.text || 'Button'}
              </Box>
            );
          })}
        </Box>
      </Box>
    </Box>
  );
}
