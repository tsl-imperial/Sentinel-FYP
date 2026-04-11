'use client';

import { Map as MapIcon, Calendar, Cloud as CloudIcon, FileText, Play, RotateCcw, Square } from 'lucide-react';

import { AppSidebar } from '@/components/ui/AppSidebar';
import { SidebarSection } from '@/components/ui/SidebarSection';
import { SidebarEntry } from '@/components/ui/SidebarEntry';
import { RegionPicker } from '@/components/RegionPicker';
import { TimeSlider } from '@/components/TimeSlider';
import type { LayerCatalog } from '@/lib/layers/catalog';

/**
 * WorkbenchSidebar — presentational sidebar for the workbench shell.
 *
 * Pure presentational component (eng-review Section 2, Issue 8). Owns no
 * state. The parent (`workbench/page.tsx`) passes the callbacks and current
 * values; this component just renders.
 *
 * Sections, top to bottom:
 *   - Breadcrumb header (Workbench / region)
 *   - Layers (LayerCatalog dispatch — day 1: Road classes from palette)
 *   - Tools (region picker, time slider, cloud threshold, filename)
 *   - Sticky bottom action area (Run extraction / Cancel + Clear)
 */
export interface WorkbenchSidebarProps {
  region: string;
  catalog: LayerCatalog;
  enabledClasses: Record<string, boolean>;
  onToggleClass: (cls: string, on: boolean) => void;

  timeIdx: number;
  onTimeIdxChange: (next: number) => void;
  cloud: number;
  onCloudChange: (next: number) => void;
  filename: string;
  onFilenameChange: (next: string) => void;
  onRegionChange: (next: string) => void;

  isProcessing: boolean;
  elapsedSeconds: number;
  onRun: () => void;
  onCancel: () => void;
  onClear: () => void;
}

export function WorkbenchSidebar({
  region,
  catalog,
  enabledClasses,
  onToggleClass,
  timeIdx,
  onTimeIdxChange,
  cloud,
  onCloudChange,
  filename,
  onFilenameChange,
  onRegionChange,
  isProcessing,
  elapsedSeconds,
  onRun,
  onCancel,
  onClear,
}: WorkbenchSidebarProps) {
  return (
    <AppSidebar>
      {/* Breadcrumb header */}
      <div className="px-3 py-3 border-b border-slate-200">
        <div className="text-[10px] uppercase tracking-[0.15em] text-slate-500 font-semibold">
          Workbench
        </div>
        <div className="mt-0.5 text-sm font-medium text-slate-900 truncate">{region}</div>
      </div>

      {/* Layers (config-driven via LayerCatalog) */}
      {catalog.sections.map((section) => {
        if (section.kind === 'road-classes') {
          return (
            <SidebarSection key={section.kind} label={section.label}>
              {section.palette.order.map((fclass) => {
                const color = section.palette.colors[fclass] ?? '#94a3b8';
                const active = enabledClasses[fclass] !== false;
                return (
                  <SidebarEntry
                    key={fclass}
                    swatch={color}
                    label={fclass}
                    active={active}
                    role="toggle"
                    onClick={() => onToggleClass(fclass, !active)}
                  />
                );
              })}
            </SidebarSection>
          );
        }
        return null;
      })}

      {/* Tools section — region picker, time slider, cloud, filename */}
      <SidebarSection label="Tools">
        <div className="px-2 py-1.5 space-y-2">
          <div>
            <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-slate-500 mb-1">
              <MapIcon className="size-3" />
              <span>Region</span>
            </div>
            <RegionPicker value={region} onChange={onRegionChange} disabled={isProcessing} />
          </div>
          <div>
            <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-slate-500 mb-1">
              <Calendar className="size-3" />
              <span>Time period</span>
            </div>
            <TimeSlider index={timeIdx} onChange={onTimeIdxChange} />
          </div>
          <div>
            <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-slate-500 mb-1">
              <CloudIcon className="size-3" />
              <span>Cloud {cloud}%</span>
            </div>
            <input
              type="range"
              min={0}
              max={100}
              value={cloud}
              onChange={(e) => onCloudChange(Number(e.target.value))}
              className="w-full accent-slate-900"
              disabled={isProcessing}
              aria-label="Cloud threshold"
            />
          </div>
          <div>
            <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-slate-500 mb-1">
              <FileText className="size-3" />
              <span>Filename</span>
            </div>
            <input
              type="text"
              value={filename}
              onChange={(e) => onFilenameChange(e.target.value)}
              disabled={isProcessing}
              className="w-full px-2 py-1 border border-slate-300 rounded text-xs bg-white text-slate-900 focus:outline-none focus:ring-1 focus:ring-slate-900 focus:border-slate-900"
              aria-label="Output filename"
            />
          </div>
        </div>
      </SidebarSection>

      {/* Sticky bottom action area */}
      <div className="mt-auto border-t border-slate-200 p-2 space-y-1.5">
        {isProcessing ? (
          <button
            type="button"
            onClick={onCancel}
            className="w-full flex items-center justify-center gap-1.5 px-2 py-2 rounded bg-amber-600 hover:bg-amber-700 text-white text-xs font-medium focus:outline-none focus:ring-1 focus:ring-slate-900"
          >
            <Square className="size-3" />
            Cancel ({elapsedSeconds}s)
          </button>
        ) : (
          <button
            type="button"
            onClick={onRun}
            className="w-full flex items-center justify-center gap-1.5 px-2 py-2 rounded bg-slate-900 hover:bg-slate-800 text-white text-xs font-medium focus:outline-none focus:ring-1 focus:ring-slate-900"
          >
            <Play className="size-3" />
            Run extraction
          </button>
        )}
        <button
          type="button"
          onClick={onClear}
          disabled={isProcessing}
          className="w-full flex items-center justify-center gap-1.5 px-2 py-2 rounded border border-slate-300 hover:bg-slate-50 text-slate-700 text-xs font-medium disabled:opacity-50 focus:outline-none focus:ring-1 focus:ring-slate-900"
        >
          <RotateCcw className="size-3" />
          Clear
        </button>
      </div>
    </AppSidebar>
  );
}
