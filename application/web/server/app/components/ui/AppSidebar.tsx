import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * AppSidebar — narrow vertical icon-rail wrapper.
 *
 * Ported from `nefos_web2/src/components/shared/app-sidebar.tsx` with the
 * slate token mapping from the workbench eng-review plan applied
 * (bg-background → bg-white, border-border → border-slate-200).
 *
 * Renders a `w-52` (208px) flex column with a thin right border. The caller
 * provides the children (typically `SidebarSection`s and a sticky bottom
 * action area). Layout-only — no state.
 *
 * Width history: started at `w-44` (176px, the nefos default) then bumped to
 * `w-52` (208px) to give the time slider, region picker, and filename input
 * a bit more breathing room without losing the narrow-rail feel.
 */
interface AppSidebarProps {
  children: ReactNode;
  className?: string;
}

export function AppSidebar({ children, className }: AppSidebarProps) {
  return (
    <nav
      className={cn(
        'w-52 shrink-0 flex flex-col border-r border-slate-200 bg-white overflow-y-auto',
        className,
      )}
    >
      {children}
    </nav>
  );
}
