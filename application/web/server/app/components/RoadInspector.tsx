'use client';

import { useState } from 'react';
import { useRoadIndices } from '@/hooks/useRoadIndices';
import { formatIndex } from '@/lib/format';
import type { RoadIndicesEntry } from '@/lib/schemas/roadIndices';

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
