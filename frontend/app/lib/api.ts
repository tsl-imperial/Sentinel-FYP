import type { ZodType } from 'zod';

/**
 * Network Inspector — typed fetch wrapper.
 *
 * Every call to /api/* goes through this function. Responses are validated
 * with Zod schemas at the boundary so type drift between Flask and the
 * frontend is caught the moment a request lands instead of crashing somewhere
 * deeper in the component tree.
 */
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export async function apiFetch<T>(
  url: string,
  schema: ZodType<T>,
  init?: RequestInit,
): Promise<T> {
  const res = await fetch(url, init);
  let json: unknown;
  try {
    json = await res.json();
  } catch {
    json = {};
  }
  if (!res.ok) {
    const errMsg =
      typeof json === 'object' && json !== null && 'error' in json && typeof (json as { error: unknown }).error === 'string'
        ? (json as { error: string }).error
        : `Request failed (${res.status})`;
    throw new ApiError(res.status, errMsg);
  }
  return schema.parse(json);
}
