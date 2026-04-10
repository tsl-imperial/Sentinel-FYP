'use client';

import { TIME_POINTS, timePointAt } from '@/lib/timePoints';

export function TimeSlider({
  index,
  onChange,
}: {
  index: number;
  onChange: (idx: number) => void;
}) {
  const point = timePointAt(index);
  return (
    <>
      <div className="mb-1">
        <input
          type="range"
          min={0}
          max={TIME_POINTS.length - 1}
          value={index}
          onChange={(e) => onChange(Number(e.target.value))}
          className="w-full accent-slate-900"
        />
      </div>
      <div className="flex justify-between text-[11px] text-slate-500">
        <span>{TIME_POINTS[0]!.year} Q1</span>
        <span className="font-medium text-slate-900">{point.label}</span>
        <span>{TIME_POINTS[TIME_POINTS.length - 1]!.year} Q4</span>
      </div>
    </>
  );
}
