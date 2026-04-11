import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * SidebarEntry — a single row inside a `SidebarSection`.
 *
 * Ported from nefos with slate token mapping applied. Supports either a
 * colored swatch (for road class entries — the swatch IS the identification)
 * or a `lucide-react` icon (for tools and actions). Active state uses a 2px
 * left rail in slate-900 with an 8% slate-900 background tint.
 *
 * Toggle entries (`role='toggle'`) get `aria-pressed`. Plain entries are
 * regular buttons.
 */
interface SidebarEntryProps {
  icon?: ReactNode;
  label: string;
  active?: boolean;
  badge?: string | number;
  swatch?: string;
  onClick?: () => void;
  disabled?: boolean;
  /** Set 'toggle' for layer-toggle rows so screen readers see aria-pressed. */
  role?: 'toggle' | 'action';
}

export function SidebarEntry({
  icon,
  label,
  active,
  badge,
  swatch,
  onClick,
  disabled,
  role = 'action',
}: SidebarEntryProps) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      aria-pressed={role === 'toggle' ? active === true : undefined}
      className={cn(
        'flex w-full items-center gap-2 px-2 py-1.5 text-left text-xs transition-colors',
        'focus:outline-none focus:ring-1 focus:ring-slate-900',
        active
          ? 'border-l-2 border-slate-900 bg-slate-900/[0.08] text-slate-900'
          : 'border-l-2 border-transparent text-slate-600 hover:bg-slate-50 hover:text-slate-900',
        disabled && 'pointer-events-none opacity-50',
      )}
    >
      {swatch && (
        <span
          className="size-2.5 shrink-0"
          style={{ backgroundColor: swatch }}
          aria-hidden="true"
        />
      )}
      {icon && <span className="shrink-0 [&_svg]:size-3.5" aria-hidden="true">{icon}</span>}
      <span className="truncate flex-1">{label}</span>
      {badge != null && (
        <span className="shrink-0 rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-500 tabular-nums">
          {badge}
        </span>
      )}
    </button>
  );
}
