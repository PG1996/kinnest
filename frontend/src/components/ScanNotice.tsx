import { ShieldCheck } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from './ui/button'
import { Card } from './ui/card'

/** Said before every scan: the photo leaves the family's server. Nothing is sent until the parent taps Continue. */
export default function ScanNotice({ onContinue }: { onContinue: () => void }) {
  const { t } = useTranslation()
  return (
    <div className="space-y-4">
      <Card tone="warn" className="flex gap-3">
        <ShieldCheck size={26} aria-hidden="true" className="mt-0.5 shrink-0 text-warn-ink" />
        <p className="font-bold">{t('scan.notice')}</p>
      </Card>
      <Button size="lg" className="w-full" onClick={onContinue}>
        {t('scan.continue')}
      </Button>
    </div>
  )
}
