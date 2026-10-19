import { QueryClient } from '@tanstack/react-query'
import { ApiError } from '@/api'

const isUnauthorized = (error: unknown): boolean =>
  error instanceof ApiError && error.status === 401

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      refetchOnWindowFocus: false,
      retry: (failureCount, error) => !isUnauthorized(error) && failureCount < 1,
    },
    mutations: { retry: 0 },
  },
})
