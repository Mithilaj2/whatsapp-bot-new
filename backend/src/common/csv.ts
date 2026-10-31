import type { Response } from 'express';

const cell = (v: unknown) => {
  if (v === null || v === undefined) return '';
  const s = v instanceof Date ? v.toISOString() : String(v);
  // Quote when needed; prefix formulas so Excel doesn't execute them
  const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

/** Sends rows as a CSV download that opens correctly in Excel. */
export function sendCsv(res: Response, filename: string, headers: string[], rows: unknown[][]) {
  const body = [headers, ...rows].map((r) => r.map(cell).join(',')).join('\r\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send('﻿' + body);
}
