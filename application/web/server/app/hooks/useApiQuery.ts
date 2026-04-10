'use client';

import { useQuery, type UseQueryOptions } from '@tanstack/react-query';
import type { ZodType } from 'zod';
import { apiFetch } from '@/lib/api';

/**
 * Tiny factory for the read-only TanStack Query hooks against /api/*.
 *
 * Every read endpoint is the same shape: GET, validate response with a Zod
 * schema, key by query name + arg. Without this factory we'd have one
 * hand-rolled hook per endpoint and they'd silently drift on staleTime / retry
 * configuration (review caught a real drift between useRegions and the others).
 */
export function useApiQuery<T, TArg = void>(
  name: string,
  arg: TArg,
  buildPath: (arg: TArg) => string,
  schema: ZodType<T>,
  options: Omit<UseQueryOptions<T, Error>, 'queryKey' | 'queryFn'> = {},
) {
  return useQuery<T, Error>({
    queryKey: [name, arg],
    queryFn: () => apiFetch(buildPath(arg), schema),
    ...options,
  });
}
