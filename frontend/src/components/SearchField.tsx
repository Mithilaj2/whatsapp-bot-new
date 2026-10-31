'use client';
import Search from '@mui/icons-material/Search';
import { InputAdornment, TextField } from '@mui/material';
import { useEffect, useState } from 'react';

/** Search box that reports its value 300 ms after the person stops typing. */
export default function SearchField({
  placeholder,
  label,
  onSearch,
  width = 300,
}: {
  placeholder: string;
  label: string;
  onSearch: (value: string) => void;
  width?: number;
}) {
  const [value, setValue] = useState('');
  useEffect(() => {
    const t = setTimeout(() => onSearch(value.trim()), 300);
    return () => clearTimeout(t);
  }, [value, onSearch]);

  return (
    <TextField
      placeholder={placeholder}
      value={value}
      onChange={(e) => setValue(e.target.value)}
      sx={{ width: { xs: '100%', sm: width }, my: 1 }}
      slotProps={{
        input: {
          startAdornment: (
            <InputAdornment position="start">
              <Search fontSize="small" />
            </InputAdornment>
          ),
        },
        htmlInput: { 'aria-label': label },
      }}
    />
  );
}
