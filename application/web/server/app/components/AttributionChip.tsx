/**
 * AttributionChip — static attribution chip bottom-right of the map, above
 * MapControls. Replaces the inline attribution that the default
 * <NavigationControl/> would have rendered (we removed it in favor of the
 * floating MapControls component).
 *
 * Position: `bottom-14 right-3` clears the 4 stacked map control buttons
 * (each `size-8` plus `gap-1` = ~36 + ~32 + ~32 + ~32 = ~132px from the
 * bottom; `bottom-14` = 56px which sits just above the `size-8` controls
 * starting at `bottom-3`).
 */
export function AttributionChip() {
  return (
    <div className="absolute bottom-14 right-3 z-10 bg-white/80 backdrop-blur px-2 py-0.5 rounded text-[9px] text-slate-500 pointer-events-none select-none">
      © OSM · CARTO · Earth Engine
    </div>
  );
}
