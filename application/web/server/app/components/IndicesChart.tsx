'use client';

import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Title,
  Tooltip,
  Legend,
} from 'chart.js';
import { Bar } from 'react-chartjs-2';

ChartJS.register(CategoryScale, LinearScale, BarElement, Title, Tooltip, Legend);

const INDEX_KEYS = ['NDVI', 'NDMI', 'NDBI', 'NDWI', 'BSI'] as const;
const COLORS = ['#10b981', '#06b6d4', '#f59e0b', '#3b82f6', '#fb923c'];

/**
 * Render the 5 Sentinel-2 indices as a bar chart. Drop-in port of the
 * Chart.js usage in app.js:31-75 — same labels, same colors.
 *
 * Accepts a `stats` record where keys are the index names. Missing or
 * non-finite values render as null bars.
 */
export function IndicesChart({ stats }: { stats: Record<string, number | null> | null | undefined }) {
  const values = INDEX_KEYS.map((k) => {
    const v = stats?.[k];
    return v != null && Number.isFinite(Number(v)) ? Number(v) : null;
  });

  return (
    <div className="h-44">
      <Bar
        data={{
          labels: [...INDEX_KEYS],
          datasets: [
            {
              label: 'Sentinel-2 mean indices',
              data: values,
              backgroundColor: COLORS,
              borderRadius: 4,
            },
          ],
        }}
        options={{
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { display: false } },
          scales: {
            x: {
              ticks: { color: '#475569', font: { size: 10 } },
              grid: { display: false },
            },
            y: {
              ticks: { color: '#475569', font: { size: 10 } },
              grid: { color: 'rgba(148, 163, 184, 0.15)' },
            },
          },
        }}
      />
    </div>
  );
}
