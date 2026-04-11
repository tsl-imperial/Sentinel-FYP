'use client';

import { useEffect, useRef, useCallback } from 'react';

/**
 * Trailing-edge debounce. Returns a stable callback that, when called, schedules
 * `fn` to run after `delay` ms of quiet. Repeated calls reset the timer.
 *
 * Two correctness properties baked in (eng-review Issue 9):
 *
 * 1. **Latest fn always runs.** `fnRef.current = fn` on every render means the
 *    trailing call closes over the most recent `fn` (and its captured state),
 *    not a stale snapshot from when `useDebouncedCallback` was first called.
 *
 * 2. **Cleanup clears any pending timer on unmount.** Without this, the timer
 *    can fire after the component is gone and call setState on a dead tree.
 *    Same R5/R7-equivalent contract the rest of the codebase enforces.
 *
 * Hand-rolled instead of pulling in `use-debounce` because the implementation
 * is 15 lines and we already maintain similar event-cleanup patterns
 * elsewhere (R7).
 */
export function useDebouncedCallback<A extends unknown[]>(
  fn: (...args: A) => void,
  delay: number,
): (...args: A) => void {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fnRef = useRef(fn);
  fnRef.current = fn;

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    [],
  );

  return useCallback(
    (...args: A) => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => fnRef.current(...args), delay);
    },
    [delay],
  );
}
