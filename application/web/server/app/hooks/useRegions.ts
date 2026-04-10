'use client';

import { useApiQuery } from './useApiQuery';
import { regionsSchema, type Regions } from '@/lib/schemas/regions';

export function useRegions() {
  // Region list is effectively static; never refetch on remount.
  return useApiQuery<Regions>(
    'regions',
    undefined,
    () => '/api/regions',
    regionsSchema,
    { staleTime: Infinity },
  );
}
