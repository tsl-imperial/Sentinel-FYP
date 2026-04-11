'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { TerraDraw, TerraDrawPolygonMode } from 'terra-draw';
import { TerraDrawMapLibreGLAdapter } from 'terra-draw-maplibre-gl-adapter';
import type { Map as MaplibreMap } from 'maplibre-gl';

/**
 * Polygon draw UX. Thin React wrapper around terra-draw.
 *
 * REGRESSION R7: cleanup MUST call BOTH `draw.off('change'/'finish', handler)`
 * AND `draw.stop()`. Codex caught this during plan review — `draw.stop()`
 * alone tears down the adapter but does not detach event listeners we
 * explicitly subscribed to.
 *
 * API SHAPE: `{isClosed, pointCount, getLngLatPolygon, clear}` — verbatim
 * match for the old Leaflet hook so workbench/page.tsx (`polygon.pointCount`
 * gates "Run extraction") works unchanged.
 *
 * MODE GATING (workbench v2.6): the hook accepts an `enabled` flag. When
 * false, terra-draw is never started — the map's click events fall through
 * to the MapView's road click handler so the user can inspect roads without
 * dropping vertices. When `enabled` flips from true to false (the user
 * switched to select mode), the cleanup tears down terra-draw and the
 * polygon clears. The user re-enters polygon mode to start a fresh draw.
 */

export interface PolygonDrawAPI {
  isClosed: boolean;
  pointCount: number;
  /** Returns the polygon vertices in [lng, lat] order, the shape Flask expects. */
  getLngLatPolygon: () => Array<[number, number]>;
  clear: () => void;
}

interface DrawState {
  points: Array<[number, number]>;
  closed: boolean;
}

const INITIAL_STATE: DrawState = { points: [], closed: false };

// Vertex marker styling — slate-900 to match the rest of the workbench. The
// closingPoint (the first vertex, which doubles as the click-to-close target)
// is slightly larger so users can find it.
const POLYGON_STYLES = {
  fillColor: '#0f172a',
  fillOpacity: 0.08,
  outlineColor: '#0f172a',
  outlineWidth: 2,
  closingPointColor: '#0f172a',
  closingPointWidth: 7,
  closingPointOutlineColor: '#ffffff',
  closingPointOutlineWidth: 2,
  snappingPointColor: '#0f172a',
  snappingPointWidth: 6,
  snappingPointOutlineColor: '#ffffff',
  snappingPointOutlineWidth: 2,
} as const;

/**
 * Read the in-progress polygon's coordinate ring from terra-draw. The snapshot
 * may also contain closing-point markers; we only want the Polygon geometry,
 * with the GeoJSON-mandatory closing-vertex duplicate stripped so pointCount
 * matches click count.
 */
function readPolygonRing(draw: TerraDraw): Array<[number, number]> {
  const features = draw.getSnapshot();
  for (const f of features) {
    if (f.geometry?.type === 'Polygon') {
      const ring = f.geometry.coordinates[0] ?? [];
      const first = ring[0];
      const last = ring[ring.length - 1];
      const isClosed =
        ring.length > 1 && first !== undefined && last !== undefined &&
        last.every((v, i) => v === first[i]);
      const open = isClosed ? ring.slice(0, -1) : ring;
      return open as Array<[number, number]>;
    }
  }
  return [];
}

/** Reference-equality check on a coordinate ring. terra-draw fires 'change'
 *  on non-structural events too (e.g., cursor move when snapping is enabled),
 *  so we dedupe before triggering a React re-render. */
function pointsEqual(a: Array<[number, number]>, b: Array<[number, number]>): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    const ai = a[i];
    const bi = b[i];
    if (!ai || !bi || ai[0] !== bi[0] || ai[1] !== bi[1]) return false;
  }
  return true;
}

export function usePolygonDraw(
  map: MaplibreMap | null,
  enabled: boolean = true,
): PolygonDrawAPI {
  const [state, setState] = useState<DrawState>(INITIAL_STATE);
  // useRef (not useState) for the TerraDraw instance: clear() reads it but no
  // child needs to re-render when it appears. Using state would fire two extra
  // workbench renders per MapView mount/unmount.
  const drawRef = useRef<TerraDraw | null>(null);

  useEffect(() => {
    if (!map) return;
    if (!enabled) {
      // Mode flipped to select. Reset the React state so the docked panel
      // and Run button see an empty polygon. Cleanup of any prior terra-draw
      // instance is handled by the previous effect run's return below.
      setState(INITIAL_STATE);
      return;
    }

    // terra-draw's start() requires the MapLibre style to be fully loaded
    // (basemap raster + pmtiles source must be streamed in), otherwise it
    // throws "Style is not done loading." Wait for isStyleLoaded() or 'load'.
    let instance: TerraDraw | null = null;
    let handleChange: () => void = () => {};
    let handleFinish: () => void = () => {};
    let cancelled = false;

    const init = () => {
      if (cancelled) return;
      const adapter = new TerraDrawMapLibreGLAdapter({ map });
      const polygonMode = new TerraDrawPolygonMode({ styles: POLYGON_STYLES });
      const created = new TerraDraw({ adapter, modes: [polygonMode] });

      handleChange = () => {
        const points = readPolygonRing(created);
        setState((prev) => (pointsEqual(prev.points, points) ? prev : { ...prev, points }));
      };

      handleFinish = () => {
        const points = readPolygonRing(created);
        setState({ points, closed: true });
      };

      created.on('change', handleChange);
      created.on('finish', handleFinish);
      created.start();
      created.setMode('polygon');
      instance = created;
      drawRef.current = created;
    };

    if (map.isStyleLoaded()) {
      init();
    } else {
      map.once('load', init);
    }

    return () => {
      cancelled = true;
      if (instance) {
        instance.off('change', handleChange);
        instance.off('finish', handleFinish);
        instance.stop();
      } else {
        // init never ran (style still loading at unmount). Detach the
        // pending 'load' listener so it doesn't fire after unmount.
        map.off('load', init);
      }
      drawRef.current = null;
    };
  }, [map, enabled]);

  const clear = useCallback(() => {
    drawRef.current?.clear();
    setState(INITIAL_STATE);
  }, []);

  return {
    isClosed: state.closed,
    pointCount: state.points.length,
    getLngLatPolygon: () => state.points.slice(),
    clear,
  };
}
