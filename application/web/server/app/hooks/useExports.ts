'use client';

import { useApiQuery } from './useApiQuery';
import { exportsListSchema, type ExportsList } from '@/lib/schemas/exports';

export function useExports() {
  return useApiQuery<ExportsList>(
    'exports',
    undefined,
    () => '/api/exports',
    exportsListSchema,
    // Default 5min staleTime — exports list refreshes after a successful run.
  );
}
