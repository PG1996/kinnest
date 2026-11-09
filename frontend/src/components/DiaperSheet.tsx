import { Droplet, Droplets, Layers } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { DiaperKind } from '../api/hooks'
import Sheet from './Sheet'

const KINDS: { kind: DiaperKind; Icon: typeof Droplet }[] = [
  { kind: 'wet', Icon: Droplet },
  { kind: 'dirty', Icon: Layers },
  { kind: 'both', Icon: Droplets },
]

/** Three big tiles: one tap logs the diaper. */
export default function DiaperSheet({ onPick, onClose }: { onPick: (k: DiaperKind) => void; onClose: () => void }) {
  const { t } = useTranslation()
  return (
    <Sheet title={t('home.diaperTitle')} onClose={onClose}>
      <div className="grid grid-cols-3 gap-3">
        {KINDS.map(({ kind, Icon }) => (
          <button
            key={kind}
            type="button"
            onClick={() => onPick(kind)}
            className="flex min-h-24 flex-col items-center justify-center gap-2 rounded-card bg-diaper-bg text-lg font-extrabold text-diaper-ink transition active:scale-95"
          >
            <Icon size={28} aria-hidden="true" />
            {t(`diaperKinds.${kind}`)}
          </button>
        ))}
      </div>
    </Sheet>
  )
}
