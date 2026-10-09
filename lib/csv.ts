/**
 * RFC 4180 CSV. Cells starting with = + - @ (or tab/CR) are prefixed with a quote so spreadsheet
 * apps don't run them as formulas (CSV injection), except plain negative/positive numbers.
 */
export function csvCell(v: unknown): string {
  let s = v == null ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s) && !/^[+-]?\d+(\.\d+)?$/.test(s)) s = "'" + s;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(header: string[], rows: unknown[][]): string {
  // BOM so Excel reads UTF-8 names correctly.
  return '﻿' + [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

export function csvResponse(filename: string, body: string): Response {
  return new Response(body, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename.replace(/[^\w.-]+/g, '_')}"`,
      'Cache-Control': 'no-store',
    },
  });
}
