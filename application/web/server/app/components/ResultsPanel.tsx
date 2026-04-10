'use client';

import { IndicesChart } from './IndicesChart';
import { summarizeResult, type ResultStatus } from '@/lib/summarize';

const STATUS_PILL: Record<ResultStatus['kind'], { text: string; cls: string }> = {
  ok: { text: 'Completed', cls: 'text-emerald-700' },
  processing: { text: 'Running…', cls: 'text-amber-700' },
  error: { text: 'Error', cls: 'text-red-700' },
  ready: { text: 'Ready', cls: 'text-slate-500' },
  polygon_cleared: { text: 'Cleared', cls: 'text-slate-500' },
  region_changed: { text: 'Region changed', cls: 'text-slate-500' },
};

export function ResultsPanel({ status, elapsedSeconds }: { status: ResultStatus; elapsedSeconds?: number }) {
  const headline = summarizeResult(status);
  const pill = STATUS_PILL[status.kind];

  const result = status.kind === 'ok' ? status.result : null;
  const summary = result?.summary;
  const km = summary?.total_road_km;
  const edges = summary?.edge_count;
  const nodes = summary?.node_count;
  const sentinelMean = summary?.sentinel_mean ?? null;

  return (
    <div className="bg-white border border-slate-200 rounded-lg">
      <div className="px-5 py-3 border-b border-slate-200 flex items-center justify-between">
        <h2 className="label">Results</h2>
        <span className={`text-[10px] uppercase tracking-wider font-semibold ${pill.cls}`}>
          {pill.text}
          {status.kind === 'processing' && elapsedSeconds != null ? ` · ${elapsedSeconds}s` : null}
        </span>
      </div>
      <div className="p-5">
        <p className="text-xs text-slate-600 leading-relaxed mb-4">{headline}</p>

        <div className="grid grid-cols-3 border-t border-l border-slate-200 mb-5">
          <Kpi label="Road km" value={km != null ? km.toFixed(1) : '—'} />
          <Kpi label="Edges" value={edges != null ? edges.toLocaleString() : '—'} />
          <Kpi label="Nodes" value={nodes != null ? nodes.toLocaleString() : '—'} />
        </div>

        {status.kind === 'ok' && (
          <>
            <div className="label mb-2">Sentinel-2 mean indices</div>
            <IndicesChart stats={sentinelMean} />

            {result?.links && (result.links.mapillary || result.links.google_street_view) && (
              <div className="border-t border-slate-200 pt-3 mt-4 text-xs space-y-1.5">
                {result.links.mapillary && (
                  <a
                    href={result.links.mapillary}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block text-slate-700 hover:text-slate-900 hover:underline"
                  >
                    Open Mapillary at polygon centroid →
                  </a>
                )}
                {result.links.google_street_view && (
                  <a
                    href={result.links.google_street_view}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block text-slate-700 hover:text-slate-900 hover:underline"
                  >
                    Open Google Street View at polygon centroid →
                  </a>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-r border-b border-slate-200 p-3">
      <div className="label">{label}</div>
      <div className="num text-xl font-semibold text-slate-900 mt-1">{value}</div>
    </div>
  );
}
