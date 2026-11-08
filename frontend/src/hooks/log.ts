import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ApiError, api } from '../api/client'
import type { DiaperKind, FeedType, Vaccination, VitalInput, Visit } from '../api/hooks'
import { enqueue, type QueueEntry } from '../offline/queue'

export type FeedInput = {
  id: string
  type: FeedType
  started_at: string
  duration_min?: number
  quantity_ml?: number
  note?: string
}
export type DiaperInput = { id: string; kind: DiaperKind; at: string; note?: string }
export type LogResult = {
  id: string
  recent_other: { user_name: string; at: string } | null
  /** true when there was no connection and the entry was saved on the phone to sync later */
  queued?: boolean
}

/**
 * POST an entry. With no connection (fetch throws TypeError) or a server that is down (any 5xx, including the
 * 502/503/530 a tunnel answers while the Mac is asleep) save it in the offline queue instead. The client id makes the
 * later re-send safe.
 */
async function post<T extends { id: string }>(
  kind: QueueEntry['kind'],
  path: string,
  body: T,
  queueId: string = body.id,
): Promise<LogResult> {
  try {
    return await api<LogResult>(path, { json: body })
  } catch (e) {
    const serverDown = e instanceof ApiError && e.status >= 500
    if (!(e instanceof TypeError) && !serverDown) throw e
    await enqueue({ kind, id: queueId, payload: { ...body } })
    return { id: body.id, recent_other: null, queued: true }
  }
}

export function useLogFeed() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: FeedInput) => post('feed', '/api/feeds', body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['summary'] }),
  })
}

export function useLogDiaper() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: DiaperInput) => post('diaper', '/api/diapers', body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['summary'] }),
  })
}

