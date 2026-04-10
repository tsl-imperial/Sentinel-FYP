'use client';

import { useApiQuery } from './useApiQuery';
import { overviewLayersSchema, type OverviewLayers } from '@/lib/schemas/overviewLayers';

export function useOverviewLayers(region: string | null) {
  return useApiQuery<OverviewLayers, string | null>(
    'overview_layers',
    region,
    (r) => `/api/overview_layers?region=${encodeURIComponent(r!)}`,
    overviewLayersSchema,
    { enabled: !!region },
  );
}
