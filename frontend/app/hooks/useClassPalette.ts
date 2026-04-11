'use client';

import { useApiQuery } from './useApiQuery';
import { classPaletteSchema, type ClassPalette } from '@/lib/schemas/classPalette';

/**
 * Fetches the road class color palette from the lightweight /api/class_palette
 * endpoint. The MapLibre style cannot be built without the palette, so the
 * workbench gates its <MapView> mount on this query resolving.
 *
 * staleTime is Infinity because the palette is effectively immutable for the
 * lifetime of the deployed app — it comes from CLASS_COLORS in config.py, which
 * only changes via a code release. No need to refetch on focus or remount.
 *
 * Critical: this hook hits /api/class_palette, NOT /api/regions/details. The
 * latter triggers region_summaries() which is documented as a multi-second cold
 * call (TODOS.md). Codex caught the wrong dependency during plan review.
 */
export function useClassPalette() {
  return useApiQuery<ClassPalette, null>(
    'class_palette',
    null,
    () => '/api/class_palette',
    classPaletteSchema,
    { staleTime: Infinity, gcTime: Infinity },
  );
}
