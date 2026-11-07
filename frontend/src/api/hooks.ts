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
export type Sleep = {
  id: string
  started_at: string
  ended_at: string | null
  started_by_name: string
  ended_by_name: string | null
  duration_min: number | null
  note: string
}
export type SummarySleep = { open: Sleep | null; last: Sleep | null }
export type ScheduleKind = 'fixed' | 'interval' | 'as_needed'
export type Slot = {
  due_at: string
  status: 'pending' | 'given' | 'skipped'
  dose_id: string | null
  given_at: string | null
  by_name: string | null
}
export type Medicine = {
  id: string
  name: string
  dose: string
  schedule_kind: ScheduleKind
  times: string[]
  interval_hours: number | null
  first_dose_at: string | null
  min_gap_hours: number | null
  start_date: string
  end_date: string | null
  notes: string
  ended: boolean
  slots: Slot[]
  last_dose: { id: string; status: 'given' | 'skipped'; given_at: string; by_name: string } | null
}
export type Summary = {
  last_feed: Feed | null
  next_feed_due_at: string | null
  last_diaper: Diaper | null
  feeds_today: number
  diapers_today: Record<DiaperKind, number>
  sleep: SummarySleep
}

export function useSummary() {
  return useQuery({
    queryKey: ['summary'],
    queryFn: () => api<Summary>('/api/summary'),
    refetchInterval: 30_000,
  })
}

export function useMedicines(includeEnded = false) {
  return useQuery({
    queryKey: ['medicines', includeEnded],
    queryFn: () => api<Medicine[]>(`/api/medicines${includeEnded ? '?include_ended=true' : ''}`),
    refetchInterval: 30_000,
  })
}
