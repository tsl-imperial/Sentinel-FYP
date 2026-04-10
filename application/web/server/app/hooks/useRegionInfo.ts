'use client';

import { useApiQuery } from './useApiQuery';
import { regionInfoSchema, type RegionInfo } from '@/lib/schemas/regionInfo';

export function useRegionInfo(region: string | null) {
  return useApiQuery<RegionInfo, string | null>(
    'region_info',
    region,
    (r) => `/api/region_info?region=${encodeURIComponent(r!)}`,
    regionInfoSchema,
    { enabled: !!region },
  );
}
