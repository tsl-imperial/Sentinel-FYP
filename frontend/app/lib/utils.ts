import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Compose class names. Conditional inputs are accepted via clsx, then merged
 * with tailwind-merge so conflicting Tailwind utilities resolve in the order
 * they appear (e.g., `cn('p-2', 'p-4')` → `'p-4'`).
 *
 * Same shape as the helper used in nefos and metis. Ported here once so the
 * 5 ported nefos UI primitives compose cleanly without rewriting their call
 * sites.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
