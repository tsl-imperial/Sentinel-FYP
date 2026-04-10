/**
 * Display helpers shared across pages. Both formatters use Intl directly so
 * we don't carry our own locale tables.
 */

const DATE_FMT = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
  timeStyle: 'short',
});

export function formatDate(iso: string): string {
  return DATE_FMT.format(new Date(iso));
}

const UNITS = ['B', 'KB', 'MB', 'GB', 'TB'] as const;

export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '—';
  let i = 0;
  let v = n;
  while (v >= 1024 && i < UNITS.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${i === 0 ? v : v.toFixed(1)} ${UNITS[i]}`;
}
