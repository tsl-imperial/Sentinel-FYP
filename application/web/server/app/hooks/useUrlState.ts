'use client';

import { useCallback, useMemo } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useDebouncedCallback } from './useDebounce';

/**
 * useUrlState — two-way bind workbench state to the URL query string.
 *
 * Reads on mount, writes on change. Discrete state (region, time, cloud)
 * writes immediate; map state (center, zoom) writes debounced 250 ms because
 * `flyTo` and pan/zoom fire many times per second.
 *
 * Malformed inputs fall back to defaults silently — see eng-review failure
 * mode registry. We never crash on bad URL state, we just ignore it.
 *
 * Discrete state is read directly from `searchParams` so the parent component
 * stays reactive to external navigations (e.g., the /regions page sets
 * `?region=Greater%20Accra` and the workbench picks it up).
 *
 * Map state writes go through a debounced helper so the URL doesn't update
 * 60 times per second during a `flyTo`. The debounced helper is created with
 * `useDebouncedCallback` which has cleanup baked in (R5/R7-equivalent).
 */
export interface UrlState {
  region: string;
  timeIdx: number;
  cloud: number;
  center: [number, number] | null;
  zoom: number | null;
}

const DEFAULT_REGION = 'Ghana';
const DEFAULT_TIME_IDX = 14;
const DEFAULT_CLOUD = 30;

export function useUrlState() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const state: UrlState = useMemo(() => {
    const region = searchParams.get('region') ?? DEFAULT_REGION;

    const rawTime = searchParams.get('time');
    const timeIdx = rawTime !== null && /^\d+$/.test(rawTime)
      ? Math.min(Math.max(parseInt(rawTime, 10), 0), 999)
      : DEFAULT_TIME_IDX;

    const rawCloud = searchParams.get('cloud');
    const cloud = rawCloud !== null && /^\d+$/.test(rawCloud)
      ? Math.min(Math.max(parseInt(rawCloud, 10), 0), 100)
      : DEFAULT_CLOUD;

    const rawCenter = searchParams.get('center');
    let center: [number, number] | null = null;
    if (rawCenter) {
      const parts = rawCenter.split(',');
      if (parts.length === 2) {
        const lat = parseFloat(parts[0]!);
        const lng = parseFloat(parts[1]!);
        if (Number.isFinite(lat) && Number.isFinite(lng)) {
          center = [lat, lng];
        }
      }
    }

    const rawZoom = searchParams.get('zoom');
    const parsedZoom = rawZoom !== null ? parseFloat(rawZoom) : NaN;
    const zoom = Number.isFinite(parsedZoom) ? parsedZoom : null;

    return { region, timeIdx, cloud, center, zoom };
  }, [searchParams]);

  // Build a URL string from the current state with the given override.
  // Uses `searchParams.toString()` semantics so unrelated params (e.g.,
  // future query strings) are preserved if they ever appear.
  const buildUrl = useCallback(
    (overrides: Partial<UrlState>): string => {
      const params = new URLSearchParams();
      const region = overrides.region ?? state.region;
      const timeIdx = overrides.timeIdx ?? state.timeIdx;
      const cloud = overrides.cloud ?? state.cloud;
      const center = overrides.center !== undefined ? overrides.center : state.center;
      const zoom = overrides.zoom !== undefined ? overrides.zoom : state.zoom;

      if (region !== DEFAULT_REGION) params.set('region', region);
      if (timeIdx !== DEFAULT_TIME_IDX) params.set('time', String(timeIdx));
      if (cloud !== DEFAULT_CLOUD) params.set('cloud', String(cloud));
      if (center) params.set('center', `${center[0].toFixed(4)},${center[1].toFixed(4)}`);
      if (zoom !== null) params.set('zoom', zoom.toFixed(2));

      const qs = params.toString();
      return qs ? `/workbench?${qs}` : '/workbench';
    },
    [state],
  );

  // Discrete state writes — immediate.
  const setRegion = useCallback((next: string) => {
    router.replace(buildUrl({ region: next }));
  }, [router, buildUrl]);

  const setTimeIdx = useCallback((next: number) => {
    router.replace(buildUrl({ timeIdx: next }));
  }, [router, buildUrl]);

  const setCloud = useCallback((next: number) => {
    router.replace(buildUrl({ cloud: next }));
  }, [router, buildUrl]);

  // Map state writes — debounced 250 ms so flyTo/pan don't write 60×/s.
  // The debounced helper has cleanup baked in (useDebouncedCallback).
  const writeMapState = useCallback(
    (next: { center?: [number, number]; zoom?: number }) => {
      router.replace(buildUrl(next));
    },
    [router, buildUrl],
  );
  const setMapView = useDebouncedCallback(writeMapState, 250);

  return { state, setRegion, setTimeIdx, setCloud, setMapView };
}
