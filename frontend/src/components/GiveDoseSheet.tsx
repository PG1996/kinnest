import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { formatDose } from '../lib/units'
import Sheet from './Sheet'
import { Button } from './ui/button'
import { Input } from './ui/field'

type Props = { unit: string; max: number; initial: number; onGive: (amount: number) => void; onCancel: () => void }

/** Asks how much of a dose to give now. Never more than `max` (what is left), at most 2 decimals. */
export default function GiveDoseSheet({ unit, max, initial, onGive, onCancel }: Props) {
  const { t } = useTranslation()
  const [value, setValue] = useState(String(initial))
  const [invalid, setInvalid] = useState(false)

  const submit = (e: FormEvent) => {
    e.preventDefault()
    const amount = Number(value)
    if (!/^\d+(\.\d{1,2})?$/.test(value) || !(amount > 0) || amount > max + 1e-9) {
      setInvalid(true)
      return
    }
    onGive(amount)
  }

  return (
    <Sheet title={t('medicines.partialTitle')} onClose={onCancel}>
      <form onSubmit={submit} className="space-y-3">
        <label htmlFor="give-amount" className="block text-sm text-muted">
          {t('medicines.amountLabel')}
        </label>
        <Input id="give-amount" type="number" inputMode="decimal" step="0.01" min="0" value={value} onChange={(e) => setValue(e.target.value)} />
        <p className="text-sm text-muted">{formatDose(max, unit, t)}</p>
        {invalid && <p className="text-sm text-danger">{t('medicines.amountInvalid')}</p>}
        <Button type="submit" className="w-full">
          {t('medicines.giveAmount')}
        </Button>
      </form>
    </Sheet>
  )
}
