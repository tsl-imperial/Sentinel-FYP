'use client';

/**
 * Workbench page — the orchestrator.
 *
 * After the v2.5 nefos-primitives rebuild, this file is responsible for the
 * discriminated union DockedPanel state machine, the cross-component state
 * (region, time, cloud, filename, polygon, click selection, welcomed flag),
 * the export mutation, and the side effects that tie them together. The
 * presentation lives in WorkbenchSidebar, MapView, and WorkbenchPanelContent.
 *
 * Eng-review Section 2 Issue 8: page split into 3 files. Page is the state
 * machine + effects orchestrator (~350 lines), sidebar and panel content
 * are presentational extracts.
 *
 * Eng-review Section 1 Issue 1: ONE DockedPanel mount instance whose content
 * swaps via the discriminated union, so the slide-in animation plays once
 * per closed→open transition.
 *
 * MapView is dynamic-loaded with ssr:false because MapLibre touches window at
 * module load.
 */
import dynamic from 'next/dynamic';
import { Suspense, useState, useRef, useEffect, useCallback, useMemo } from 'react';
import type { MapRef } from 'react-map-gl/maplibre';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';

import { WorkbenchSidebar } from '@/components/WorkbenchSidebar';
import {
  WorkbenchPanelContent,
  titleFor,
  titleIdFor,
  type PanelState,
} from '@/components/WorkbenchPanelContent';
import { DockedPanel } from '@/components/ui/DockedPanel';
import { MapControls } from '@/components/ui/MapControls';
import { CompassRose } from '@/components/CompassRose';
import { MapScaleBar } from '@/components/MapScaleBar';
import { CoordsHud } from '@/components/CoordsHud';
import { AttributionChip } from '@/components/AttributionChip';
import { DrawHintPill } from '@/components/DrawHintPill';
import { StatusCard } from '@/components/StatusCard';
import { MapToolbar, type MapMode } from '@/components/MapToolbar';
import type { ClickedRoadMeta } from '@/components/MapView';

import { useRegionInfo } from '@/hooks/useRegionInfo';
import { useClassPalette } from '@/hooks/useClassPalette';
import { useBoundaryLayer } from '@/hooks/useBoundaryLayer';
import { usePolygonDraw } from '@/hooks/usePolygonDraw';
import { useUrlState } from '@/hooks/useUrlState';
import { useMapEvent } from '@/hooks/useMapEvent';

import { apiFetch, ApiError } from '@/lib/api';
import {
  exportResponseSchema,
  type ExportResponse,
  type ExportRequest,
} from '@/lib/schemas/exportPolygonNetworkS2';
import { timePointAt } from '@/lib/timePoints';
import type { ResultStatus } from '@/lib/summarize';
import { buildCatalog } from '@/lib/layers/catalog';

const MapView = dynamic(() => import('@/components/MapView'), {
  ssr: false,
  loading: () => (
    <div className="flex-1 grid place-items-center text-sm text-slate-400" style={{ minHeight: 720 }}>
      Loading map…
    </div>
  ),
});

const DEFAULT_CENTER: [number, number] = [7.95, -1.0];
const DEFAULT_ZOOM = 7;
const WELCOMED_KEY = 'netinspect_welcomed';

// useSearchParams forces this subtree out of the static prerender pass, so it
// has to live behind a Suspense boundary. The default export wraps the inner
// component for that reason.
export default function WorkbenchPage() {
  return (
    <Suspense
      fallback={
        <div className="flex-1 grid place-items-center text-sm text-slate-400">Loading workbench…</div>
      }
    >
      <WorkbenchInner />
    </Suspense>
  );
}

