'use client';

/**
 * MapView — declarative MapLibre via react-map-gl/maplibre.
 *
 * MUST be loaded via next/dynamic with { ssr: false } because MapLibre touches
 * `window` at module load and crashes Next.js SSR/SSG.
 *
 * REGRESSION R5/R6: react-map-gl owns the cleanup contract for the MapLibre map
 * instance. Mounting under <StrictMode> is safe by default; the library
 * disposes the underlying map.remove() on unmount. We do NOT manually wire any
 * useEffect that creates the map — that's the whole point of using the React
 * wrapper instead of vanilla MapLibre.
 *
 * ROLE AFTER WORKBENCH REBUILD:
 * - Click on a road no longer renders a local popup. Instead it fires
 *   `onClickRoad(osmId, props)` so the parent can promote the click into a
 *   docked road inspector (design review Pass 2).
 * - Hover on a road renders a small two-row floating popup at the cursor with
 *   pill-chip indices. The hover popup is local — debounced 100 ms — and uses
 *   `useRoadIndices(hoveredOsmId)` for the data fetch.
 * - The 4 map instruments (compass rose, scale bar, coordinates HUD,
 *   attribution chip) and the floating MapControls are NOT mounted inside
 *   MapView. The parent passes them as `children` so they layer inside the
 *   `relative` container without MapView importing them.
 * - `onCursorMove` exposes the shared mousemove cursor position to the parent
 *   so the CoordsHud and any future cursor-bound feature can read from one
 *   source of truth (eng-review Section 1, Issue 2 — single mousemove
 *   subscription, fan-out via prop).
 *
 * The boundary outline source/layer is added via <Source>+<Layer>, NOT in
 * buildRoadStyle, because the boundary GeoJSON changes per-region while the
 * style spec is built once per palette.
 *
 * The flyTo for region change happens in workbench/page.tsx (where the
 * mapRef is held).
 */
import { useState, useCallback, useMemo, useEffect, useRef, type ReactNode } from 'react';
import {
  Map as MapLibreMap,
  Source,
  Layer,
  Popup,
} from 'react-map-gl/maplibre';
import type { MapMouseEvent, MapRef } from 'react-map-gl/maplibre';

import {
  buildRoadStyle,
  allHitLayerIds,
  roadLayerId,
  roadHitLayerId,
  ROADS_HOVER_LAYER_ID,
  ROADS_HOVER_NEVER_MATCH,
  FALLBACK_ROAD_COLOR,
} from '@/lib/maplibre-style';
// Side-effect import: registers the pmtiles:// protocol with maplibre BEFORE
// the <Map> mounts. Idempotent under HMR.
import '@/lib/maplibre';
import type { ClassPalette } from '@/lib/schemas/classPalette';
import type { BoundaryLayer } from '@/lib/schemas/boundaryLayer';
import { useRoadIndices } from '@/hooks/useRoadIndices';
import { useDebouncedCallback } from '@/hooks/useDebounce';
import { formatIndex, truncate, normalizeQuarter } from '@/lib/format';

export interface ClickedRoadMeta {
  osmId: string;
  name: string;
  fclass: string;
  color: string;
}

export interface MapViewProps {
  palette: ClassPalette;
  center: [number, number];
  zoom: number;
  enabled: Record<string, boolean>;
  boundary: BoundaryLayer | null;
  /** Receives the maplibre Map instance for region-change flyTo from the parent. */
  onMapReady: (map: MapRef | null) => void;
  /** Click on a road → parent promotes to docked inspector. Pass `null` if
   *  the user clicked empty space (parent may use this to clear selection). */
  onClickRoad?: (meta: ClickedRoadMeta | null) => void;
  /** Current TimeSlider year (used to pick the right indices for the hover
   *  popup). 2020-2023 → exact match; outside → fall back to most-recent
   *  with a year/quarter label. */
  currentYear: number;
  /** Current TimeSlider quarter, in the long-form `'Jan–Mar' | 'Apr–Jun' |
   *  'Jul–Sep' | 'Oct–Dec'` shape that timePoints emits. The hover popup
   *  filters indices on BOTH year AND quarter, normalizing the long form
   *  to `Q1`/`Q2`/`Q3`/`Q4` to match whatever the parquet uses. */
  currentQuarter: string;
  /** CSS cursor for the map container. Use `'crosshair'` while in polygon
   *  draw mode and `'grab'` (default) in select mode. */
  cursor?: string;
  /** Floating instruments rendered inside the relative container. The parent
   *  owns the imports so MapView doesn't pull them in. */
  children?: ReactNode;
}

