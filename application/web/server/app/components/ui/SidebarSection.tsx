import type { ReactNode } from 'react';

/**
 * SidebarSection — a labeled group of `SidebarEntry`s inside an `AppSidebar`.
 *
 * Ported from `nefos_web2/src/components/shared/app-sidebar.tsx`. Label uses
 * the eng-review-locked tracking (`tracking-[0.15em]`) and slate-500 muted
 * color from the token mapping.
 */
interface SidebarSectionProps {
  label: string;
  children: ReactNode;
}

export function SidebarSection({ label, children }: SidebarSectionProps) {
  return (
    <div className="px-2 py-2">
      <div className="mb-1 px-2 text-[10px] font-semibold uppercase tracking-[0.15em] text-slate-500">
        {label}
      </div>
      <div className="space-y-0.5">{children}</div>
    </div>
  );
}
