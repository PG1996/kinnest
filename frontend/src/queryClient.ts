import { QueryClient } from '@tanstack/react-query'

/**
 * App-wide query defaults. Mutations use networkMode 'always': by default TanStack Query pauses a mutation while the
 * browser reports offline and never calls its function, so an airplane-mode tap would wait (and be lost if the app is
 * closed) instead of reaching the offline queue.
 */
export const createQueryClient = () =>
  new QueryClient({
    defaultOptions: {
      queries: { retry: 1, refetchOnWindowFocus: true },
      mutations: { networkMode: 'always' },
    },
  })
