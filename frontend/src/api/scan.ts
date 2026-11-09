import { useMutation, useQuery } from '@tanstack/react-query'
import type { MeasurementKey } from '../lib/vitals'
import { api } from './client'

export type ScanStatus = { enabled: boolean; remaining_today: number }

/**
 * Whether photo scanning is available. Any error (an older server answers 404) means "not available": the
 * feature stays hidden and nothing is shown to the user.
 */
export function useScanStatus() {
  return useQuery({
    queryKey: ['scan-status'],
    queryFn: async (): Promise<ScanStatus> => {
      try {
        return await api<ScanStatus>('/api/scans/status')
      } catch {
        return { enabled: false, remaining_today: 0 }
      }
    },
    retry: false,
    staleTime: 5 * 60_000,
  })
}

export type StoredFile = { id: string; url: string; thumb_url: string | null; content_type: string }

export function useUploadFile() {
  return useMutation({
    mutationFn: (file: Blob) => {
      const form = new FormData()
      form.append('file', file, file instanceof File ? file.name : 'photo.jpg')
      return api<StoredFile>('/api/files', { method: 'POST', body: form })
    },
  })
}

export type DraftRow = {
  measured_at: string | null
  values: Partial<Record<MeasurementKey, number | null>>
  /** values the model was not sure about; shown with a "Check" badge */
  unsure: MeasurementKey[]
}
export type ScanDraft = { rows: DraftRow[]; warnings: string[] }

export function useScan() {
  return useMutation({
    mutationFn: (b: { kind: 'vitals'; file_id: string }) => api<{ scan_id: string; draft: ScanDraft }>('/api/scans', { json: b }),
  })
}
