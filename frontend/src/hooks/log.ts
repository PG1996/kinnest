import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../api/client'
import type { DiaperKind, FeedType } from '../api/hooks'
import { enqueue } from '../offline/queue'

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

/** POST an entry; with no connection (fetch throws TypeError) save it in the offline queue instead. */
async function post(kind: 'feed' | 'diaper', path: string, body: FeedInput | DiaperInput): Promise<LogResult> {
  try {
    return await api<LogResult>(path, { json: body })
  } catch (e) {
    if (!(e instanceof TypeError)) throw e
    await enqueue({ kind, id: body.id, payload: body })
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
