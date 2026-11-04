import { useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../api/client'
import type { DiaperKind, FeedType } from '../api/hooks'

export type FeedInput = {
  id: string
  type: FeedType
  started_at: string
  duration_min?: number
  quantity_ml?: number
  note?: string
}
export type DiaperInput = { id: string; kind: DiaperKind; at: string; note?: string }
export type LogResult = { id: string; recent_other: { user_name: string; at: string } | null }

export function useLogFeed() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: FeedInput) => api<LogResult>('/api/feeds', { json: body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['summary'] }),
  })
}

export function useLogDiaper() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (body: DiaperInput) => api<LogResult>('/api/diapers', { json: body }),
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
