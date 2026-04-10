'use client';

import { useEffect, useState, useCallback, useMemo } from 'react';
// Type-only import — types are erased at compile time, so no runtime evaluation.
// The actual L value comes from a lazy require inside the effect (see below).
import type L from 'leaflet';

/**
 * Polygon draw UX. React-native port of createPolygonDrawController (app.js:153-227).
 *
 * Behavior:
 * - Click on the map adds a vertex.
 * - Clicking the FIRST marker again closes the polygon.
 * - Double-clicking the map also closes (doubleClickZoom is disabled in createMap).
 * - clear() resets everything.
 * - getLngLatPolygon() returns the points in [lng, lat] order, the shape Flask expects.
 *
 * REGRESSION R7: cleanup MUST detach every map event listener and remove every
 * Leaflet layer added to the map. Without this, switching regions or React 19
 * strict-mode double-mount leaks listeners and produces ghost markers.
 *
 * State design: a single { points, closed } object so functional setState can
 * atomically check `closed` before appending a new point. Two separate useStates
 * would race in the click handler.
 */

export interface PolygonDrawAPI {
  isClosed: boolean;
  pointCount: number;
  /** Returns the polygon vertices in [lng, lat] order, the shape Flask expects. */
  getLngLatPolygon: () => Array<[number, number]>;
  clear: () => void;
}

interface DrawState {
  points: L.LatLng[];
  closed: boolean;
}

const INITIAL_STATE: DrawState = { points: [], closed: false };

export function usePolygonDraw(map: L.Map | null): PolygonDrawAPI {
  const [state, setState] = useState<DrawState>(INITIAL_STATE);

  // Functional updaters — stable, no captured state, so the handler effect
  // only depends on `map`.
  const addPoint = useCallback((latlng: L.LatLng) => {
    setState((prev) => (prev.closed ? prev : { ...prev, points: [...prev.points, latlng] }));
  }, []);

  const close = useCallback(() => {
    setState((prev) => (prev.closed || prev.points.length < 3 ? prev : { ...prev, closed: true }));
  }, []);

  const clear = useCallback(() => {
    setState(INITIAL_STATE);
  }, []);

  // Attach map-level event handlers once per map instance.
  useEffect(() => {
    if (!map) return;

    const handleClick = (e: L.LeafletMouseEvent) => addPoint(e.latlng);
    const handleDblClick = (e: L.LeafletMouseEvent) => {
      e.originalEvent.preventDefault();
      e.originalEvent.stopPropagation();
      close();
    };

    map.on('click', handleClick);
    map.on('dblclick', handleDblClick);

    return () => {
      map.off('click', handleClick);
      map.off('dblclick', handleDblClick);
    };
  }, [map, addPoint, close]);

  // Render Leaflet layers from the current state. Effect cleanup tears down
  // every layer it added, so each state change leaves nothing behind.
  useEffect(() => {
    if (!map) return;
    // Lazy require: Leaflet touches `window` at module load and would crash
    // Next.js prerender. workbench/page.tsx is a 'use client' file but its
    // module body still runs during the SSR shell pass.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const L = require('leaflet') as typeof import('leaflet');

    const markers: L.CircleMarker[] = [];
    let line: L.Polyline | null = null;
    let polygon: L.Polygon | null = null;

    state.points.forEach((latlng, idx) => {
      const marker = L.circleMarker(latlng, {
        radius: 4,
        color: '#dc2626',
        fillColor: '#fff',
        fillOpacity: 1,
        weight: 2,
      }).addTo(map);
      // First marker also acts as a "close polygon" hit target.
      if (idx === 0) marker.on('click', close);
      markers.push(marker);
    });

    if (state.closed && state.points.length >= 3) {
      polygon = L.polygon(state.points, {
        color: '#dc2626',
        weight: 1.5,
        fillOpacity: 0.08,
      }).addTo(map);
    } else if (state.points.length >= 2) {
      line = L.polyline(state.points, { color: '#dc2626', weight: 1.5 }).addTo(map);
    }

    return () => {
      markers.forEach((m) => {
        m.off();
        map.removeLayer(m);
      });
      if (line) map.removeLayer(line);
      if (polygon) map.removeLayer(polygon);
    };
  }, [map, state, close]);

  return useMemo<PolygonDrawAPI>(
    () => ({
      isClosed: state.closed,
      pointCount: state.points.length,
      getLngLatPolygon: () => state.points.map((p) => [p.lng, p.lat] as [number, number]),
      clear,
    }),
    [state, clear],
  );
}
