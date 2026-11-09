import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useMedicines } from '../api/hooks'
import { useCreateVital } from '../hooks/log'
import type { Medicine } from '../api/hooks'
import { DoseForm } from './DoseHistory'
import DiaperForm from './DiaperForm'
import FeedEditForm from './FeedEditForm'
import Sheet from './Sheet'
import SleepForm from './SleepForm'
import VitalForm from './VitalForm'
import { Button } from './ui/button'

type Kind = 'feed' | 'diaper' | 'sleep' | 'dose' | 'vital'

/** "Add past entry": pick what was missed, then the same form used everywhere else. Doses are the admin's. */
export default function AddPastEntry({ isAdmin, onClose }: { isAdmin: boolean; onClose: () => void }) {
  const { t } = useTranslation()
  const [kind, setKind] = useState<Kind | null>(null)
  const [medicine, setMedicine] = useState<Medicine | null>(null)
  const medicines = useMedicines().data
  const createVital = useCreateVital()
  const kinds: Kind[] = isAdmin ? ['feed', 'diaper', 'sleep', 'dose', 'vital'] : ['feed', 'diaper', 'sleep', 'vital']

  if (kind === 'feed') return <FeedEditForm onClose={onClose} />
  if (kind === 'diaper') return <DiaperForm onClose={onClose} />
  if (kind === 'sleep') return <SleepForm onClose={onClose} />
  if (kind === 'vital')
    return (
      <Sheet variant="full" title={t('vitals.form.title')} onClose={onClose}>
        <VitalForm saving={createVital.isPending} serverError={createVital.error?.message} onSave={(input) => createVital.mutate(input, { onSuccess: onClose })} />
      </Sheet>
    )
  if (kind === 'dose' && medicine) return <DoseForm medicine={medicine} onClose={onClose} />
  return (
    <Sheet title={kind === 'dose' ? t('timeline.pickMedicine') : t('timeline.addPast')} onClose={onClose}>
      <div className="grid grid-cols-2 gap-2">
        {kind === 'dose'
          ? (Array.isArray(medicines) ? medicines : []).map((m) => (
              <Button key={m.id} variant="soft" onClick={() => setMedicine(m)}>
                {m.name}
              </Button>
            ))
          : kinds.map((k) => (
              <Button key={k} variant="soft" onClick={() => setKind(k)}>
                {t(`timeline.addKind.${k}`)}
              </Button>
            ))}
      </div>
    </Sheet>
  )
}
