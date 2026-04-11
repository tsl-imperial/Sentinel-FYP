'use client';

import { useCallback, useRef } from 'react';
import type { Map as MaplibreMap, MapMouseEvent } from 'maplibre-gl';
import { useMapEvent } from '@/hooks/useMapEvent';

/**
 * CoordsHud — floating coordinates readout that follows the cursor.
 *
 * Subscribes directly to the map's `mousemove` and `mouseout` events instead
 * of taking the cursor position as a prop. Why: piping cursor coordinates
 * through parent React state forced the entire workbench tree to re-render
 * at ~60 Hz during mouse motion, defeating the whole point of having a
 * shared mousemove subscription. Now CoordsHud writes directly to a DOM
 * text node via a ref — zero React re-renders during sustained motion. The
 * div is always mounted and its textContent is empty until the first move,
 * which is invisible.
 *
 * Format: `°N · °W` with 4 decimal places (~11m precision). Uses `Math.abs`
 * + N/S/E/W instead of signed decimals because negative numbers are harder
 * to read at hover speed.
 */
interface CoordsHudProps {
  map: MaplibreMap | null;
}

export function CoordsHud({ map }: CoordsHudProps) {
  const textRef = useRef<HTMLDivElement | null>(null);

  const handleMove = useCallback((e: MapMouseEvent) => {
    if (!textRef.current) return;
    textRef.current.textContent = formatLngLat(e.lngLat.lng, e.lngLat.lat);
  }, []);

  const handleLeave = useCallback(() => {
    if (!textRef.current) return;
    textRef.current.textContent = '';
  }, []);

  useMapEvent(map, 'mousemove', handleMove);
  useMapEvent(map, 'mouseout', handleLeave);

  return (
    <div
      ref={textRef}
      className="absolute bottom-3 left-1/2 -translate-x-1/2 z-10 text-[10px] tabular-nums text-slate-500 pointer-events-none select-none"
    />
  );
}

function formatLngLat(lng: number, lat: number): string {
  const ns = lat >= 0 ? 'N' : 'S';
  const ew = lng >= 0 ? 'E' : 'W';
  return `${Math.abs(lat).toFixed(4)}°${ns} · ${Math.abs(lng).toFixed(4)}°${ew}`;
}