function WorkbenchInner() {
  // URL state — region/time/cloud are URL-driven; setters update the URL via
  // useUrlState's debounced helpers (immediate for discrete state, 250ms for
  // map state).
  const url = useUrlState();
  const region = url.state.region;
  const timeIdx = url.state.timeIdx;
  const cloud = url.state.cloud;

  const [filename, setFilename] = useState('accra_central_2024Q3');
  const [enabled, setEnabled] = useState<Record<string, boolean>>({});

  // Map interaction mode. Default 'select' so the user can click roads
  // without accidentally drawing polygons. The MapToolbar above the map is
  // the explicit way to switch into 'polygon' mode for extraction.
  const [mapMode, setMapMode] = useState<MapMode>('select');

  // MapRef from react-map-gl is held in state so usePolygonDraw re-runs when
  // it appears (and when MapView remounts on palette change).
  const [mapRef, setMapRef] = useState<MapRef | null>(null);
  const maplibreMap = useMemo(() => mapRef?.getMap() ?? null, [mapRef]);
  // terra-draw is only initialised in polygon mode. In select mode the hook
  // is a no-op so map clicks fall through to the road click handler.
  const polygon = usePolygonDraw(maplibreMap, mapMode === 'polygon');

  const regionInfo = useRegionInfo(region);
  const palette = useClassPalette();
  const boundary = useBoundaryLayer(region);

  // Initial map view: prefer URL state (`?center=lat,lng&zoom=N`) over the
  // region default. URL state only takes precedence on first mount because
  // MapView's initialViewState is one-shot — subsequent region picks fly the
  // map to the region center, and the moveend handler below writes the new
  // view back to the URL.
  const center: [number, number] = url.state.center ?? regionInfo.data?.center ?? DEFAULT_CENTER;
  const zoom = url.state.zoom ?? (regionInfo.data ? 9 : DEFAULT_ZOOM);
  const currentTimePoint = useMemo(() => timePointAt(timeIdx), [timeIdx]);
  const currentYear = currentTimePoint.year;
  const currentQuarter = currentTimePoint.quarter;
  const paletteData = palette.data;
  const catalog = useMemo(
    () => (paletteData ? buildCatalog(paletteData) : null),
    [paletteData],
  );

  // Initialise toggle defaults when the palette arrives.
  useEffect(() => {
    if (!paletteData) return;
    setEnabled((prev) => {
      const next = { ...prev };
      let changed = false;
      for (const fclass of paletteData.order) {
        if (!(fclass in next)) {
          next[fclass] = true;
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [paletteData]);

  // Region change → animated flyTo. Skip first fire because initialViewState
  // already placed the map at the same target.
  const flyToHasFiredRef = useRef(false);
  useEffect(() => {
    if (!mapRef) return;
    if (!flyToHasFiredRef.current) {
      flyToHasFiredRef.current = true;
      return;
    }
    mapRef.getMap()?.flyTo({
      center: [center[1], center[0]],
      zoom,
      duration: 600,
      essential: true,
    });
  }, [mapRef, center, zoom]);

  // Persist the current map view (center + zoom) to the URL on every moveend
  // so workbench links are shareable. The setMapView callback debounces 250ms
  // internally so flyTo / pan / pinch don't write the URL 60x/sec.
  const writeMapViewToUrl = useCallback(() => {
    if (!maplibreMap) return;
    const c = maplibreMap.getCenter();
    url.setMapView({ center: [c.lat, c.lng], zoom: maplibreMap.getZoom() });
  }, [maplibreMap, url]);
  useMapEvent(maplibreMap, 'moveend', writeMapViewToUrl);

  // Click selection — the source for the docked road inspector.
  const [clickedRoad, setClickedRoad] = useState<ClickedRoadMeta | null>(null);

  // Welcome state — gated on localStorage. Reads on mount, writes on dismiss
  // OR on first successful extraction.
  const [welcomed, setWelcomed] = useState<boolean>(true); // optimistic until rehydrate
  useEffect(() => {
    try {
      setWelcomed(window.localStorage.getItem(WELCOMED_KEY) === '1');
    } catch {
      // localStorage disabled — show welcome every visit, no harm.
      setWelcomed(false);
    }
  }, []);
  const dismissWelcome = useCallback(() => {
    try {
      window.localStorage.setItem(WELCOMED_KEY, '1');
    } catch {
      // ignore
    }
    setWelcomed(true);
  }, []);

  const abortRef = useRef<AbortController | null>(null);
  const [status, setStatus] = useState<ResultStatus>({ kind: 'ready' });
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  // Region change side effects: clear polygon, reset status, abort any
  // in-flight extraction. The abort is critical because the previous region's
  // request would otherwise return AFTER the user navigated away and the
  // result would be silently mislabeled with the new region.
  const prevRegionRef = useRef(region);
  useEffect(() => {
    if (prevRegionRef.current === region) return;
    prevRegionRef.current = region;
    polygon.clear();
    setStatus({ kind: 'region_changed' });
    setClickedRoad(null);
    abortRef.current?.abort();
  }, [region, polygon]);

  const exportMutation = useMutation<ExportResponse, ApiError, ExportRequest>({
    mutationFn: async (payload) => {
      abortRef.current?.abort();
      abortRef.current = new AbortController();
      return apiFetch('/api/export_polygon_network_s2', exportResponseSchema, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: abortRef.current.signal,
      });
    },
    onMutate: () => {
      setStatus({ kind: 'processing' });
      setElapsedSeconds(0);
    },
    onSuccess: (result, variables) => {
      // Read region from the mutation variables, NOT from the closure-captured
      // React state. The closure may have updated to a NEW region between
      // mutate() and the response landing — using the closed-over `region`
      // would silently mislabel the result.
      setStatus({ kind: 'ok', result, region: variables.region });
      // First successful extraction (degraded or not) also dismisses the
      // welcome card. Even a degraded extraction means the user has done
      // the workflow once and doesn't need orientation.
      try {
        window.localStorage.setItem(WELCOMED_KEY, '1');
      } catch {
        // ignore
      }
      setWelcomed(true);
      const km = result.summary?.total_road_km;
      const edges = result.summary?.edge_count;
      const stats =
        km != null && edges != null
          ? `${km.toFixed(1)} km · ${edges.toLocaleString()} edges`
          : undefined;
      if (result.degraded) {
        // Network outputs are valid; Sentinel-2 step failed. Warning toast
        // (orange) instead of success (green) so the user knows the indices
        // are missing without thinking the whole run failed.
        toast.warning('Extracted without Sentinel indices', {
          description:
            (stats ? stats + ' · ' : '') +
            (result.degraded_reason ?? 'Earth Engine unavailable'),
          duration: 10000,
        });
      } else {
        toast.success('Extraction complete', { description: stats });
      }
    },
    onError: (err) => {
      // AbortError means EITHER the user clicked Cancel (handleCancel below
      // already set status to 'ready' BEFORE aborting) OR a new mutation
      // aborted this one (the new mutation's onMutate already set status to
      // 'processing'). Either way, this handler must NOT touch status or it
      // would clobber the legitimate state set by the other code path.
      if (err.name === 'AbortError' || err.message.includes('aborted')) {
        return;
      }
      setStatus({ kind: 'error', error: err.message });
      // Surface the failure as a toast in addition to the docked panel.
      // The docked panel is on the right edge and easy to miss; the toast
      // ensures the user sees the failure no matter where they're looking.
      toast.error('Extraction failed', {
        description: err.message,
        duration: 10000,
      });
    },
  });

  // Tick the elapsed-seconds counter while a request is in flight
  useEffect(() => {
    if (status.kind !== 'processing') return;
    const interval = setInterval(() => setElapsedSeconds((s) => s + 1), 1000);
    return () => clearInterval(interval);
  }, [status.kind]);

  const handleRun = useCallback(() => {
    // "I want to extract" intent flow: if the user clicks Run without ever
    // entering polygon mode, switch them to polygon mode and prompt them to
    // draw. Don't toast an error — that's confusing on a first attempt.
    if (mapMode === 'select' && polygon.pointCount === 0) {
      setMapMode('polygon');
      toast.info('Draw a polygon', {
        description: 'Click on the map to add vertices, double-click to close.',
        duration: 6000,
      });
      return;
    }
    if (!polygon.isClosed || polygon.pointCount < 3) {
      const msg = 'Polygon is not closed. Double-click the map or click the first point to close it.';
      setStatus({ kind: 'error', error: msg });
      toast.error('Cannot run extraction', { description: msg });
      return;
    }
    const cleanFilename = filename.trim();
    if (!cleanFilename) {
      const msg = 'Filename is required.';
      setStatus({ kind: 'error', error: msg });
      toast.error('Cannot run extraction', { description: msg });
      return;
    }
    const tp = timePointAt(timeIdx);
    exportMutation.mutate({
      polygon: polygon.getLngLatPolygon(),
      filename: cleanFilename,
      year: tp.year,
      quarter: tp.quarter,
      cloud,
      scale: 20,
      buffer: 12,
      region,
    });
  }, [polygon, filename, timeIdx, cloud, region, exportMutation, mapMode]);

  const handleClear = useCallback(() => {
    polygon.clear();
    setStatus({ kind: 'polygon_cleared' });
  }, [polygon]);

  const handleCancel = useCallback(() => {
    // Set 'ready' BEFORE aborting so onError sees the AbortError and ignores
    // it (the new ignore-AbortError branch in onError relies on this). This
    // avoids the race where onError clobbers the state of a newer mutation.
    setStatus({ kind: 'ready' });
    abortRef.current?.abort();
  }, []);

  const handleToggleClass = useCallback((cls: string, on: boolean) => {
    setEnabled((prev) => ({ ...prev, [cls]: on }));
  }, []);

  // ─── Discriminated union DockedPanel state machine (eng-review Issue 1) ──
  // Precedence is encoded in the order of these branches. Do not reorder.
  const panelState: PanelState = useMemo(() => {
    if (status.kind === 'processing' || status.kind === 'ok' || status.kind === 'error') {
      return { kind: 'extraction', status, elapsedSeconds };
    }
    if (clickedRoad !== null) {
      return { kind: 'inspector', meta: clickedRoad, currentYear };
    }
    if (!welcomed) return { kind: 'welcome' };
    return { kind: 'closed' };
  }, [status, elapsedSeconds, clickedRoad, currentYear, welcomed]);

  // Close handler dispatches per-state. Unreachable when kind === 'closed'
  // because the panel only mounts when kind !== 'closed' (see JSX below).
  const closePanel = useCallback(() => {
    switch (panelState.kind) {
      case 'extraction':
        // X = hide only, request keeps running (CEO Pass 4 decision).
        // We achieve "hide" by resetting status to 'ready' so the panel
        // falls through to the next variant. The in-flight mutation is
        // unaffected because we don't call abortRef.current.abort().
        setStatus({ kind: 'ready' });
        break;
      case 'inspector':
        setClickedRoad(null);
        break;
      case 'welcome':
        dismissWelcome();
        break;
    }
  }, [panelState, dismissWelcome]);

  // Click on a road from MapView → set clicked selection (parent state),
  // panel state machine promotes to inspector via the precedence rules above.
  // Suppressed in polygon mode so the user doesn't get an inspector AND a
  // vertex on the same click.
  const handleClickRoad = useCallback(
    (meta: ClickedRoadMeta | null) => {
      if (mapMode === 'polygon') return;
      setClickedRoad(meta);
    },
    [mapMode],
  );

  // Map control button callbacks.
  const handleZoomIn = useCallback(() => {
    maplibreMap?.zoomTo(maplibreMap.getZoom() + 0.5, { duration: 200 });
  }, [maplibreMap]);
  const handleZoomOut = useCallback(() => {
    maplibreMap?.zoomTo(maplibreMap.getZoom() - 0.5, { duration: 200 });
  }, [maplibreMap]);
  const handleResetNorth = useCallback(() => {
    maplibreMap?.resetNorthPitch({ duration: 200 });
  }, [maplibreMap]);
  const handleFitBounds = useCallback(() => {
    if (!maplibreMap || !boundary.data) return;
    // boundary.data.geojson is a FeatureCollection of one Polygon
    const fc = boundary.data.geojson as GeoJSON.FeatureCollection;
    const feature = fc.features[0];
    if (!feature || feature.geometry.type !== 'Polygon') return;
    const ring = (feature.geometry as GeoJSON.Polygon).coordinates[0];
    if (!ring || ring.length === 0) return;
    let minLng = Infinity;
    let minLat = Infinity;
    let maxLng = -Infinity;
    let maxLat = -Infinity;
    for (const pt of ring) {
      const [lng, lat] = pt;
      if (lng !== undefined && lat !== undefined) {
        if (lng < minLng) minLng = lng;
        if (lng > maxLng) maxLng = lng;
        if (lat < minLat) minLat = lat;
        if (lat > maxLat) maxLat = lat;
      }
    }
    maplibreMap.fitBounds([[minLng, minLat], [maxLng, maxLat]], { padding: 40, duration: 400 });
  }, [maplibreMap, boundary.data]);

  return (
    <div className="flex h-full overflow-hidden flex-1 w-full">
      {/* Sidebar — present at all times. Mounts even before palette resolves
          so the user sees structure immediately; class section just shows
          empty until the palette arrives. */}
      {paletteData && catalog ? (
        <WorkbenchSidebar
          region={region}
          catalog={catalog}
          enabledClasses={enabled}
          onToggleClass={handleToggleClass}
          timeIdx={timeIdx}
          onTimeIdxChange={url.setTimeIdx}
          cloud={cloud}
          onCloudChange={url.setCloud}
          filename={filename}
          onFilenameChange={setFilename}
          onRegionChange={url.setRegion}
          isProcessing={status.kind === 'processing'}
          elapsedSeconds={elapsedSeconds}
          onRun={handleRun}
          onCancel={handleCancel}
          onClear={handleClear}
        />
      ) : (
        <div className="w-52 shrink-0 border-r border-slate-200 bg-white p-4 text-xs text-slate-400">
          Loading…
        </div>
      )}

      {/* Map column — slim mode toolbar above the map, then the map fills
          the rest. The MapView is full-bleed inside its slot; children are
          the floating instruments + map controls layered inside MapView's
          relative container. */}
      <div className="flex-1 flex flex-col min-w-0">
        <MapToolbar mode={mapMode} onModeChange={setMapMode} />
        {palette.error ? (
          <div className="flex-1 p-5 grid place-items-center">
            <StatusCard kind="error">
              Could not load class palette: {palette.error.message}
            </StatusCard>
          </div>
        ) : !paletteData ? (
          <div className="flex-1 grid place-items-center text-sm text-slate-400">
            Loading map…
          </div>
        ) : (
          <MapView
            palette={paletteData}
            center={center}
            zoom={zoom}
            enabled={enabled}
            boundary={boundary.data ?? null}
            onMapReady={setMapRef}
            onClickRoad={handleClickRoad}
            currentYear={currentYear}
            currentQuarter={currentQuarter}
            cursor={mapMode === 'polygon' ? 'crosshair' : 'grab'}
          >
            <CompassRose map={maplibreMap} />
            <MapScaleBar map={maplibreMap} />
            <CoordsHud map={maplibreMap} />
            <AttributionChip />
            <MapControls
              onZoomIn={handleZoomIn}
              onZoomOut={handleZoomOut}
              onResetNorth={handleResetNorth}
              onFitBounds={handleFitBounds}
            />
            <DrawHintPill
              visible={mapMode === 'polygon' && polygon.pointCount > 0 && !polygon.isClosed}
            />
          </MapView>
        )}
      </div>

      {/* DockedPanel — single mount instance, content swaps via the
          discriminated union dispatcher. Animation plays once per
          closed→open transition. */}
      {panelState.kind !== 'closed' && (
        <DockedPanel
          title={titleFor(panelState)}
          titleId={titleIdFor(panelState)}
          onClose={closePanel}
          focusOnMount={panelState.kind === 'inspector'}
        >
          <WorkbenchPanelContent state={panelState} onDismissWelcome={dismissWelcome} />
        </DockedPanel>
      )}
    </div>
  );
}
