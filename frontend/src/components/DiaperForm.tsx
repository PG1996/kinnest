import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { useMe, type Diaper, type DiaperKind } from '../api/hooks'
import { useLogDiaper, useUpdateDiaper } from '../hooks/log'
import { toLocalInput } from '../lib/time'
import PersonPicker from './PersonPicker'
import Sheet from './Sheet'
import { Button } from './ui/button'
import { Chip, ChipGroup } from './ui/chip'
import { Input } from './ui/field'

const KINDS: DiaperKind[] = ['wet', 'dirty', 'both']

/** Add a past diaper, or edit one. Editing sends only the fields that changed. */
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
      add.mutate({ id: crypto.randomUUID(), kind, at: at.toISOString(), ...(note ? { note } : {}), ...(by && by !== me?.user.id ? { changed_by_user_id: by } : {}) }, done)
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
          <Input id="diaper-when" type="datetime-local" value={when} max={toLocalInput(new Date())} onChange={(e) => setWhen(e.target.value)} />
        </div>
        <div className="space-y-1">
          <label htmlFor="diaper-note" className="block text-[13px] font-semibold text-muted">
            {t('diapers.form.note')}
          </label>
          <Input id="diaper-note" value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
        {error && <p className="text-sm text-danger">{error}</p>}
        <Button type="submit" size="lg" className="w-full" disabled={add.isPending || update.isPending}>
          {t('diapers.form.save')}
        </Button>
      </form>
    </Sheet>
  )
}
