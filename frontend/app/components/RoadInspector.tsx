'use client';

import { useState } from 'react';
import { useRoadIndices } from '@/hooks/useRoadIndices';
import { formatIndex } from '@/lib/format';
import type { RoadIndicesEntry, RoadPrediction } from '@/lib/schemas/roadIndices';

/**
 * RoadInspector — docked road detail panel.
 *
 * Shows the clicked road's indices for ALL years (2020-2023) instead of just
 * the current TimeSlider year. Includes a "Lock to TimeSlider" toggle for the
 * future click→year-sync feature. Reserved space for future action slots
 * (compare, add to set, export).
 *
 * Mounted by `WorkbenchPanelContent` when the discriminated union state
 * machine is in the 'inspector' state.
 */
interface RoadInspectorProps {
  osmId: string;
  name: string;
  fclass: string;
  color: string;
  currentYear: number;
}

export function RoadInspector({ osmId, name, fclass, color, currentYear }: RoadInspectorProps) {
  const [lockToSlider, setLockToSlider] = useState(false);
  const query = useRoadIndices(osmId);

  const list = query.data?.indices ?? [];
  const prediction = query.data?.prediction ?? null;
  const visibleRows = lockToSlider ? list.filter((r) => r.year === currentYear) : list;

  return (
    <div className="p-4 space-y-4">
      <div>
        <div className="flex items-center gap-2">
          <span className="inline-block size-2.5 rounded-full" style={{ backgroundColor: color }} />
          <div className="text-sm font-medium text-slate-900 truncate">{name}</div>
        </div>
        <div className="mt-1 text-[11px] text-slate-500">
          {fclass} · osm_id {osmId}
        </div>
      </div>

      {/* Lock-to-slider toggle */}
      <label className="flex items-center gap-2 text-[11px] text-slate-600 select-none">
        <input
          type="checkbox"
          checked={lockToSlider}
          onChange={(e) => setLockToSlider(e.target.checked)}
          className="accent-slate-900"
        />
        <span>Lock to time slider ({currentYear})</span>
      </label>

      <Layer1PredictionCard prediction={prediction} isLoading={query.isLoading} />

      {/* Indices table */}
      <div>
        <div className="text-[10px] uppercase tracking-[0.15em] text-slate-500 font-semibold mb-2">
          Indices
        </div>
        {query.isLoading ? (
          <div className="text-[11px] text-slate-400">Loading…</div>
        ) : query.error ? (
          <div className="text-[11px] text-red-700">{query.error.message}</div>
        ) : visibleRows.length === 0 ? (
          <div className="text-[11px] text-slate-400">
            {lockToSlider ? `No indices for ${currentYear}` : 'No indices recorded for this road'}
          </div>
        ) : (
          <table className="w-full text-[11px] tabular-nums">
            <thead>
              <tr className="text-slate-500">
                <th className="text-left font-medium pb-1">Year</th>
                <th className="text-right font-medium pb-1">NDVI</th>
                <th className="text-right font-medium pb-1">NDMI</th>
                <th className="text-right font-medium pb-1">NDBI</th>
                <th className="text-right font-medium pb-1">NDWI</th>
                <th className="text-right font-medium pb-1">BSI</th>
              </tr>
            </thead>
            <tbody>
              {visibleRows.map((row) => (
                <RoadInspectorRow key={`${row.year}-${row.quarter}`} row={row} />
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function Layer1PredictionCard({
  prediction,
  isLoading,
}: {
  prediction: RoadPrediction | null;
  isLoading: boolean;
}) {
  const surface = prediction?.pred_surface;
  const confidence = prediction?.confidence;
  const isPaved = surface === 'paved';
  const label = surface ? surface.charAt(0).toUpperCase() + surface.slice(1) : 'Unavailable';
  const surfaceColor = isPaved ? '#3B6EA8' : '#C96B3C';

  return (
    <div className="border border-slate-200 rounded-md bg-slate-50/70 p-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-[10px] uppercase tracking-[0.15em] text-slate-500 font-semibold">
            Layer 1 prediction
          </div>
          {isLoading ? (
            <div className="mt-2 text-[11px] text-slate-400">Loading prediction…</div>
          ) : !prediction || !surface ? (
            <div className="mt-2 text-[11px] text-slate-400">No prediction available</div>
          ) : (
            <>
              <div className="mt-2 flex items-center gap-2">
                <span className="inline-block size-2.5 rounded-full" style={{ backgroundColor: surfaceColor }} />
                <span className="text-sm font-semibold text-slate-900">{label}</span>
                {prediction.low_confidence && (
                  <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800">
                    Low confidence
                  </span>
                )}
              </div>
              <div className="mt-2 grid grid-cols-3 gap-2 text-[11px]">
                <Metric label="Confidence" value={formatPercent(confidence)} />
                <Metric label="Paved" value={formatPercent(prediction.prob_paved)} />
                <Metric label="Unpaved" value={formatPercent(prediction.prob_unpaved)} />
              </div>
              {prediction.is_labelled_train_road === false && (
                <div className="mt-2 text-[10px] leading-snug text-slate-500">
                  Full-network prediction, outside the labelled training subset.
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[9px] uppercase tracking-[0.12em] text-slate-400">{label}</div>
      <div className="num mt-0.5 text-xs font-semibold text-slate-800">{value}</div>
    </div>
  );
}

function formatPercent(value: number | null | undefined): string {
  return value == null ? '—' : `${Math.round(value * 100)}%`;
}

function RoadInspectorRow({ row }: { row: RoadIndicesEntry }) {
  return (
    <tr className="border-t border-slate-100">
      <td className="py-1 text-slate-600">
        {row.year} {row.quarter ? `· ${row.quarter}` : ''}
      </td>
      <td className="py-1 text-right text-slate-900">{formatIndex(row.ndvi)}</td>
      <td className="py-1 text-right text-slate-900">{formatIndex(row.ndmi)}</td>
      <td className="py-1 text-right text-slate-900">{formatIndex(row.ndbi)}</td>
      <td className="py-1 text-right text-slate-900">{formatIndex(row.ndwi)}</td>
      <td className="py-1 text-right text-slate-900">{formatIndex(row.bsi)}</td>
    </tr>
  );
}
