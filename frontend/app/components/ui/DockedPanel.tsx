'use client';

import { useEffect, useId, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * DockedPanel — contextual right-side panel for the workbench.
 *
 * Ported from nefos with the slate token mapping + the eng-review additions:
 *
 * - Discriminated union state machine in `workbench/page.tsx` mounts ONE
 *   instance whose content swaps inside (NOT three branches). The slide-in
 *   animation plays once per closed→open transition instead of replaying
 *   between extraction/inspector/welcome states.
 *
 * - role="dialog", aria-labelledby={titleId}, aria-modal="false" (it's
 *   docked, not modal). Pass titleId from the parent so the discriminated
 *   union dispatch can give each variant its own id.
 *
 * - Focus management: when `focusOnMount` is true (set by the parent for
 *   inspector mounts), the close button gets focus on mount so keyboard
 *   users can ESC out. Extraction-state mounts pass `focusOnMount={false}`
 *   so the user's typing in the sidebar isn't interrupted.
 *
 * - Slide-in motion: `transition-transform transition-opacity duration-200
 *   ease-out` on `translate-x-full opacity-0` → `translate-x-0 opacity-100`,
 *   wrapped in `motion-safe:` so prefers-reduced-motion users get an instant
 *   mount.
 *
 * The workbench is desktop-only by acknowledged decision. The sub-1100px
 * overlay variant from the original spec was removed because nothing in
 * workbench/page.tsx ever set `overlay={true}` — it was dead code.
 *
 * R8 (mandatory regression): mount/unmount under React 19 StrictMode
 * without throwing. Tested at `app/components/ui/DockedPanel.test.tsx`.
 */
interface DockedPanelProps {
  title: ReactNode;
  /** Stable id for aria-labelledby. Parent computes per-variant. */
  titleId: string;
  onClose: () => void;
  /** Focus the close button when the panel mounts (true for inspector,
   *  false for extraction-state mounts to avoid interrupting input focus). */
  focusOnMount?: boolean;
  width?: string;
  children: ReactNode;
  footer?: ReactNode;
}

export function DockedPanel({
  title,
  titleId,
  onClose,
  focusOnMount = false,
  width = 'w-80',
  children,
  footer,
}: DockedPanelProps) {
  const closeRef = useRef<HTMLButtonElement | null>(null);

  // Focus the close button on mount when requested. The empty deps array is
  // intentional — we only want this once per mount, not on every re-render.
  useEffect(() => {
    if (focusOnMount) closeRef.current?.focus();
  }, [focusOnMount]);

  // ESC closes the panel. Effect cleanup unsubscribes — R5/R7-equivalent
  // contract.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => { window.removeEventListener('keydown', handler); };
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-labelledby={titleId}
      aria-modal="false"
      className={cn(
        width,
        'shrink-0 flex flex-col border-l border-slate-200 bg-white',
        'motion-safe:transition-transform motion-safe:transition-opacity motion-safe:duration-200 motion-safe:ease-out',
      )}
    >
      <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
        <span id={titleId} className="text-sm font-medium text-slate-900">{title}</span>
        <button
          ref={closeRef}
          type="button"
          onClick={onClose}
          aria-label="Close panel"
          className="rounded p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-900 focus:outline-none focus:ring-1 focus:ring-slate-900"
        >
          <X className="size-4" />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto">{children}</div>
      {footer && <div className="border-t border-slate-200 p-3">{footer}</div>}
    </div>
  );
}

/** Convenience: generate a unique titleId. Caller may also pass a literal
 *  string if they want a stable id across re-renders for testing. */
export function useDockedPanelTitleId(): string {
  return useId();
}
