'use client';

import { useRegions } from '@/hooks/useRegions';

export function RegionPicker({
  value,
  onChange,
  disabled,
}: {
  value: string;
  onChange: (region: string) => void;
  disabled?: boolean;
}) {
  const { data, isLoading, error } = useRegions();

  if (isLoading) {
    return (
      <select
        disabled
        className="w-full px-3 py-2 border border-slate-300 rounded text-sm bg-white text-slate-400"
      >
        <option>Loading regions…</option>
      </select>
    );
  }

  if (error) {
    return (
      <div className="w-full px-3 py-2 border border-red-300 rounded text-xs bg-red-50 text-red-700">
        Failed to load regions: {error.message}
      </div>
    );
  }

  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      className="w-full px-3 py-2 border border-slate-300 rounded text-sm bg-white focus:outline-none focus:ring-1 focus:ring-slate-900 focus:border-slate-900"
    >
      {data?.map((r) => (
        <option key={r} value={r}>
          {r}
        </option>
      ))}
    </select>
  );
}
