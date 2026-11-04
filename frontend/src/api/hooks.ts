import { useQuery } from '@tanstack/react-query'
import { ApiError, api } from './client'

export type Role = 'admin' | 'caregiver' | 'viewer'
export type Me = {
  user: { id: string; email: string; name: string }
  family_id: string
  kid_id: string
  role: Role
}

/** Resolves to the signed-in member, or null when signed out. */
export function useMe() {
  return useQuery({
    queryKey: ['me'],
    queryFn: async () => {
      try {
        return await api<Me>('/api/me')
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) return null
        throw e
      }
    },
    staleTime: 60_000,
  })
}

export type FeedType = 'breast_left' | 'breast_right' | 'breast_both' | 'expressed' | 'formula'
export type DiaperKind = 'wet' | 'dirty' | 'both'
export type Feed = {
  id: string
  type: FeedType
  started_at: string
  duration_min: number | null
  quantity_ml: number | null
  note: string
  fed_by_name: string
}
export type Diaper = { id: string; kind: DiaperKind; at: string; changed_by_name: string }
export type Summary = {
  last_feed: Feed | null
  next_feed_due_at: string | null
  last_diaper: Diaper | null
  feeds_today: number
  diapers_today: Record<DiaperKind, number>
}

export function useSummary() {
  return useQuery({
    queryKey: ['summary'],
    queryFn: () => api<Summary>('/api/summary'),
    refetchInterval: 30_000,
  })
}
