'use client';

import type { OverviewLayer } from '@/lib/schemas/overviewLayers';

export function ClassLayerLegend({
  layers,
  enabled,
  onToggle,
}: {
  layers: OverviewLayer[];
  enabled: Record<string, boolean>;
  onToggle: (cls: string, on: boolean) => void;
}) {
  if (layers.length === 0) {
    return <div className="p-5 text-xs text-slate-400">No layers loaded.</div>;
  }

  return (
    <div className="p-5 space-y-1.5 text-xs">
      {layers.map((layer) => (
        <label key={layer.class} className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={enabled[layer.class] ?? true}
            onChange={(e) => onToggle(layer.class, e.target.checked)}
            className="accent-slate-900"
          />
          <span
            className="inline-block"
            style={{ background: layer.color, height: '3px', width: '14px' }}
          />
          <span className="text-slate-700 flex-1">{layer.class}</span>
        </label>
      ))}
    </div>
  );
}
