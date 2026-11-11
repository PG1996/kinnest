import { Droplet, Droplets, Layers } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useMe, type DiaperKind } from '../api/hooks'
import PersonPicker from './PersonPicker'
import Sheet from './Sheet'
import WokeUp from './WokeUp'

const KINDS: { kind: DiaperKind; Icon: typeof Droplet }[] = [
  { kind: 'wet', Icon: Droplet },
  { kind: 'dirty', Icon: Layers },
  { kind: 'both', Icon: Droplets },
]

/** Who changed it (me unless picked), then three big tiles: one tap logs the diaper. While the baby sleeps, "Woke up" can end the sleep too. */
export default function DiaperSheet({
  asleep = false,
  onPick,
  onClose,
}: {
  asleep?: boolean
  onPick: (k: DiaperKind, changedBy?: string, woke?: boolean) => void
  onClose: () => void
}) {
  const { t } = useTranslation()
  const me = useMe().data
  const [by, setBy] = useState<string | null>(null)
  const [woke, setWoke] = useState(false)
  return (
    <Sheet tone="diaper" title={t('home.diaperTitle')} onClose={onClose}>
      <PersonPicker label={t('diapers.changedBy')} value={by} onChange={setBy} />
      {asleep && <WokeUp checked={woke} onChange={setWoke} />}
      <div className="grid grid-cols-3 gap-3">
        {KINDS.map(({ kind, Icon }) => (
          <button
            key={kind}
            type="button"
            onClick={() => onPick(kind, by && by !== me?.user.id ? by : undefined, asleep && woke)}
            className="flex min-h-24 flex-col items-center justify-center gap-2 rounded-card bg-diaper-bg text-base font-bold text-diaper-ink transition active:scale-95"
          >
            <Icon size={28} aria-hidden="true" />
            {t(`diaperKinds.${kind}`)}
          </button>
        ))}
      </div>
    </Sheet>
  )
}
