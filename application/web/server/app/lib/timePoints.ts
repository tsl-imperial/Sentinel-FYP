/**
 * 24 quarter buckets from 2020 Q1 through 2025 Q4. Same shape as the
 * vanilla JS app's TIME_POINTS array (app.js:355-361). Used by the time
 * slider to map a 0-23 index to a {year, quarter, label} record.
 */
export type TimePoint = {
  year: number;
  quarter: 'Jan–Mar' | 'Apr–Jun' | 'Jul–Sep' | 'Oct–Dec';
  label: string;
};

export const TIME_POINTS: ReadonlyArray<TimePoint> = (() => {
  const out: TimePoint[] = [];
  const quarters: Array<{ name: TimePoint['quarter']; q: string }> = [
    { name: 'Jan–Mar', q: 'Q1' },
    { name: 'Apr–Jun', q: 'Q2' },
    { name: 'Jul–Sep', q: 'Q3' },
    { name: 'Oct–Dec', q: 'Q4' },
  ];
  for (let y = 2020; y <= 2025; y += 1) {
    for (const { name, q } of quarters) {
      out.push({ year: y, quarter: name, label: `${y} ${q} (${name})` });
    }
  }
  return out;
})();

export function timePointAt(idx: number): TimePoint {
  const clamped = Math.max(0, Math.min(TIME_POINTS.length - 1, idx));
  return TIME_POINTS[clamped]!;
}
