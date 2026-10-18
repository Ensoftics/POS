import { isApiError } from '@pos/api-client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from 'react-router';
import { router } from './router';

export function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // Retry only failures that may succeed later (offline, 5xx, rate limit).
        retry: (failureCount, error) => isApiError(error) && error.isTransient && failureCount < 2,
        refetchOnWindowFocus: false,
        staleTime: 30_000,
      },
      mutations: { retry: false },
    },
  });
}

const queryClient = createQueryClient();

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
}
