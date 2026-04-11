'use client';

import { useApiQuery } from './useApiQuery';
import { regionsDetailsSchema, type RegionsDetails } from '@/lib/schemas/regionsDetails';

export function useRegionsDetails() {
  // Region summaries are static for the data we have on disk; computed once
  // on the backend then cached for the session. Never auto-refetch.
  return useApiQuery<RegionsDetails>(
    'regions_details',
    undefined,
    () => '/api/regions/details',
    regionsDetailsSchema,
    { staleTime: Infinity },
  );
}
