'use client';

import type { ClassPalette } from '@/lib/schemas/classPalette';
import { FALLBACK_ROAD_COLOR } from '@/lib/maplibre-style';

export function ClassLayerLegend({
  palette,
  enabled,
  onToggle,
}: {
  palette: ClassPalette;
  enabled: Record<string, boolean>;
  onToggle: (cls: string, on: boolean) => void;
}) {
  if (palette.order.length === 0) {
    return <div className="p-5 text-xs text-slate-400">No layers loaded.</div>;
  }

  return (
    <div className="p-5 space-y-1.5 text-xs">
      {palette.order.map((fclass) => (
        <label key={fclass} className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={enabled[fclass] ?? true}
            onChange={(e) => onToggle(fclass, e.target.checked)}
            className="accent-slate-900"
          />
          <span
            className="inline-block"
            style={{ background: palette.colors[fclass] ?? FALLBACK_ROAD_COLOR, height: '3px', width: '14px' }}
          />
          <span className="text-slate-700 flex-1">{fclass}</span>
        </label>
      ))}
    </div>
  );
}
