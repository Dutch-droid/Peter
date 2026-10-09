export function Progress({ value, max, label, done }: { value: number; max: number; label?: string; done?: boolean }) {
  const pct = max <= 0 ? 0 : Math.max(0, Math.min(100, (value / max) * 100));
  return (
    <div className={`progress${done || pct >= 100 ? ' done' : ''}`} role="progressbar" aria-valuemin={0}
      aria-valuemax={max} aria-valuenow={value} aria-label={label}>
      <i style={{ ['--p' as string]: pct }} />
    </div>
  );
}
