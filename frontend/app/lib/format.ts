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

/** Sentinel-2 index value → display string. Em-dash for null/missing so the
 *  table cell width stays stable across rows. Used by the hover popup,
 *  road inspector, and any future indices surface. */
export function formatIndex(v: number | null | undefined): string {
  return v == null ? '—' : v.toFixed(2);
}

/** Truncate a string to `max` chars with an ellipsis. Returns the input
 *  unchanged when it's already short enough. */
export function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max - 1) + '…';
}

/** Normalize a quarter label to the short `Q1`/`Q2`/`Q3`/`Q4` form, regardless
 *  of whether the input is the long form (`'Jan–Mar'`), the short form
 *  (`'Q1'`), or an ASCII-dash variant (`'Jan-Mar'`). Used to compare TimeSlider
 *  state against parquet rows where the storage format may differ from the
 *  TimePoint canonical form. Falls through to the input string when nothing
 *  matches so unknown quarters compare against themselves. */
export function normalizeQuarter(q: string): string {
  switch (q) {
    case 'Q1':
    case 'Jan–Mar':
    case 'Jan-Mar':
      return 'Q1';
    case 'Q2':
    case 'Apr–Jun':
    case 'Apr-Jun':
      return 'Q2';
    case 'Q3':
    case 'Jul–Sep':
    case 'Jul-Sep':
      return 'Q3';
    case 'Q4':
    case 'Oct–Dec':
    case 'Oct-Dec':
      return 'Q4';
    default:
      return q;
  }
}
