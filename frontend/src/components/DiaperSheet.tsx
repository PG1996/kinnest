import { useTranslation } from 'react-i18next'
import type { DiaperKind } from '../api/hooks'
import Sheet from './Sheet'
import { Button } from './ui/button'

const KINDS: DiaperKind[] = ['wet', 'dirty', 'both']

export default function DiaperSheet({ onPick, onClose }: { onPick: (k: DiaperKind) => void; onClose: () => void }) {
  const { t } = useTranslation()
  return (
    <Sheet title={t('home.diaperTitle')} onClose={onClose}>
      <div className="grid grid-cols-3 gap-3">
        {KINDS.map((k) => (
          <Button key={k} variant="soft" className="min-h-20 text-lg" onClick={() => onPick(k)}>
            {t(`diaperKinds.${k}`)}
          </Button>
        ))}
      </div>
    </Sheet>
  )
}
