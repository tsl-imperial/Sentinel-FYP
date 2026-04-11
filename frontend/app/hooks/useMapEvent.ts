'use client';

import { useEffect } from 'react';
import type { Map as MaplibreMap, MapEventType } from 'maplibre-gl';

/**
 * Subscribe to a MapLibre event with React lifecycle, with cleanup.
 *
 * Mirrors R7 (`usePolygonDraw` cleanup contract) for the 4 new map instruments
 * (compass rose, scale bar, coords HUD, hover handler) added in the workbench
 * rebuild. Without a shared helper, every instrument would re-implement the
 * subscribe/cleanup pair and we'd have 4 chances to leak listeners.
 *
 * The hook is single-use: one event per call. Components needing multiple
 * subscriptions call it multiple times.
 *
 * R9 (mandatory regression, eng-review Section 3): mount/unmount under React
 * 19 StrictMode must call `map.off(event, handler)` with the same handler
 * reference passed to `map.on(event, handler)`. Tested at
 * `app/hooks/useMapEvent.test.ts`.
 */
export function useMapEvent<E extends keyof MapEventType>(
  map: MaplibreMap | null,
  event: E,
  handler: (e: MapEventType[E]) => void,
): void {
  useEffect(() => {
    if (!map) return;
    map.on(event, handler);
    return () => {
      map.off(event, handler);
    };
  }, [map, event, handler]);
}
