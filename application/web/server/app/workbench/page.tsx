'use client';

// MapView is dynamic-loaded with ssr:false because Leaflet touches window at
// module load. The map instance is held in state (not a ref) so usePolygonDraw
// re-runs when it appears. The export mutation owns its AbortController in a
// ref because mutation.reset() only clears local state — it doesn't abort the
// in-flight fetch.
import dynamic from 'next/dynamic';
import { Suspense, useState, useRef, useEffect, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import type L from 'leaflet';
import { useMutation } from '@tanstack/react-query';

import { PageHeader } from '@/components/PageHeader';
import { RegionPicker } from '@/components/RegionPicker';
import { TimeSlider } from '@/components/TimeSlider';
import { ResultsPanel } from '@/components/ResultsPanel';
import { ClassLayerLegend } from '@/components/ClassLayerLegend';

import { useRegionInfo } from '@/hooks/useRegionInfo';
import { useOverviewLayers } from '@/hooks/useOverviewLayers';
import { useBoundaryLayer } from '@/hooks/useBoundaryLayer';
import { usePolygonDraw } from '@/hooks/usePolygonDraw';

import { apiFetch, ApiError } from '@/lib/api';
import {
  exportResponseSchema,
  type ExportResponse,
  type ExportRequest,
} from '@/lib/schemas/exportPolygonNetworkS2';
import { timePointAt } from '@/lib/timePoints';
import type { ResultStatus } from '@/lib/summarize';

const MapView = dynamic(() => import('@/components/MapView'), {
  ssr: false,
  loading: () => (
    <div className="flex-1 grid place-items-center text-sm text-slate-400" style={{ minHeight: 720 }}>
      Loading map…
    </div>
  ),
});

const DEFAULT_REGION = 'Ghana';
const DEFAULT_CENTER: [number, number] = [7.95, -1.0];
const DEFAULT_ZOOM = 7;

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
  const router = useRouter();
  const searchParams = useSearchParams();

  // URL is the source of truth for the active region. The RegionPicker calls
  // handleRegionChange → router.replace → searchParams updates → re-render.
  // Side effects (polygon clear, status reset) live in a dedicated effect
  // that watches the derived value, so they fire whether the user clicks the
  // picker or navigates from the /regions page.
  const region = searchParams.get('region') ?? DEFAULT_REGION;

  const [timeIdx, setTimeIdx] = useState(14); // 2024 Q3 default
  const [cloud, setCloud] = useState(30);
  const [filename, setFilename] = useState('accra_central_2024Q3');

  const [enabled, setEnabled] = useState<Record<string, boolean>>({});

  // Map instance is held in state so usePolygonDraw re-runs when it appears.
  const [map, setMap] = useState<L.Map | null>(null);

  const polygon = usePolygonDraw(map);

  const regionInfo = useRegionInfo(region);
  const overview = useOverviewLayers(region);
  const boundary = useBoundaryLayer(region);

  const center: [number, number] = regionInfo.data?.center ?? DEFAULT_CENTER;
  const zoom = regionInfo.data ? 9 : DEFAULT_ZOOM;

  // Initialise toggle defaults when new classes appear. The functional
  // setState returns the same reference when nothing changed, so React skips
  // the re-render even if the effect re-runs on a same-content refetch.
  const overviewLayers = overview.data?.layers;
  useEffect(() => {
    if (!overviewLayers) return;
    setEnabled((prev) => {
      const next = { ...prev };
      let changed = false;
      for (const layer of overviewLayers) {
        if (!(layer.class in next)) {
          next[layer.class] = true;
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [overviewLayers]);

  const handleRegionChange = useCallback(
    (next: string) => {
      router.replace(`/workbench?region=${encodeURIComponent(next)}`);
    },
    [router],
  );

  const abortRef = useRef<AbortController | null>(null);
  const [status, setStatus] = useState<ResultStatus>({ kind: 'ready' });
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  // Side effects of region change. Watches the URL-derived value so it fires
  // for both internal RegionPicker changes and external /regions navigations.
  // Skips the initial mount via prevRegionRef to avoid blowing away the
  // default 'ready' status.
  const prevRegionRef = useRef(region);
  useEffect(() => {
    if (prevRegionRef.current === region) return;
    prevRegionRef.current = region;
    polygon.clear();
    setStatus({ kind: 'region_changed' });
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
    onSuccess: (result) => {
      setStatus({ kind: 'ok', result, region });
    },
    onError: (err) => {
      // AbortError is reported as a generic Error from fetch — treat aborts as ready
      if (err.name === 'AbortError' || err.message.includes('aborted')) {
        setStatus({ kind: 'ready' });
      } else {
        setStatus({ kind: 'error', error: err.message });
      }
    },
  });

  // Tick the elapsed-seconds counter while a request is in flight
  useEffect(() => {
    if (status.kind !== 'processing') return;
    const interval = setInterval(() => setElapsedSeconds((s) => s + 1), 1000);
    return () => clearInterval(interval);
  }, [status.kind]);

  const handleRun = () => {
    if (!polygon.isClosed || polygon.pointCount < 3) {
      setStatus({ kind: 'error', error: 'Polygon is not closed. Double-click the map or click the first point to close it.' });
      return;
    }
    const cleanFilename = filename.trim();
    if (!cleanFilename) {
      setStatus({ kind: 'error', error: 'Filename is required.' });
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
  };

  const handleClear = () => {
    polygon.clear();
    setStatus({ kind: 'polygon_cleared' });
  };

  const handleCancel = () => {
    abortRef.current?.abort();
  };

  const handleToggleClass = useCallback((cls: string, on: boolean) => {
    setEnabled((prev) => ({ ...prev, [cls]: on }));
  }, []);

  const isProcessing = status.kind === 'processing';

  return (
    <>
      <PageHeader
        title="Workbench"
        breadcrumb={region}
        description="Define a polygon, extract the drivable network, and compute Sentinel-2 reflectance indices."
      />
      <div className="mx-auto max-w-[1600px] px-8 py-6 grid grid-cols-12 gap-6 flex-1 w-full">
        {/* LEFT: map */}
        <section className="col-span-8 bg-white border border-slate-200 rounded-lg overflow-hidden flex flex-col">
          <div className="px-5 py-3 border-b border-slate-200 flex items-center justify-between flex-shrink-0">
            <div className="flex items-center gap-3 text-xs">
              <span className="label">Map</span>
              <span className="text-slate-300">·</span>
              <span className="text-slate-600">
                {overview.data ? `${overview.data.layers.length} class layers` : 'Loading layers…'}
              </span>
            </div>
            {regionInfo.error && (
              <span className="text-[11px] text-red-700">Region info failed: {regionInfo.error.message}</span>
            )}
          </div>
          <MapView
            center={center}
            zoom={zoom}
            overviewLayers={overview.data?.layers ?? []}
            enabled={enabled}
            boundary={boundary.data ?? null}
            onMapReady={setMap}
          />
        </section>

        {/* RIGHT: controls + results + legend */}
        <aside className="col-span-4 space-y-4">
          {/* Controls card */}
          <div className="bg-white border border-slate-200 rounded-lg">
            <div className="px-5 py-3 border-b border-slate-200">
              <h2 className="label">Extraction parameters</h2>
            </div>
            <div className="p-5">
              <label className="block text-xs font-medium text-slate-700 mb-1.5">Region</label>
              <div className="mb-4">
                <RegionPicker value={region} onChange={handleRegionChange} disabled={isProcessing} />
              </div>

              <label className="block text-xs font-medium text-slate-700 mb-1.5">Time period</label>
              <div className="mb-4">
                <TimeSlider index={timeIdx} onChange={setTimeIdx} />
              </div>

              <label className="block text-xs font-medium text-slate-700 mb-1.5">Cloud threshold</label>
              <div className="flex items-center gap-3 mb-4">
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={cloud}
                  onChange={(e) => setCloud(Number(e.target.value))}
                  className="flex-1 accent-slate-900"
                />
                <span className="text-sm text-slate-700 num w-8 text-right">{cloud}%</span>
              </div>

              <label className="block text-xs font-medium text-slate-700 mb-1.5">Output filename</label>
              <input
                type="text"
                value={filename}
                onChange={(e) => setFilename(e.target.value)}
                className="w-full mb-4 px-3 py-2 border border-slate-300 rounded text-sm bg-white focus:outline-none focus:ring-1 focus:ring-slate-900 focus:border-slate-900"
              />

              <div className="flex gap-2">
                {isProcessing ? (
                  <button
                    onClick={handleCancel}
                    className="flex-1 px-3 py-2 rounded bg-amber-600 hover:bg-amber-700 text-white text-sm font-medium"
                  >
                    Cancel ({elapsedSeconds}s)
                  </button>
                ) : (
                  <button
                    onClick={handleRun}
                    className="flex-1 px-3 py-2 rounded bg-slate-900 hover:bg-slate-800 text-white text-sm font-medium"
                  >
                    Run extraction
                  </button>
                )}
                <button
                  onClick={handleClear}
                  disabled={isProcessing}
                  className="px-3 py-2 rounded border border-slate-300 hover:bg-slate-50 text-slate-700 text-sm font-medium disabled:opacity-50"
                >
                  Clear
                </button>
              </div>
            </div>
          </div>

          {/* Results card */}
          <ResultsPanel status={status} elapsedSeconds={elapsedSeconds} />

          {/* Class layer legend */}
          <div className="bg-white border border-slate-200 rounded-lg">
            <div className="px-5 py-3 border-b border-slate-200">
              <h2 className="label">Road classes</h2>
            </div>
            {overview.isLoading ? (
              <div className="p-5 text-xs text-slate-400">Loading layers…</div>
            ) : overview.error ? (
              <div className="p-5 text-xs text-red-700">{overview.error.message}</div>
            ) : (
              <ClassLayerLegend
                layers={overview.data?.layers ?? []}
                enabled={enabled}
                onToggle={handleToggleClass}
              />
            )}
          </div>
        </aside>
      </div>
    </>
  );
}
