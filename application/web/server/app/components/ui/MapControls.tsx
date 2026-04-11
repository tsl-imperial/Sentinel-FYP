import { Plus, Minus, Compass, Maximize } from 'lucide-react';

/**
 * MapControls — floating bottom-right map control buttons (zoom in/out,
 * reset bearing, fit bounds).
 *
 * Ported from `nefos_web2/src/components/shared/map-controls.tsx` with the
 * slate token mapping applied. Replaces the default react-map-gl
 * `<NavigationControl/>` so the workbench has a consistent visual language
 * with the rest of the design system. Each button has an explicit aria-label
 * per the eng-review a11y baseline.
 *
 * Stack offset from the bottom (`bottom-3`) leaves room for the scale bar
 * at `bottom-3 left-3` and the attribution chip at `bottom-14 right-3`.
 */
interface MapControlsProps {
  onZoomIn: () => void;
  onZoomOut: () => void;
  onResetNorth?: () => void;
  onFitBounds?: () => void;
}

export function MapControls({ onZoomIn, onZoomOut, onResetNorth, onFitBounds }: MapControlsProps) {
  return (
    <div className="absolute bottom-3 right-3 z-10 flex flex-col gap-1">
      <ControlButton onClick={onZoomIn} ariaLabel="Zoom in">
        <Plus className="size-4" />
      </ControlButton>
      <ControlButton onClick={onZoomOut} ariaLabel="Zoom out">
        <Minus className="size-4" />
      </ControlButton>
      {onResetNorth && (
        <ControlButton onClick={onResetNorth} ariaLabel="Reset bearing to north">
          <Compass className="size-4" />
        </ControlButton>
      )}
      {onFitBounds && (
        <ControlButton onClick={onFitBounds} ariaLabel="Fit to region">
          <Maximize className="size-4" />
        </ControlButton>
      )}
    </div>
  );
}

interface ControlButtonProps {
  onClick: () => void;
  ariaLabel: string;
  children: React.ReactNode;
}

function ControlButton({ onClick, ariaLabel, children }: ControlButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel}
      className="size-8 grid place-items-center rounded bg-white/80 backdrop-blur border border-slate-200 text-slate-700 hover:bg-white hover:text-slate-900 focus:outline-none focus:ring-1 focus:ring-slate-900"
    >
      {children}
    </button>
  );
}
