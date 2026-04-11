'use client';

import { useApiQuery } from './useApiQuery';
import { boundaryLayerSchema, type BoundaryLayer } from '@/lib/schemas/boundaryLayer';

export function useBoundaryLayer(region: string | null) {
  return useApiQuery<BoundaryLayer, string | null>(
    'boundary_layer',
    region,
    (r) => `/api/boundary_layer?region=${encodeURIComponent(r!)}`,
    boundaryLayerSchema,
    { enabled: !!region },
  );
}
