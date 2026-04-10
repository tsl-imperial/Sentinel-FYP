import type { ReactNode } from 'react';

export type StatusKind = 'loading' | 'error' | 'empty';

const STYLE: Record<StatusKind, string> = {
  loading: 'border-slate-200 text-slate-500',
  empty: 'border-slate-200 text-slate-500',
  error: 'border-red-300 text-red-700 bg-red-50',
};

/**
 * One-shot card for the loading / error / empty states on a list page.
 * Used by /regions and /exports so they share consistent visual treatment.
 */
export function StatusCard({ kind, children }: { kind: StatusKind; children: ReactNode }) {
  return (
    <div className={`border rounded-lg p-8 text-sm ${STYLE[kind]}`}>{children}</div>
  );
}