interface HoverState {
  lng: number;
  lat: number;
  osmId: string;
  name: string;
  fclass: string;
  color: string;
}

const BOUNDARY_SOURCE_ID = 'boundary-source';
const BOUNDARY_LAYER_ID = 'boundary-layer';

const EMPTY_FC = { type: 'FeatureCollection' as const, features: [] };

export default function MapView({
  palette,
  center,
  zoom,
  enabled,
  boundary,
  onMapReady,
  onClickRoad,
  currentYear,
  currentQuarter,
  cursor = 'grab',
  children,
}: MapViewProps) {
  const style = useMemo(() => buildRoadStyle(palette), [palette]);
  // interactiveLayerIds points at the WIDE invisible hit layers (not the
  // visible hairlines) so click + hover targeting picks up roads within a
  // ~7px halo of the centerline. Without this the user has to pixel-hunt
  // residential roads (1px wide at common zooms).
  const interactiveLayerIds = useMemo(() => allHitLayerIds(palette), [palette]);

  // initialViewState is one-shot; subsequent moves go through flyTo() in the
  // parent. Lazy-init via useState so center/zoom prop changes don't recompute.
  const [initialViewState] = useState(() => ({
    longitude: center[1],
    latitude: center[0],
    zoom,
  }));

  // Click handler — fires the parent callback. No local popup state.
  const handleClick = useCallback(
    (e: MapMouseEvent) => {
      const features = e.features ?? [];
      if (features.length === 0) {
        onClickRoad?.(null);
        return;
      }
      const f = features[0];
      if (!f) {
        onClickRoad?.(null);
        return;
      }
      const props = (f.properties ?? {}) as { name?: string | null; fclass?: string; osm_id?: string | number };
      const fclass = props.fclass ?? '';
      const name = props.name && props.name.trim() ? props.name : '(unnamed)';
      const color = palette.colors[fclass] ?? FALLBACK_ROAD_COLOR;
      const osmId = props.osm_id != null ? String(props.osm_id) : '';
      if (!osmId) {
        onClickRoad?.(null);
        return;
      }
      onClickRoad?.({ osmId, name, fclass, color });
    },
    [palette, onClickRoad],
  );

  // Hover state — local. Debounced 100 ms so we don't fire useRoadIndices
  // sixty times per second during sustained hovering.
  const [hover, setHover] = useState<HoverState | null>(null);

  const updateHover = useCallback(
    (next: HoverState | null) => {
      setHover((prev) => {
        if (prev === null && next === null) return prev;
        if (prev && next && prev.osmId === next.osmId) {
          // Same road, just update cursor coords for popup positioning.
          return { ...prev, lng: next.lng, lat: next.lat };
        }
        return next;
      });
    },
    [],
  );
  const debouncedSetHover = useDebouncedCallback(updateHover, 100);

  const handleMouseMove = useCallback(
    (e: MapMouseEvent) => {
      const features = e.features ?? [];
      if (features.length === 0) {
        debouncedSetHover(null);
        return;
      }
      const f = features[0];
      if (!f) {
        debouncedSetHover(null);
        return;
      }
      const props = (f.properties ?? {}) as { name?: string | null; fclass?: string; osm_id?: string | number };
      const osmId = props.osm_id != null ? String(props.osm_id) : '';
      if (!osmId) {
        debouncedSetHover(null);
        return;
      }
      const fclass = props.fclass ?? '';
      const name = props.name && props.name.trim() ? props.name : '(unnamed)';
      const color = palette.colors[fclass] ?? FALLBACK_ROAD_COLOR;
      debouncedSetHover({ lng: e.lngLat.lng, lat: e.lngLat.lat, osmId, name, fclass, color });
    },
    [palette, debouncedSetHover],
  );

  const handleMouseLeave = useCallback(() => {
    debouncedSetHover(null);
  }, [debouncedSetHover]);

  // Local ref so the visibility-toggle effect can call setLayoutProperty on
  // the underlying maplibre map. The parent gets the same instance via
  // onMapReady for region-change flyTo.
  const localMapRef = useRef<MapRef | null>(null);
  const handleRefChange = useCallback(
    (instance: MapRef | null) => {
      localMapRef.current = instance;
      onMapReady(instance);
    },
    [onMapReady],
  );

  // Toggle road layer visibility via the imperative MapLibre API. Road layers
  // come from the baked-in style spec (with the right colors on first paint);
  // we override visibility here per the react-map-gl pattern for runtime
  // toggling of style-spec layers. We toggle BOTH the visible layer and its
  // hit-layer companion — if a class is hidden, hit detection on it should
  // be disabled too.
  //
  // Subtle race fixed in adversarial review: `styledata` can fire BEFORE the
  // road layers from the pmtiles vector source are added (basemap parses
  // first). The previous version used `map.once('styledata', apply)`, which
  // consumed the listener on the first event with no layers present, leaving
  // the visibility apply silently dead until the next effect re-run. Now we
  // use `map.on('styledata', apply)` and apply self-unsubscribes once the
  // target layers actually exist.
  useEffect(() => {
    const map = localMapRef.current?.getMap();
    if (!map) return;
    const firstFclass = palette.order[0];
    if (!firstFclass) return;
    const readinessId = roadLayerId(firstFclass);
    const apply = () => {
      if (!map.getLayer(readinessId)) return; // not ready yet, wait for next styledata
      for (const fclass of palette.order) {
        const visible = enabled[fclass] !== false;
        for (const id of [roadLayerId(fclass), roadHitLayerId(fclass)]) {
          if (map.getLayer(id)) {
            map.setLayoutProperty(id, 'visibility', visible ? 'visible' : 'none');
          }
        }
      }
      map.off('styledata', apply); // self-unsubscribe on success
    };
    apply();
    if (!map.getLayer(readinessId)) {
      map.on('styledata', apply);
    }
    return () => {
      map.off('styledata', apply);
    };
  }, [enabled, palette]);

  // Derived primitive used as the dep for the hover-highlight + cursor
  // effects. The `hover` state object gets a new reference on every cursor
  // position update (popup positioning), but the effects only care WHICH
  // road is hovered — keying off the osmId string means they re-run only
  // when the user actually crosses onto a different road.
  const hoveredOsmId = hover?.osmId ?? null;

  // Hover highlight: update the dedicated hover layer's filter when the
  // hovered road changes. Same self-unsubscribing pattern as the visibility
  // effect above so a styledata event firing before the hover layer exists
  // doesn't permanently break highlighting.
  useEffect(() => {
    const map = localMapRef.current?.getMap();
    if (!map) return;
    const apply = () => {
      if (!map.getLayer(ROADS_HOVER_LAYER_ID)) return;
      const targetOsmId = hoveredOsmId ?? ROADS_HOVER_NEVER_MATCH;
      map.setFilter(ROADS_HOVER_LAYER_ID, ['==', ['get', 'osm_id'], targetOsmId]);
      map.off('styledata', apply);
    };
    apply();
    if (!map.getLayer(ROADS_HOVER_LAYER_ID)) {
      map.on('styledata', apply);
    }
    return () => {
      map.off('styledata', apply);
    };
  }, [hoveredOsmId]);

  // Cursor: switch to `pointer` when hovering a road. Imperative DOM write
  // because react-map-gl's `cursor` prop only sets the initial cursor —
  // runtime updates have to bypass it. The `cursor` prop value is the
  // fallback when no road is under the cursor.
  useEffect(() => {
    const map = localMapRef.current?.getMap();
    if (!map) return;
    const canvas = map.getCanvas();
    if (!canvas) return;
    canvas.style.cursor = hoveredOsmId !== null ? 'pointer' : cursor;
  }, [hoveredOsmId, cursor]);

  // Fetch indices for the currently hovered road. TanStack Query dedupes by
  // osmId so repeated hovers on the same road don't refetch.
  const indicesQuery = useRoadIndices(hover?.osmId ?? null);
  const hoverIndicesEntry = useMemo(() => {
    const list = indicesQuery.data?.indices ?? [];
    if (list.length === 0) return null;
    // Filter on BOTH year AND quarter. The TimeSlider quarter is in the
    // long form ('Jan–Mar') so we normalize to the short form ('Q1') to
    // match whatever the parquet rows use. This was a real bug found in
    // adversarial review: the previous version filtered on year only and
    // because the rows are sorted desc by (year, quarter), the slider
    // silently showed Q4 data for Q1/Q2/Q3 selections.
    const targetQuarter = normalizeQuarter(currentQuarter);
    const exact = list.find(
      (row) => row.year === currentYear && normalizeQuarter(row.quarter) === targetQuarter,
    );
    if (exact) return { entry: exact, fallback: false };
    // Year matches but quarter doesn't → fall back to that year's most-recent
    // quarter, label as fallback so the popup shows the disclosure.
    const yearMatch = list.find((row) => row.year === currentYear);
    if (yearMatch) return { entry: yearMatch, fallback: true };
    // No data for this year at all → fall back to the most recent row.
    return { entry: list[0]!, fallback: true };
  }, [indicesQuery.data, currentYear, currentQuarter]);

  return (
    <div className="flex-1 relative">
      <MapLibreMap
        ref={handleRefChange}
        initialViewState={initialViewState}
        mapStyle={style}
        style={{ width: '100%', height: '100%' }}
        interactiveLayerIds={interactiveLayerIds}
        cursor={cursor}
        onClick={handleClick}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
        // dblclick is consumed by terra-draw to close the polygon. Disable
        // the default double-click-to-zoom so it doesn't fight the draw UX.
        doubleClickZoom={false}
      >
        {/* Boundary outline — separate source/layer because boundary changes per-region. */}
        <Source
          id={BOUNDARY_SOURCE_ID}
          type="geojson"
          data={(boundary?.geojson as GeoJSON.FeatureCollection | undefined) ?? EMPTY_FC}
        >
          <Layer
            id={BOUNDARY_LAYER_ID}
            type="line"
            source={BOUNDARY_SOURCE_ID}
            paint={{
              'line-color': '#0f172a',
              'line-width': 1.5,
              'line-opacity': 0.9,
              'line-dasharray': [4, 4],
            }}
          />
        </Source>

        {hover && (
          <Popup
            longitude={hover.lng}
            latitude={hover.lat}
            anchor="bottom"
            offset={12}
            closeButton={false}
            closeOnClick={false}
            className="netinspect-road-popup"
          >
            <div className="font-[Inter] text-[11px] leading-tight text-slate-700 max-w-[280px]">
              <div className="flex items-center gap-1.5">
                <span className="inline-block size-2 rounded-full" style={{ backgroundColor: hover.color }} />
                <b className="text-slate-900 truncate">{truncate(hover.name, 32)}</b>
                <span className="text-slate-500"> · {hover.fclass}</span>
                {hoverIndicesEntry?.fallback && (
                  <span className="text-slate-400 ml-1">({hoverIndicesEntry.entry.year} {hoverIndicesEntry.entry.quarter})</span>
                )}
              </div>
              <div className="mt-0.5 text-[10px] tabular-nums text-slate-600">
                {indicesQuery.isLoading ? (
                  <span className="text-slate-400">loading…</span>
                ) : indicesQuery.error ? (
                  <span className="text-slate-400">(indices unavailable)</span>
                ) : !hoverIndicesEntry ? (
                  <span className="text-slate-400">(no indices)</span>
                ) : (
                  <span>
                    {formatPill('NDVI', hoverIndicesEntry.entry.ndvi)}
                    {' · '}
                    {formatPill('NDMI', hoverIndicesEntry.entry.ndmi)}
                    {' · '}
                    {formatPill('NDBI', hoverIndicesEntry.entry.ndbi)}
                    {' · '}
                    {formatPill('NDWI', hoverIndicesEntry.entry.ndwi)}
                    {' · '}
                    {formatPill('BSI', hoverIndicesEntry.entry.bsi)}
                  </span>
                )}
              </div>
            </div>
          </Popup>
        )}
      </MapLibreMap>
      {children}
    </div>
  );
}

function formatPill(label: string, value: number | null): string {
  return `${label} ${formatIndex(value)}`;
}
