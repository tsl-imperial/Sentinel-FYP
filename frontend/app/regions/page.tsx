'use client';

import Link from 'next/link';
import { useMemo } from 'react';
import { PageHeader } from '@/components/PageHeader';
import { SummaryStrip } from '@/components/SummaryStrip';
import { StatusCard } from '@/components/StatusCard';
import { useRegionsDetails } from '@/hooks/useRegionsDetails';
import type { ClassPalette, RegionSummary } from '@/lib/schemas/regionsDetails';

function classLabel(cls: string): string {
  return cls.charAt(0).toUpperCase() + cls.slice(1).replace(/_/g, ' ');
}

export default function RegionsPage() {
  const { data, isLoading, error } = useRegionsDetails();

  // Highest-grade classes drawn last so they sit on top in the legend bar.
  // Reverse the backend order which goes residential → primary (cheap → expensive).
  const renderOrder = useMemo(
    () => (data ? [...data.class_palette.order].reverse() : []),
    [data],
  );

  const sortedRegions = useMemo(
    () => (data ? [...data.regions].sort((a, b) => b.road_km - a.road_km) : []),
    [data],
  );

  return (
    <>
      <PageHeader
        title="Regions"
        description="Administrative regions, drivable network coverage, and class composition."
      />

      <main className="mx-auto max-w-[1600px] px-8 py-6 space-y-5 flex-1 w-full">
        {isLoading && (
          <StatusCard kind="loading">
            Computing region summaries… (cold call takes a few seconds; subsequent loads are instant)
          </StatusCard>
        )}

        {error && <StatusCard kind="error">Failed to load regions: {error.message}</StatusCard>}

        {data && (
          <>
            <ToolbarLegend palette={data.class_palette} renderOrder={renderOrder} />
            <SummaryStrip
              items={[
                { label: 'regions', value: data.regions.length },
                {
                  label: 'km of drivable network',
                  value: Math.round(data.regions.reduce((s, r) => s + r.road_km, 0)).toLocaleString(),
                },
                {
                  label: 'edges',
                  value: data.regions.reduce((s, r) => s + r.edge_count, 0).toLocaleString(),
                },
              ]}
            />
            <div className="grid grid-cols-3 gap-4">
              {sortedRegions.map((r) => (
                <RegionCard
                  key={r.name}
                  region={r}
                  palette={data.class_palette}
                  renderOrder={renderOrder}
                />
              ))}
            </div>
          </>
        )}
      </main>
    </>
  );
}

function ToolbarLegend({ palette, renderOrder }: { palette: ClassPalette; renderOrder: string[] }) {
  return (
    <div className="border border-slate-200 rounded-lg bg-white p-4">
      <div className="flex items-center gap-3 flex-wrap text-[11px]">
        <span className="label">Class composition legend</span>
        <span className="text-slate-300">·</span>
        {renderOrder.map((cls) => (
          <span key={cls} className="inline-flex items-center gap-1.5">
            <span className="w-3 h-3" style={{ background: palette.colors[cls] }} />
            <span className="text-slate-700">{classLabel(cls)}</span>
          </span>
        ))}
        <span className="ml-auto text-[10px] text-slate-400">
          Sourced from OSM <code className="bg-slate-100 px-1 py-0.5 rounded">fclass</code> tags
        </span>
      </div>
    </div>
  );
}

function RegionCard({
  region,
  palette,
  renderOrder,
}: {
  region: RegionSummary;
  palette: ClassPalette;
  renderOrder: string[];
}) {
  const totalKm = renderOrder.reduce((s, cls) => s + (region.class_composition[cls] ?? 0), 0);
  const rows = renderOrder
    .map((cls) => {
      const km = region.class_composition[cls] ?? 0;
      return { cls, km, pct: totalKm > 0 ? (km / totalKm) * 100 : 0 };
    })
    .filter((r) => r.km > 0);

  return (
    <Link
      href={`/workbench?region=${encodeURIComponent(region.name)}`}
      className="block bg-white border border-slate-200 rounded-lg p-5 hover:border-slate-400 transition-colors"
    >
      <div className="mb-4">
        <h3 className="font-semibold text-slate-900 tracking-tight">{region.name}</h3>
      </div>

      <div className="grid grid-cols-2 gap-0 border-t border-l border-slate-200 mb-5">
        <div className="border-r border-b border-slate-200 p-3">
          <div className="label">Road km</div>
          <div className="num text-lg font-semibold text-slate-900 mt-0.5">
            {Math.round(region.road_km).toLocaleString()}
          </div>
        </div>
        <div className="border-r border-b border-slate-200 p-3">
          <div className="label">Edges</div>
          <div className="num text-lg font-semibold text-slate-900 mt-0.5">
            {region.edge_count.toLocaleString()}
          </div>
        </div>
      </div>

      <div className="label mb-2">Class composition</div>
      <div className="h-2 w-full overflow-hidden bg-slate-100 flex mb-3 border border-slate-200">
        {rows.map((r) => (
          <div
            key={r.cls}
            className="h-full"
            style={{ width: `${r.pct}%`, background: palette.colors[r.cls] }}
            title={`${classLabel(r.cls)}: ${r.pct.toFixed(1)}% (${r.km.toFixed(0)} km)`}
          />
        ))}
      </div>
      {rows.map((r) => (
        <div key={r.cls} className="flex items-center gap-2 text-[11px] py-0.5">
          <span className="w-2 h-2 flex-shrink-0" style={{ background: palette.colors[r.cls] }} />
          <span className="text-slate-600 flex-1">{classLabel(r.cls)}</span>
          <span className="num text-slate-700 w-8 text-right">{r.pct.toFixed(0)}%</span>
          <span className="num text-slate-400 w-16 text-right">
            {r.km.toLocaleString(undefined, { maximumFractionDigits: 0 })} km
          </span>
        </div>
      ))}
    </Link>
  );
}
