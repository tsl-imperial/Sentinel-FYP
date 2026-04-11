'use client';

import { useApiQuery } from './useApiQuery';
import { roadIndicesSchema, type RoadIndices } from '@/lib/schemas/roadIndices';

/**
 * Fetches all-years Sentinel-2 indices for a single road.
 *
 * Used by the workbench hover popup (filters client-side to the current
 * TimeSlider year+quarter) and the click-to-dock road inspector (shows all
 * years). Both surfaces share this single hook to keep the cache
 * deduplication coherent — hovering then clicking the same road never
 * re-fetches.
 *
 * `staleTime: Infinity` because per-road indices for a given osm_id don't
 * change between session loads (the parquet is committed to git). But
 * `gcTime` is bounded at 5 minutes: a long mouse sweep across thousands of
 * roads must NOT keep every entry resident forever. After 5 minutes of
 * inactivity for a given osm_id key, TanStack Query evicts it from the
 * cache. The hover handler will refetch on the next hover, but the request
 * is cheap (~1ms warm on the backend).
 *
 * `enabled: osmId !== null` so the hook is a no-op until the user actually
 * hovers/clicks a road. Passing null is the standard "disable this query"
 * signal.
 */
export function useRoadIndices(osmId: string | null) {
  return useApiQuery<RoadIndices, string | null>(
    'road_indices',
    osmId,
    (id) => `/api/road_indices?osm_id=${encodeURIComponent(id ?? '')}`,
    roadIndicesSchema,
    { staleTime: Infinity, gcTime: 5 * 60_000, enabled: osmId !== null },
  );
}
