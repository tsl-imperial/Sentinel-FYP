'use client';

import { PageHeader } from '@/components/PageHeader';
import { SummaryStrip } from '@/components/SummaryStrip';
import { StatusCard } from '@/components/StatusCard';
import { useExports } from '@/hooks/useExports';
import { formatBytes, formatDate } from '@/lib/format';
import type { ExportEntry, ExportFileKind } from '@/lib/schemas/exports';

const KIND_META: Record<ExportFileKind, { label: string; badge: string }> = {
  network_pickle: { label: 'Network graph (pickle)', badge: 'PKL' },
  edges_geojson: { label: 'Edges (GeoJSON)', badge: 'GEO' },
  sentinel_stats: { label: 'Sentinel-2 stats (JSON)', badge: 'JSON' },
};

export default function ExportsPage() {
  const { data, isLoading, error } = useExports();

  return (
    <>
      <PageHeader
        title="Exports"
        description="History of past extractions and their output files."
      />

      <main className="mx-auto max-w-[1600px] px-8 py-6 space-y-5 flex-1 w-full">
        {isLoading && <StatusCard kind="loading">Loading exports…</StatusCard>}

        {error && <StatusCard kind="error">Failed to load exports: {error.message}</StatusCard>}

        {data && data.exports.length === 0 && (
          <StatusCard kind="empty">
            No exports yet. Run an extraction from the{' '}
            <a href="/workbench" className="text-slate-700 hover:underline">
              workbench
            </a>{' '}
            and the result files will appear here.
          </StatusCard>
        )}

        {data && data.exports.length > 0 && (
          <>
            <SummaryStrip
              items={[
                { label: 'exports', value: data.exports.length },
                { label: 'files', value: data.exports.reduce((s, e) => s + e.files.length, 0) },
                { label: 'on disk', value: formatBytes(data.exports.reduce((s, e) => s + e.total_bytes, 0)) },
              ]}
            />
            <div className="space-y-3">
              {data.exports.map((entry) => (
                <ExportCard key={entry.prefix} entry={entry} />
              ))}
            </div>
          </>
        )}
      </main>
    </>
  );
}

function ExportCard({ entry }: { entry: ExportEntry }) {
  return (
    <div className="bg-white border border-slate-200 rounded-lg">
      <div className="px-5 py-3 border-b border-slate-200 flex items-baseline justify-between">
        <div className="flex items-baseline gap-3">
          <span className="font-semibold text-slate-900 tracking-tight font-mono text-sm">
            {entry.prefix}
          </span>
          <span className="text-xs text-slate-500">{formatDate(entry.created_at)}</span>
        </div>
        <span className="num text-xs text-slate-500">{formatBytes(entry.total_bytes)}</span>
      </div>
      <ul className="divide-y divide-slate-200">
        {entry.files.map((file) => {
          const meta = KIND_META[file.kind];
          return (
            <li key={file.name} className="px-5 py-3 flex items-center gap-4 text-sm">
              <span className="inline-flex items-center justify-center w-12 h-6 text-[10px] font-semibold tracking-wider text-slate-600 bg-slate-100 border border-slate-200 rounded">
                {meta.badge}
              </span>
              <div className="flex-1 min-w-0">
                <div className="text-slate-900 font-medium truncate">{meta.label}</div>
                <div className="text-xs text-slate-500 font-mono truncate">{file.name}</div>
              </div>
              <span className="num text-xs text-slate-500 w-16 text-right">
                {formatBytes(file.size_bytes)}
              </span>
              <a
                href={file.url}
                download
                className="px-3 py-1.5 rounded border border-slate-300 hover:bg-slate-50 text-slate-700 text-xs font-medium"
              >
                Download
              </a>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
