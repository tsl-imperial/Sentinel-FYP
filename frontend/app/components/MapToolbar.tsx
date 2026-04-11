'use client';

import { MousePointer2, Hexagon } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * MapToolbar — slim horizontal mode toolbar above the map.
 *
 * Two mutually-exclusive modes:
 *   - select  — clicks on roads open the road inspector. Polygon draw is OFF.
 *               Cursor is the default arrow.
 *   - polygon — clicks drop polygon vertices via terra-draw. Cursor is
 *               crosshair. Road click handler is suppressed so the user
 *               doesn't get an inspector AND a vertex on every click.
 *
 * Default mode is `select` so the user can click around the map without
 * accidentally drawing polygons. Switching to `polygon` mode is the explicit
 * "I want to extract" gesture.
 *
 * Lives above the map (h-9 strip) so the modes are discoverable without
 * floating chrome competing for attention with the existing MapControls
 * (bottom-right) and CompassRose (top-right).
 */
export type MapMode = 'select' | 'polygon';

interface MapToolbarProps {
  mode: MapMode;
  onModeChange: (next: MapMode) => void;
}

export function MapToolbar({ mode, onModeChange }: MapToolbarProps) {
  return (
    <div className="h-9 shrink-0 flex items-center gap-1 px-2 border-b border-slate-200 bg-white">
      <ToolbarButton
        active={mode === 'select'}
        onClick={() => onModeChange('select')}
        ariaLabel="Select mode — click roads to inspect"
        title="Select (click roads to inspect)"
      >
        <MousePointer2 className="size-3.5" />
        <span>Select</span>
      </ToolbarButton>
      <ToolbarButton
        active={mode === 'polygon'}
        onClick={() => onModeChange('polygon')}
        ariaLabel="Polygon mode — draw a polygon for extraction"
        title="Polygon (draw to extract)"
      >
        <Hexagon className="size-3.5" />
        <span>Polygon</span>
      </ToolbarButton>
    </div>
  );
}

interface ToolbarButtonProps {
  active: boolean;
  onClick: () => void;
  ariaLabel: string;
  title: string;
  children: React.ReactNode;
}

function ToolbarButton({ active, onClick, ariaLabel, title, children }: ToolbarButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      aria-label={ariaLabel}
      title={title}
      className={cn(
        'flex items-center gap-1.5 px-2 py-1 text-xs font-medium transition-colors focus:outline-none focus:ring-1 focus:ring-slate-900',
        active
          ? 'bg-slate-900 text-white'
          : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900',
      )}
    >
      {children}
    </button>
  );
}
