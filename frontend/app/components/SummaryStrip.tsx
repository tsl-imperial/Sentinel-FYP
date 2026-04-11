import type { ReactNode } from 'react';

export interface SummaryItem {
  label: string;
  value: ReactNode;
}

/**
 * Inline label+value chips for the top of a list page.
 * Used by /regions and /exports.
 */
export function SummaryStrip({ items }: { items: SummaryItem[] }) {
  return (
    <div className="flex items-baseline gap-6 text-xs text-slate-500">
      {items.map(({ label, value }) => (
        <div key={label}>
          <span className="num font-medium text-slate-700">{value}</span> {label}
        </div>
      ))}
    </div>
  );
}