export function useUndoDiaper() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api(`/api/diapers/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['summary'] }),
  })
}

export type DoseInput = {
  id: string
  medicine_id: string
  status: 'given' | 'skipped'
  /** The slot being ticked (scheduled medicines); absent for as-needed doses. */
  scheduled_for?: string
  /** How much was given (a piece or the whole dose). Not sent for skipped doses or medicines without an amount. */
  amount?: number
  given_at?: string
  note?: string
}
export type DoseResult = LogResult & {
  by_name?: string
  gap_warning?: { last_given_at: string } | null
  /** Where the slot stands after this piece, for scheduled doses. */
  slot?: { status: 'pending' | 'partial' | 'given' | 'skipped'; given_amount: number; remaining: number | null }
}

const refreshMedicines = (qc: ReturnType<typeof useQueryClient>) => {
  qc.invalidateQueries({ queryKey: ['medicines'] })
  qc.invalidateQueries({ queryKey: ['summary'] })
}

export function useGiveDose() {
  const qc = useQueryClient()
  return useMutation({
    // Stamp the time now: a dose queued while offline must keep when it was given, not when it syncs.
    mutationFn: (b: DoseInput) => {
      const body = { ...b, given_at: b.given_at ?? new Date().toISOString() }
      return post('dose', `/api/medicines/${b.medicine_id}/doses`, body) as Promise<DoseResult>
    },
    onSuccess: () => refreshMedicines(qc),
  })
}

export function useUndoDose() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (v: { medicineId: string; doseId: string }) =>
      api(`/api/medicines/${v.medicineId}/doses/${v.doseId}`, { method: 'DELETE' }),
    onSuccess: () => refreshMedicines(qc),
  })
}

export function useStartSleep() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (b: { id: string; started_at: string; note?: string }) => post('sleep_start', '/api/sleep', b),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['summary'] }),
  })
}

export function useEndSleep() {
  const qc = useQueryClient()
  return useMutation({
    // `id` is the session being ended (the queue builds the URL from it); the queue key must differ from the start's
    mutationFn: (b: { id: string; ended_at: string }) => post('sleep_end', `/api/sleep/${b.id}/end`, b, `${b.id}:end`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['summary'] }),
  })
}

export type NudgeInput = { id: string; medicine_id: string; scheduled_for: string; remind_at: string }

/** "Remind me about the rest of this dose": a one-off reminder. Queued offline like other entries. */
export function useCreateNudge() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (b: NudgeInput) => post('nudge', `/api/medicines/${b.medicine_id}/nudges`, b),
    onSuccess: () => refreshMedicines(qc),
  })
}

export function useCancelNudge() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (v: { medicineId: string; nudgeId: string }) =>
      api(`/api/medicines/${v.medicineId}/nudges/${v.nudgeId}`, { method: 'DELETE' }),
    onSuccess: () => refreshMedicines(qc),
  })
}

const refreshVitals = (qc: ReturnType<typeof useQueryClient>) => {
  qc.invalidateQueries({ queryKey: ['vitals'] })
  qc.invalidateQueries({ queryKey: ['growth'] })
  qc.invalidateQueries({ queryKey: ['summary'] })
}

/** Add a vitals entry. Queued offline like feeds (the client id makes a re-send safe). */
export function useCreateVital() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (b: VitalInput) => post('vital', '/api/vitals', b),
    onSuccess: () => refreshVitals(qc),
  })
}

export function useUpdateVital() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...body }: Partial<VitalInput> & { id: string }) => api(`/api/vitals/${id}`, { method: 'PATCH', json: body }),
    onSuccess: () => refreshVitals(qc),
  })
}

export function useDeleteVital() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api(`/api/vitals/${id}`, { method: 'DELETE' }),
    onSuccess: () => refreshVitals(qc),
  })
}

/** A bulk save that the server refused; `rowErrors` maps the row index to its message. */
export class BulkError extends ApiError {
  rowErrors: Record<number, string>
  constructor(e: ApiError) {
    super(e.status, e.message, e.body)
    const rows = (e.body as { errors?: { index: number; detail: string }[] } | undefined)?.errors ?? []
    this.rowErrors = Object.fromEntries(rows.map((r) => [r.index, r.detail]))
  }
}

/** Save many past readings at once (online only: all or nothing). */
export function useBulkVitals() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async (entries: VitalInput[]) => {
      try {
        return await api<{ created: number; existing: number }>('/api/vitals/bulk', { json: { entries } })
      } catch (e) {
        throw e instanceof ApiError ? new BulkError(e) : e
      }
    },
    onSuccess: () => refreshVitals(qc),
  })
}

const refreshVaccines = (qc: ReturnType<typeof useQueryClient>) => qc.invalidateQueries({ queryKey: ['vaccines'] })

export function useApplyTemplate() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (b: { template_id: string; mode: 'fill' | 'add_missing' }) =>
      api<{ created: number }>('/api/vaccines/apply-template', { json: b }),
    onSuccess: () => refreshVaccines(qc),
  })
}

export type VaccineInput = Partial<Omit<Vaccination, 'id' | 'source' | 'overdue' | 'days_until'>>

export function useCreateVaccine() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (b: VaccineInput) => api<Vaccination>('/api/vaccines', { json: b }),
    onSuccess: () => refreshVaccines(qc),
  })
}

export function useUpdateVaccine() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...b }: VaccineInput & { id: string }) => api<Vaccination>(`/api/vaccines/${id}`, { method: 'PATCH', json: b }),
    onSuccess: () => refreshVaccines(qc),
  })
}

export function useDeleteVaccine() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api(`/api/vaccines/${id}`, { method: 'DELETE' }),
    onSuccess: () => refreshVaccines(qc),
  })
}

export type VisitInput = Partial<Omit<Visit, 'id'>>
const refreshVisits = (qc: ReturnType<typeof useQueryClient>) => qc.invalidateQueries({ queryKey: ['visits'] })

export function useCreateVisit() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (b: VisitInput) => api<Visit>('/api/visits', { json: b }),
    onSuccess: () => refreshVisits(qc),
  })
}

export function useUpdateVisit() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...b }: VisitInput & { id: string }) => api<Visit>(`/api/visits/${id}`, { method: 'PATCH', json: b }),
    onSuccess: () => refreshVisits(qc),
  })
}

export function useDeleteVisit() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api(`/api/visits/${id}`, { method: 'DELETE' }),
    onSuccess: () => refreshVisits(qc),
  })
}
