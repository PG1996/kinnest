import { Camera, FileUp } from 'lucide-react'
import { useState, type ChangeEvent } from 'react'
import { useTranslation } from 'react-i18next'

const MAX_BYTES = 10 * 1024 * 1024
const ALLOWED = (type: string) => type.startsWith('image/') || type === 'application/pdf'
const BTN =
  'flex min-h-14 flex-1 cursor-pointer items-center justify-center gap-2 rounded-card border-2 border-dashed border-line bg-surface px-4 text-base font-bold text-ink focus-within:ring-2 focus-within:ring-primary'

/** Take a photo with the camera or choose an image or PDF. Wrong types and files over 10 MB are refused here. */
export default function PhotoPicker({ onPick }: { onPick: (file: File) => void }) {
  const { t } = useTranslation()
  const [error, setError] = useState('')
  const change = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    if (!ALLOWED(file.type) || file.size > MAX_BYTES) return setError(t('scan.badFile'))
    setError('')
    onPick(file)
  }
  return (
    <div className="space-y-2">
      <div className="flex gap-3">
        <label className={BTN}>
          <Camera size={22} aria-hidden="true" />
          {t('scan.takePhoto')}
          <input type="file" accept="image/*" capture="environment" className="sr-only" onChange={change} />
        </label>
        <label className={BTN}>
          <FileUp size={22} aria-hidden="true" />
          {t('scan.chooseFile')}
          <input type="file" accept="image/*,application/pdf" className="sr-only" onChange={change} />
        </label>
      </div>
      {error && <p className="text-sm text-danger">{error}</p>}
    </div>
  )
}
