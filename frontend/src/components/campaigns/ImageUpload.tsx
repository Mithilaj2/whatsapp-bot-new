'use client';
import DeleteOutline from '@mui/icons-material/DeleteOutline';
import ImageOutlined from '@mui/icons-material/ImageOutlined';
import { Box, Button, CircularProgress, IconButton, Typography } from '@mui/material';
import { useRef, useState } from 'react';
import { uploadFile } from '@/lib/api';
import { brand } from '@/lib/theme';

export interface Uploaded {
  id: string;
  url: string;
  name: string;
}

const MIN = 10 * 1024;
const MAX = Math.floor(4.9 * 1024 * 1024);

/** Pick or drop a JPEG/PNG; checked here first, then on the server. */
export default function ImageUpload({ value, onChange }: { value: Uploaded | null; onChange: (v: Uploaded | null) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [over, setOver] = useState(false);

  async function take(file?: File) {
    if (!file) return;
    setError('');
    if (!['image/jpeg', 'image/png'].includes(file.type)) return setError('Use a JPEG or PNG image');
    if (file.size > MAX) return setError('Image is larger than 4.9 MB');
    if (file.size < MIN) return setError('Image is smaller than 10 KB');
    setBusy(true);
    try {
      const res = await uploadFile<{ id: string; url: string }>('/media', file);
      onChange({ id: res.id, url: res.url, name: file.name });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  }

  return (
    <Box>
      <input ref={input} type="file" accept="image/jpeg,image/png" hidden onChange={(e) => take(e.target.files?.[0])} />
      {value ? (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, p: 1.25, border: 1, borderColor: 'divider', borderRadius: 2 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={value.url} alt="" style={{ width: 56, height: 40, objectFit: 'cover', borderRadius: 6, background: brand.surface }} />
          <Typography sx={{ flex: 1, minWidth: 0 }} noWrap>
            {value.name}
          </Typography>
          <Button size="small" onClick={() => input.current?.click()} disabled={busy}>
            Change
          </Button>
          <IconButton aria-label="Remove image" onClick={() => onChange(null)}>
            <DeleteOutline fontSize="small" />
          </IconButton>
        </Box>
      ) : (
        <Box
          role="button"
          tabIndex={0}
          onClick={() => input.current?.click()}
          onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && input.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setOver(false);
            void take(e.dataTransfer.files?.[0]);
          }}
          sx={{
            border: '1.5px dashed',
            borderColor: over ? 'primary.main' : 'divider',
            bgcolor: over ? brand.bubble : 'background.default',
            borderRadius: 2,
            p: 2.5,
            textAlign: 'center',
            cursor: 'pointer',
            '&:focus-visible': { outline: `2px solid ${brand.action}`, outlineOffset: 2 },
          }}
        >
          {busy ? (
            <CircularProgress size={24} aria-label="Uploading" />
          ) : (
            <>
              <ImageOutlined sx={{ color: 'text.secondary' }} />
              <Typography sx={{ fontWeight: 600 }}>Choose or drop an image</Typography>
              <Typography variant="body2" color="text.secondary">
                JPEG or PNG, 10 KB to 4.9 MB. Wide images (1.91:1) look best.
              </Typography>
            </>
          )}
        </Box>
      )}
      {error && (
        <Typography variant="body2" color="error" sx={{ mt: 0.75 }}>
          {error}
        </Typography>
      )}
    </Box>
  );
}
