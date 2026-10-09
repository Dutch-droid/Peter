'use client';
import type { FieldError } from 'react-hook-form';

export function Field({ label, error, children, hint }: {
  label: string; error?: FieldError | { message?: string }; children: React.ReactNode; hint?: string;
}) {
  return (
    <label className={error ? 'invalid' : ''}>
      {label}
      {children}
      {hint && !error && <span className="hint">{hint}</span>}
      {error?.message && <span className="fielderr" role="alert">{error.message}</span>}
    </label>
  );
}

/** Registered-input helpers: numbers become numbers, empty optional numbers become null. */
export const asNumber = { setValueAs: (v: string) => (v === '' || v == null ? NaN : Number(v)) };
export const asOptNumber = { setValueAs: (v: string) => (v === '' || v == null ? null : Number(v)) };
export const asOptId = { setValueAs: (v: string) => (v === '' || v == null ? null : Number(v)) };

export const StatusTag = ({ s }: { s: string }) => <span className={`tag ${s}`}>{s}</span>;
