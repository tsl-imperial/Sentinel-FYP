'use client';

import { useCallback, useRef, useState } from 'react';
import type { Map as MaplibreMap } from 'maplibre-gl';
import { useMapEvent } from '@/hooks/useMapEvent';

/**
 * CompassRose — floating compass button top-right of the map.
 *
 * Hidden when the map's bearing is 0 (the default). Becomes visible the
 * first time the user rotates (right-click drag, pinch-rotate, etc.).
 * Click resets bearing to 0 with a 200ms easeTo.
 *
 * **Perf-critical:** the `rotate` event fires per frame (~60Hz) during
 * pinch-rotate. To avoid 60 React re-renders per second, the rotation
 * transform is written directly to a CSS variable on the needle's DOM node
 * via a ref. The visibility toggle (hide when 0) goes through state because
 * it transitions rarely (eng-review Section 4).
 */
interface CompassRoseProps {
  map: MaplibreMap | null;
}

export function CompassRose({ map }: CompassRoseProps) {
  const needleRef = useRef<HTMLDivElement | null>(null);
  const [hidden, setHidden] = useState(true);

  const handleRotate = useCallback(() => {
    if (!map) return;
    const bearing = map.getBearing();
    // Direct DOM write on the needle — no React re-render at 60 Hz during
    // rotation. setHidden bails out internally if the value matches.
    needleRef.current?.style.setProperty('--bearing', `${bearing}deg`);
    setHidden(bearing === 0);
  }, [map]);

  useMapEvent(map, 'rotate', handleRotate);
  // Initial sync in case the map mounted with a non-zero bearing (e.g., URL
  // state restore in the future).
  useMapEvent(map, 'load', handleRotate);

  const handleClick = useCallback(() => {
    if (!map) return;
    map.easeTo({ bearing: 0, duration: 200 });
  }, [map]);

  if (hidden) return null;

  return (
    <button
      type="button"
      onClick={handleClick}
      aria-label="Reset bearing to north"
      className="absolute top-3 right-3 z-10 size-9 grid place-items-center rounded bg-white/80 backdrop-blur border border-slate-200 text-slate-700 hover:bg-white hover:text-slate-900 focus:outline-none focus:ring-1 focus:ring-slate-900"
    >
      <div
        ref={needleRef}
        className="relative size-5"
        style={{ transform: 'rotate(var(--bearing, 0deg))' }}
      >
        <div className="absolute inset-x-1/2 top-0 h-1/2 w-px -translate-x-1/2 bg-slate-900" />
        <div className="absolute inset-x-1/2 bottom-0 h-1/2 w-px -translate-x-1/2 bg-slate-300" />
        <div className="absolute -top-1 left-1/2 -translate-x-1/2 text-[8px] font-bold text-slate-900">N</div>
      </div>
    </button>
  );
}
