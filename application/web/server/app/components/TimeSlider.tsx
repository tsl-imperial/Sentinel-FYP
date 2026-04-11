'use client';

import { TIME_POINTS, timePointAt, type TimePoint } from '@/lib/timePoints';

/**
 * TimeSlider — quarter-bucket range input for the workbench TimePoint state.
 *
 * Layout: range input on top, then a 3-column row showing start / current / end
 * with the year on top and the short quarter (Q1-Q4) below. The current cell
 * is bold and slate-900 so the user can see at a glance which bucket is
 * selected.
 *
 * Earlier version showed `${year} ${qShort} (${qName})` on a single line which
 * made the middle label ~22 chars wide and pushed the start/end labels off the
 * sidebar. The (qName) suffix is also redundant with the qShort.
 */
const QUARTER_SHORT: Record<TimePoint['quarter'], string> = {
  'Jan–Mar': 'Q1',
  'Apr–Jun': 'Q2',
  'Jul–Sep': 'Q3',
  'Oct–Dec': 'Q4',
};

export function TimeSlider({
  index,
  onChange,
}: {
  index: number;
  onChange: (idx: number) => void;
}) {
  const point = timePointAt(index);
  const first = TIME_POINTS[0]!;
  const last = TIME_POINTS[TIME_POINTS.length - 1]!;

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
          aria-label="Time period"
        />
      </div>
      <div className="grid grid-cols-3 text-[11px] text-slate-500 tabular-nums">
        <div className="text-left">
          <div>{first.year}</div>
          <div className="text-slate-400">{QUARTER_SHORT[first.quarter]}</div>
        </div>
        <div className="text-center font-medium text-slate-900">
          <div>{point.year}</div>
          <div className="text-slate-600">{QUARTER_SHORT[point.quarter]}</div>
        </div>
        <div className="text-right">
          <div>{last.year}</div>
          <div className="text-slate-400">{QUARTER_SHORT[last.quarter]}</div>
        </div>
      </div>
    </>
  );
}
