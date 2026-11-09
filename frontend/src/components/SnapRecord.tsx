import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ApiError } from '../api/client'
import { useScan, useUploadFile, type ScanDraft } from '../api/scan'
import { downscale } from '../lib/image'
import PhotoPicker from './PhotoPicker'
import ScanNotice from './ScanNotice'
import ScanReview from './ScanReview'
import Sheet from './Sheet'
import { Button } from './ui/button'
import { Segmented } from './ui/segmented'

type Stage = 'notice' | 'pick' | 'reading' | 'review' | 'failed' | 'limit'

/** Snap a vitals record: notice, photo, reading, then the draft to correct and save. The photo is kept when a scan fails. */
export default function SnapRecord({ onClose, onManual }: { onClose: () => void; onManual: () => void }) {
  const { t } = useTranslation()
  const [stage, setStage] = useState<Stage>('notice')
  const [mode, setMode] = useState<'one' | 'bulk'>('bulk')
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState('')
  const [fileId, setFileId] = useState<string | null>(null)
  const [draft, setDraft] = useState<ScanDraft | null>(null)
  const upload = useUploadFile()
  const scan = useScan()

  const run = async (f: File, existingId: string | null) => {
    setStage('reading')
    try {
      let id = existingId
      if (!id) {
        id = (await upload.mutateAsync(await downscale(f))).id
        setFileId(id)
      }
      const r = await scan.mutateAsync({ kind: 'vitals', file_id: id })
      setDraft(r.draft)
      setStage('review')
    } catch (e) {
      setStage(e instanceof ApiError && e.status === 429 ? 'limit' : 'failed')
    }
  }

  const pick = (f: File) => {
    setFile(f)
    setFileId(null)
    try {
      setPreview(typeof URL.createObjectURL === 'function' ? URL.createObjectURL(f) : '')
    } catch {
      setPreview('')
    }
    void run(f, null)
  }

  const photo = file && (
    <img src={preview || undefined} alt={t('scan.photoAlt')} className="mx-auto max-h-48 rounded-card bg-surface-2 object-contain" />
  )

  return (
    <Sheet variant="full" title={t('scan.title')} onClose={onClose}>
      {stage === 'notice' && <ScanNotice onContinue={() => setStage('pick')} />}
      {stage === 'pick' && (
        <div className="space-y-4">
          <Segmented
            label={t('scan.mode')}
            value={mode}
            onChange={setMode}
            options={[
              { value: 'one', label: t('scan.oneReading') },
              { value: 'bulk', label: t('scan.bulkHistory') },
            ]}
          />
          <PhotoPicker onPick={pick} />
        </div>
      )}
      {stage === 'reading' && (
        <div className="space-y-4">
          {photo}
          <p role="status" className="text-center font-bold text-muted">
            {t('scan.reading')}
          </p>
        </div>
      )}
      {(stage === 'failed' || stage === 'limit') && (
        <div className="space-y-4">
          {photo}
          <p role="alert" className="text-center font-bold text-danger">
            {stage === 'limit' ? t('scan.limit') : t('scan.failed')}
          </p>
          <div className="flex gap-3">
            {stage === 'failed' && file && (
              <Button className="flex-1" onClick={() => void run(file, fileId)}>
                {t('scan.retry')}
              </Button>
            )}
            <Button variant="outline" className="flex-1" onClick={onManual}>
              {t('scan.enterByHand')}
            </Button>
          </div>
        </div>
      )}
      {stage === 'review' && draft && (
        <ScanReview draft={draft} photoUrl={preview} photoAlt={t('scan.photoAlt')} onDone={onClose} />
      )}
    </Sheet>
  )
}
