'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { Toaster } from 'sonner';

export function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // Region-scoped data is cheap to recompute and rarely changes mid-session.
            // 5 minutes prevents refetch on every component remount.
            staleTime: 5 * 60_000,
            retry: 1,
          },
        },
      }),
  );
  return (
    <QueryClientProvider client={client}>
      {children}
      {/* Global toaster for transient notifications. Bottom-right placement
          keeps it out of the way of the map's polygon-draw area and the
          breadcrumb header. richColors gives error toasts a red surface
          that's visible against the slate map. */}
      <Toaster position="bottom-right" richColors closeButton />
    </QueryClientProvider>
  );
}
