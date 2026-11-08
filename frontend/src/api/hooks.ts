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
export type SlotDose = { id: string; amount: number | null; status: 'given' | 'skipped'; given_at: string; by_name: string }
export type Slot = {
  due_at: string
  status: 'pending' | 'partial' | 'given' | 'skipped'
  /** Sum of the given pieces. 0 for medicines without a dose amount. */
  given_amount: number
  /** What is left of the dose. null for medicines without a dose amount. */
  remaining: number | null
  doses: SlotDose[]
  /** The latest piece. */
  dose_id: string | null
  given_at: string | null
  by_name: string | null
  nudge: { id: string; remind_at: string } | null
}
export type Medicine = {
  id: string
  name: string
  /** null for medicines saved before structured doses: the admin is asked to set one. */
  dose_amount: number | null
  dose_unit: string | null
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
  last_dose: { id: string; status: 'given' | 'skipped'; amount: number | null; given_at: string; by_name: string } | null
}
export type Summary = {
  last_feed: Feed | null
  next_feed_due_at: string | null
  last_diaper: Diaper | null
  feeds_today: number
  diapers_today: Record<DiaperKind, number>
  sleep: SummarySleep
  vitals?: { latest: Partial<Record<'weight_kg' | 'height_cm' | 'head_cm' | 'temperature_c', Vital | null>> }
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

export type PlaceKind = 'home' | 'hospital' | 'clinic' | 'other'
export type VitalValues = {
  weight_kg?: number | null
  height_cm?: number | null
  head_cm?: number | null
  temperature_c?: number | null
  heart_rate?: number | null
  resp_rate?: number | null
  spo2?: number | null
}
export type VitalInput = VitalValues & {
  id: string
  measured_at: string
  place_kind: PlaceKind
  place_name?: string
  measured_by?: string
  note?: string
}
export type Vital = Required<VitalValues> & {
  id: string
  measured_at: string
  place_kind: PlaceKind
  place_name: string
  measured_by: string
  note: string
  entered_by_name: string
}
export type GrowthKind = 'weight' | 'height' | 'head'
export type GrowthCurves = {
  birth_date: string
  source: { name: string; url: string; retrieved_on: string }
  curves: Record<'3' | '15' | '50' | '85' | '97', [number, number][]>
  points: { id: string; measured_at: string; age_months: number; value: number; percentile: number; place_kind: PlaceKind }[]
}
export type VaccineStatus = 'pending' | 'given' | 'skipped'
export type Vaccination = {
  id: string
  name: string
  dose_label: string
  due_date: string
  given_on: string | null
  status: VaccineStatus
  place: string
  notes: string
  source: 'iap' | 'uip' | 'manual'
  overdue: boolean
  days_until: number
}
export type VaccineTemplate = {
  id: string
  name: string
  description: string
  source_url: string
  source_title: string
  source_date: string
  retrieved_on: string
  count: number
}
export type VisitStatus = 'upcoming' | 'done' | 'cancelled'
export type Visit = {
  id: string
  scheduled_at: string
  doctor: string
  place: string
  reason: string
  status: VisitStatus
  notes: string
  prescription_notes: string
}
export type VitalFilters = { from?: string; to?: string; place_kind?: PlaceKind }

const qs = (params: Record<string, string | undefined>) => {
  const p = new URLSearchParams(Object.entries(params).filter((e): e is [string, string] => !!e[1]))
  return p.size ? `?${p}` : ''
}

export function useVitals(filters: VitalFilters = {}) {
  return useQuery({
    queryKey: ['vitals', filters],
    queryFn: () => api<Vital[]>(`/api/vitals${qs(filters)}`),
  })
}

/** Growth curves and points; `data` is null when the birth date is not set (the server answers 409). */
export function useGrowth(kind: GrowthKind) {
  return useQuery({
    queryKey: ['growth', kind],
    queryFn: async () => {
      try {
        return await api<GrowthCurves>(`/api/vitals/growth/${kind}`)
      } catch (e) {
        if (e instanceof ApiError && e.status === 409) return null
        throw e
      }
    },
  })
}

export function useVaccines() {
  return useQuery({ queryKey: ['vaccines'], queryFn: () => api<Vaccination[]>('/api/vaccines') })
}

export function useVaccineTemplates() {
  return useQuery({
    queryKey: ['vaccine-templates'],
    queryFn: () => api<VaccineTemplate[]>('/api/vaccines/templates'),
    staleTime: Infinity,
  })
}

export function useVisits() {
  return useQuery({ queryKey: ['visits'], queryFn: () => api<Visit[]>('/api/visits') })
}
