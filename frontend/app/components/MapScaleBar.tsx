'use client';

import { useCallback, useState } from 'react';
import type { Map as MaplibreMap } from 'maplibre-gl';
import { useMapEvent } from '@/hooks/useMapEvent';
import { useDebouncedCallback } from '@/hooks/useDebounce';

/**
 * MapScaleBar — floating scale bar bottom-left of the map.
 *
 * Subscribes to `move` (debounced 100ms) and recomputes the scale label
 * from the current zoom via a small lookup table. Approximate by design —
 * the visual scale only needs to communicate "you're zoomed in/out this
 * much," not survey-grade accuracy.
 *
 * Lookup table snaps to friendly labels: 100m / 500m / 1km / 5km / 10km /
 * 50km / 100km / 500km. The bar's pixel width is fixed at 64px so the
 * relationship "longer label = more meters per pixel" lands intuitively
 * with the user moving from zoom 16 → zoom 4.
 */
interface MapScaleBarProps {
  map: MaplibreMap | null;
}

interface ScaleStep {
  label: string;
  // Approximate meters at this scale label, used internally for sorting.
  meters: number;
}

const SCALE_TABLE: Array<{ minZoom: number; step: ScaleStep }> = [
  { minZoom: 17, step: { label: '50 m', meters: 50 } },
  { minZoom: 16, step: { label: '100 m', meters: 100 } },
  { minZoom: 14, step: { label: '500 m', meters: 500 } },
  { minZoom: 13, step: { label: '1 km', meters: 1000 } },
  { minZoom: 11, step: { label: '5 km', meters: 5000 } },
  { minZoom: 9,  step: { label: '10 km', meters: 10000 } },
  { minZoom: 7,  step: { label: '50 km', meters: 50000 } },
  { minZoom: 5,  step: { label: '100 km', meters: 100000 } },
  { minZoom: 0,  step: { label: '500 km', meters: 500000 } },
];

function scaleForZoom(zoom: number): ScaleStep {
  for (const entry of SCALE_TABLE) {
    if (zoom >= entry.minZoom) return entry.step;
  }
  return SCALE_TABLE[SCALE_TABLE.length - 1]!.step;
}

export function MapScaleBar({ map }: MapScaleBarProps) {
  const [step, setStep] = useState<ScaleStep>(() =>
    map ? scaleForZoom(map.getZoom()) : SCALE_TABLE[4]!.step,
  );

  const recompute = useCallback(() => {
    if (!map) return;
    const next = scaleForZoom(map.getZoom());
    setStep((prev) => (prev.meters === next.meters ? prev : next));
  }, [map]);

  // 100 ms debounce. The hook returns a stable callback that the
  // useMapEvent hook below subscribes to. Cleanup is owned by both hooks.
  const debouncedRecompute = useDebouncedCallback(recompute, 100);
  useMapEvent(map, 'move', debouncedRecompute);
  // Initial sync on map load.
  useMapEvent(map, 'load', recompute);

  return (
    <div className="absolute bottom-3 left-3 z-10 bg-white/80 backdrop-blur px-2 py-1 rounded border border-slate-200">
      <div className="flex items-center gap-1.5">
        <div className="relative h-2 w-16">
          <div className="absolute inset-x-0 top-1/2 h-px bg-slate-700" />
          <div className="absolute left-0 top-0 h-2 w-px bg-slate-700" />
          <div className="absolute right-0 top-0 h-2 w-px bg-slate-700" />
        </div>
        <span className="text-[10px] tabular-nums text-slate-700">{step.label}</span>
      </div>
    </div>
  );
}
