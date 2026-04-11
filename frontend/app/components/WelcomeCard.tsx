'use client';

/**
 * WelcomeCard — first-visit orientation card for the workbench DockedPanel.
 *
 * Anti-slop spec from design review Pass 4: left-aligned, no emoji, no
 * rocket, no "easy", monochrome slate palette, utility-grade copy. Dismiss
 * is a small text link in the panel footer (the parent renders the panel
 * footer slot — this component just renders the body).
 */
interface WelcomeCardProps {
  onDismiss: () => void;
}

export function WelcomeCard({ onDismiss }: WelcomeCardProps) {
  return (
    <div className="p-4">
      <p className="text-xs text-slate-600 leading-relaxed">
        Network Inspector pulls drivable road geometry and Sentinel-2
        indices for any polygon you draw on the map.
      </p>
      <ol className="mt-3 space-y-1.5 text-xs text-slate-700 list-decimal list-inside">
        <li>Pick a region in the sidebar.</li>
        <li>Draw a polygon by clicking on the map. Double-click to close it.</li>
        <li>Click <span className="font-medium text-slate-900">Run extraction</span>.</li>
      </ol>
      <p className="mt-3 text-[11px] text-slate-500">
        Hover any road for at-a-glance reflectance indices. Click any road
        for the full per-year breakdown.
      </p>
      <div className="mt-4">
        <button
          type="button"
          onClick={onDismiss}
          className="text-xs text-slate-500 hover:text-slate-900 underline focus:outline-none focus:ring-1 focus:ring-slate-900 rounded"
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}
