'use client';

/**
 * DrawHintPill — floating instruction pill that appears top-center of the
 * map while terra-draw is in polygon mode and the polygon is not yet closed.
 *
 * Removes the most common "what do I do?" moment for first-time users
 * (design review Pass 2). `role="status" aria-live="polite"` so screen
 * readers announce the instruction when it appears.
 */
interface DrawHintPillProps {
  visible: boolean;
}

export function DrawHintPill({ visible }: DrawHintPillProps) {
  if (!visible) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      className="absolute top-3 left-1/2 -translate-x-1/2 z-10 bg-slate-900 text-white text-[11px] px-3 py-1.5 rounded-full shadow-sm pointer-events-none select-none"
    >
      Click to add vertices · Double-click to close
    </div>
  );
}
