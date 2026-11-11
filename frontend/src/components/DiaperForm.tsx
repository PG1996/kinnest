import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { useMe, useSummary, type Diaper, type DiaperKind } from '../api/hooks'
import { useEndSleep, useLogDiaper, useUpdateDiaper } from '../hooks/log'
import { toLocalInput } from '../lib/time'
import PersonPicker from './PersonPicker'
import Sheet from './Sheet'
import { Button } from './ui/button'
import { Chip, ChipGroup } from './ui/chip'
import { DateTimeField } from './ui/datetime'
import { Input } from './ui/field'
import WokeUp from './WokeUp'

const KINDS: DiaperKind[] = ['wet', 'dirty', 'both']

/**
 * Add a past diaper, or edit one. Editing sends only the fields that changed. A new diaper during the running sleep can
 * end that sleep at its time ("Woke up").
 */
export default function DiaperForm({ diaper, onClose }: { diaper?: Diaper; onClose: () => void }) {
  const { t } = useTranslation()
  const add = useLogDiaper()
  const update = useUpdateDiaper()
  // the time input shows minutes only: an untouched one keeps the exact stored time
  const [initialWhen] = useState(() => toLocalInput(new Date(diaper?.at ?? Date.now())))
  const [when, setWhen] = useState(initialWhen)
  const [kind, setKind] = useState<DiaperKind>(diaper?.kind ?? 'wet')
  const [note, setNote] = useState(diaper?.note ?? '')
  const [by, setBy] = useState<string | null>(null)
  const me = useMe().data
  const [error, setError] = useState('')
  const endSleep = useEndSleep()
  const asleep = useSummary().data?.sleep?.open ?? null
  const [woke, setWoke] = useState(false)
  const picked = new Date(when).getTime()
  const canWake = !diaper && asleep !== null && picked >= new Date(asleep.started_at).getTime()

  const submit = (e: FormEvent) => {
    e.preventDefault()
    const whenChanged = !diaper || when !== initialWhen
    const at = whenChanged ? new Date(when) : new Date(diaper!.at)
    if (Number.isNaN(at.getTime()) || at.getTime() > Date.now() + 2 * 60_000) return setError(t('diapers.form.future'))
    setError('')
    const done = { onSuccess: onClose, onError: () => setError(t('diapers.saveError')) }
    if (diaper) {
      const changes = {
        ...(kind !== diaper.kind ? { kind } : {}),
        ...(whenChanged ? { at: at.toISOString() } : {}),
        ...(note !== (diaper.note ?? '') ? { note } : {}),
        ...(by && by !== diaper.changed_by_user_id ? { changed_by_user_id: by } : {}),
      }
      if (Object.keys(changes).length === 0) return onClose()
      update.mutate({ id: diaper.id, ...changes }, done)
    } else {
      const body = { id: crypto.randomUUID(), kind, at: at.toISOString(), ...(note ? { note } : {}), ...(by && by !== me?.user.id ? { changed_by_user_id: by } : {}) }
      add.mutate(body, {
        ...done,
        // the diaper is saved; a sleep that will not end (already ended on another phone) need not hold the form open
        onSuccess: () => (woke && canWake ? endSleep.mutate({ id: asleep.id, ended_at: body.at }, { onSettled: onClose }) : onClose()),
      })
    }
  }

  return (
    <Sheet tone="diaper" title={t(diaper ? 'diapers.editTitle' : 'diapers.addTitle')} onClose={onClose}>
      <form onSubmit={submit} noValidate className="space-y-4">
        <ChipGroup label={t('diapers.form.kind')}>
          {KINDS.map((k) => (
            <Chip key={k} pressed={kind === k} onClick={() => setKind(k)}>
              {t(`diaperKinds.${k}`)}
            </Chip>
          ))}
        </ChipGroup>
        <PersonPicker label={t('diapers.changedBy')} value={by ?? diaper?.changed_by_user_id ?? null} onChange={setBy} />
        <div className="space-y-1">
          <label htmlFor="diaper-when" className="block text-[13px] font-semibold text-muted">
            {t('diapers.form.when')}
          </label>
          <DateTimeField id="diaper-when" label={t('diapers.form.when')} value={when} onChange={setWhen} />
        </div>
        {canWake && <WokeUp checked={woke} onChange={setWoke} />}
        <div className="space-y-1">
          <label htmlFor="diaper-note" className="block text-[13px] font-semibold text-muted">
            {t('diapers.form.note')}
          </label>
          <Input id="diaper-note" value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
        {error && <p className="text-sm text-danger">{error}</p>}
        <Button type="submit" size="lg" className="w-full" disabled={add.isPending || update.isPending || endSleep.isPending}>
          {t('diapers.form.save')}
        </Button>
      </form>
    </Sheet>
  )
}
