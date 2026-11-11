import { queryOptions, useQuery } from '@tanstack/react-query'
import type { TimelineItem, TimelineKind } from '../lib/timeline'
import { ApiError, api } from './client'

/** A feed being timed right now. The server keeps the start (and the stop); each phone works out the elapsed time. */
export type FeedTimerInfo = {
  id: string
  type: FeedType
  started_at: string
  ended_at: string | null
  /** when the current break began, if the feed is paused */
  paused_at?: string | null
  /** seconds of breaks already finished */
  paused_total_s?: number
  started_by_name: string
}

export type Role = 'admin' | 'caregiver' | 'viewer'
export const RELATIONS = ['mom', 'dad', 'grandparent', 'relative', 'nanny', 'other'] as const
export type Relation = (typeof RELATIONS)[number]
export type Me = {
  user: { id: string; email: string; name: string }
  family_id: string
  kid_id: string
  role: Role
  /** how this person is related to the baby */
  relation?: Relation | null
  /** the family has no mom or dad yet: the admin is asked to say who they are */
  needs_parent?: boolean
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
  /** minutes of breaks inside the feed (burping, changing); the duration is the feeding itself */
  break_min?: number
  quantity_ml: number | null
  note: string
  fed_by_user_id?: string
  fed_by_name: string
}
export type Diaper = { id: string; kind: DiaperKind; at: string; changed_by_name: string; changed_by_user_id?: string; note?: string }
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
  /** the reminder for the rest of this dose has gone off and the dose is still open */
  reminder_due?: boolean
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
  /** interval and SOS medicines: at most this many doses a day (per calendar day) */
  max_per_day?: number | null
  /** interval medicines with a maximum: the usual first dose time, "HH:MM" */
  day_start?: string | null
  /** doses given today (midnight to midnight, family timezone); pieces of one dose count once */
  given_today?: number
  /** when that count starts again from zero (the next midnight) */
  day_ends_at?: string
  start_date: string
  end_date: string | null
  notes: string
  /** when it was added; missing from older servers */
  created_at?: string
  /** an admin stopped it early ("End now") */
  ended_at?: string | null
  ended: boolean
  slots: Slot[]
  last_dose: { id: string; status: 'given' | 'skipped'; amount: number | null; given_at: string; by_name: string } | null
}
export type Summary = {
  last_feed: Feed | null
  next_feed_due_at: string | null
  last_diaper: Diaper | null
  feeds_today: number
  feed_timer?: FeedTimerInfo | null
  diapers_today: Record<DiaperKind, number>
  sleep: SummarySleep
  vitals?: {
    latest: Partial<Record<'weight_kg' | 'height_cm' | 'temperature_c' | 'heart_rate' | 'spo2', Vital | null>>
    /** the value of the reading before the latest, per measurement */
    previous?: Partial<Record<'weight_kg' | 'height_cm' | 'temperature_c' | 'heart_rate' | 'spo2', number | null>>
  }
}

export type KidInfo = {
  id: string
  name: string
  birth_date: string | null
  feed_interval_minutes: number
  diaper_alert_minutes: number
}

export function useKid() {
  return useQuery({ queryKey: ['kid'], queryFn: () => api<KidInfo>('/api/kid') })
}

export type MemberRow = { user_id: string | null; email: string; name: string; role: Role; relation?: Relation | null; pending: boolean }

export function useMembers() {
  return useQuery({ queryKey: ['members'], queryFn: () => api<MemberRow[]>('/api/family/members') })
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
  /** the doctor visit this reading was taken at */
  visit_id?: string | null
  /** make a done visit at this reading's place and time, and link it */
  create_visit?: boolean
}
export type Vital = Required<VitalValues> & {
  id: string
  measured_at: string
  visit_id?: string | null
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
  /** the readings taken at this visit */
  vitals?: Vital[]
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

/** Every entry between `from` and `to` (at most 31 days), newest first. Keep `from`/`to` stable between renders. */
export function useTimeline({ from, to, kinds }: { from: Date; to: Date; kinds?: TimelineKind[] }) {
  const params = new URLSearchParams({ from: from.toISOString(), to: to.toISOString() })
  if (kinds?.length) params.set('kinds', kinds.join(','))
  return useQuery({
    queryKey: ['timeline', from.toISOString(), to.toISOString(), kinds?.join(',') ?? ''],
    queryFn: async () => (await api<{ items: TimelineItem[] }>(`/api/timeline?${params}`)).items,
  })
}

export type DoseRow = {
  id: string
  medicine_id: string
  status: 'given' | 'skipped'
  amount: number | null
  scheduled_for: string | null
  given_at: string
  by_user_id: string
  by_name: string
  note: string
}

/** Every recorded dose of one medicine in the last `days` days, newest first. */
export function useDoseHistory(medicineId: string, days = 30) {
  const day = new Date().toDateString() // the window moves once a day, so the query key stays stable between renders
  return useQuery({
    queryKey: ['doses', medicineId, days, day],
    queryFn: () => {
      const from = new Date()
      from.setDate(from.getDate() - days)
      from.setHours(0, 0, 0, 0)
      return api<DoseRow[]>(`/api/medicines/${medicineId}/doses?from=${encodeURIComponent(from.toISOString())}`)
    },
  })
}

/** Sleeps that started between `from` and `to`. Keep `from`/`to` stable between renders. */
export const sleepRangeQuery = (from: Date, to: Date) =>
  queryOptions({
    queryKey: ['sleep', from.toISOString(), to.toISOString()],
    queryFn: () => api<Sleep[]>(`/api/sleep?from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}`),
  })

export function useSleepRange(from: Date, to: Date) {
  return useQuery(sleepRangeQuery(from, to))
}

/** Feeds started between `from` and `to`. Keep `from`/`to` stable between renders. */
export const feedRangeQuery = (from: Date, to: Date) =>
  queryOptions({
    queryKey: ['feeds', from.toISOString(), to.toISOString()],
    queryFn: () => api<Feed[]>(`/api/feeds?from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}`),
  })

export function useFeedRange(from: Date, to: Date) {
  return useQuery(feedRangeQuery(from, to))
}

/** Diapers changed between `from` and `to`. Keep `from`/`to` stable between renders. */
export const diaperRangeQuery = (from: Date, to: Date) =>
  queryOptions({
    queryKey: ['diapers', from.toISOString(), to.toISOString()],
    queryFn: () => api<Diaper[]>(`/api/diapers?from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}`),
  })

export function useDiaperRange(from: Date, to: Date) {
  return useQuery(diaperRangeQuery(from, to))
}
