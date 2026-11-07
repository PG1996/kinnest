import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ApiError, api } from '../api/client'
import type { DiaperKind, FeedType } from '../api/hooks'
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
  given_at?: string
  note?: string
}
export type DoseResult = LogResult & { by_name?: string; gap_warning?: { last_given_at: string } | null }

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
