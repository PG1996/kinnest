import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Medicine, Slot } from '../api/hooks'
import { formatClock, toLocalInput } from '../lib/time'
import { formatDose } from '../lib/units'
import NudgeOffset, { NUDGE_PRESETS, useNudgeLabel } from './NudgeOffset'
import Sheet from './Sheet'
import { Button } from './ui/button'
import { Card, Eyebrow } from './ui/card'
import { Chip } from './ui/chip'
import { Input } from './ui/field'
import { Segmented } from './ui/segmented'
import { SlideToConfirm } from './ui/slide-confirm'
import { Stepper } from './ui/stepper'

const round2 = (n: number) => Math.round(n * 100) / 100

/** How far one tap moves the amount: whole drops and puffs, quarters of everything else (whole units for big amounts). */
const stepFor = (unit: string, max: number) => (max >= 20 || unit === 'drops' || unit === 'puff' ? 1 : 0.25)

type Props = {
  medicine: Medicine
  slot?: Slot
  /** the most that may still be given (what is left of the slot, or one dose for an as-needed medicine) */
  max: number
  /** `givenAt` is an ISO time, or null for "now" (stamped when the dose is saved) */
  onGive: (amount: number, nudgeMinutes: number | null, givenAt: string | null) => void
  onSkip?: () => void
  onCancel: () => void
  initialMode?: 'full' | 'partial'
  /** open with "Other time" already chosen */
  askTime?: boolean
}

/** The "Give a dose" screen: how much (full or a part), an optional reminder for the rest, then slide to give. */
export default function GiveDoseSheet({ medicine, slot, max, onGive, onSkip, onCancel, initialMode = 'partial', askTime = false }: Props) {
  const { t } = useTranslation()
  const unit = medicine.dose_unit ?? ''
  const fmt = (n: number) => formatDose(n, unit, t)
  const step = stepFor(unit, max)
  const [mode, setMode] = useState<'full' | 'partial'>(initialMode)
  const [amount, setAmount] = useState(Math.min(max, round2(max / 2)))
  const [nudge, setNudge] = useState<number | null>(null)
  const [otherNudge, setOtherNudge] = useState(false)
  const nudgeLabel = useNudgeLabel()
  const [other, setOther] = useState(askTime)
  const [whenValue, setWhenValue] = useState(() => toLocalInput(new Date()))
  const [timeError, setTimeError] = useState('')
  const total = medicine.dose_amount ?? max
  const shown = mode === 'full' ? max : amount
  const pieces = slot?.doses ?? []

  const give = () => {
    if (!other) return onGive(shown, mode === 'partial' ? nudge : null, null)
    const at = new Date(whenValue)
    if (Number.isNaN(at.getTime()) || at.getTime() > Date.now() + 2 * 60_000) return setTimeError(t('medicines.timeFuture'))
    setTimeError('')
    onGive(shown, mode === 'partial' ? nudge : null, at.toISOString())
  }

  return (
    <Sheet
      variant="full"
      title={t('medicines.giveTitle')}
      onClose={onCancel}
      footer={
        <div className="grid grid-cols-[1fr_2fr] gap-3">
          {onSkip ? (
            <Button variant="outline" size="lg" onClick={onSkip}>
              {t('medicines.skip')}
            </Button>
          ) : (
            <Button variant="outline" size="lg" onClick={onCancel}>
              {t('medicines.cancel')}
            </Button>
          )}
          <SlideToConfirm label={t('medicines.slideToGive', { amount: fmt(shown) })} armedLabel={t('medicines.tapAgain', { amount: fmt(shown) })} onConfirm={give} />
        </div>
      }
    >
      <Card tone="med" className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <p className="text-lg font-bold">{medicine.name}</p>
          {slot && (
            <span className="rounded-full bg-surface px-2.5 py-1 text-xs font-bold text-med-ink">
              {t('medicines.slotAt', { time: formatClock(slot.due_at) })}
              {new Date(slot.due_at).toDateString() !== new Date().toDateString() ? ` (${t('medicines.yesterday')})` : ''}
            </span>
          )}
        </div>
        <Eyebrow tone="med">{medicine.dose_amount != null ? fmt(total) : ''}</Eyebrow>
        {slot && slot.status === 'partial' && (
          <>
            <p className="text-sm font-bold">
              {t('medicines.progress', { given: fmt(slot.given_amount), total: fmt(total), left: fmt(slot.remaining ?? 0) })}
            </p>
            <div className="h-2.5 overflow-hidden rounded-full bg-med/20">
              <div className="h-2.5 rounded-full bg-med" style={{ width: `${Math.min(100, (slot.given_amount / total) * 100)}%` }} />
            </div>
          </>
        )}
        {pieces.length > 0 && (
          <ul className="space-y-0.5 text-sm text-muted">
            {pieces.map((d) => (
              <li key={d.id}>
                {d.status === 'given'
                  ? t('medicines.pieceBy', { name: d.by_name, amount: fmt(d.amount ?? total), time: formatClock(d.given_at) })
                  : t('medicines.skippedBy', { name: d.by_name, time: formatClock(d.given_at) })}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Segmented
        label={t('medicines.howMuch')}
        value={mode}
        onChange={setMode}
        options={[
          { value: 'full', label: t('medicines.fullLeft', { left: fmt(max) }) },
          { value: 'partial', label: t('medicines.partial') },
        ]}
      />

      <Card className="space-y-3">
        <p className="text-[13px] font-semibold text-muted">{t('medicines.when')}</p>
        <div className="flex flex-wrap gap-2">
          <Chip
            pressed={!other}
            onClick={() => {
              setOther(false)
              setTimeError('')
            }}
          >
            {t('medicines.whenNow')}
          </Chip>
          <Chip pressed={other} onClick={() => setOther(true)}>
            {t('medicines.whenOther')}
          </Chip>
        </div>
        {other && (
          <div className="space-y-1">
            <label htmlFor="dose-when" className="block text-[13px] font-semibold text-muted">
              {t('medicines.whenLabel')}
            </label>
            <Input id="dose-when" type="datetime-local" value={whenValue} max={toLocalInput(new Date())} onChange={(e) => setWhenValue(e.target.value)} />
            {timeError && <p className="text-sm text-danger">{timeError}</p>}
          </div>
        )}
      </Card>

      {mode === 'partial' && (
        <Card className="space-y-4">
          <Stepper
            label={t('medicines.amountLabel')}
            unit={unit}
            value={amount}
            step={step}
            min={Math.min(step, max)}
            max={max}
            onChange={setAmount}
          />
          <p className="text-center text-sm text-muted">{t('medicines.upTo', { left: fmt(max) })}</p>
          {slot && (
            <div className="space-y-2">
              <p className="text-[13px] font-semibold text-muted">{t('medicines.remindIn')}</p>
              <div className="flex flex-wrap gap-2">
                {NUDGE_PRESETS.map((m) => (
                  <Chip
                    key={m}
                    pressed={!otherNudge && nudge === m}
                    onClick={() => {
                      setOtherNudge(false)
                      setNudge(nudge === m && !otherNudge ? null : m)
                    }}
                  >
                    {nudgeLabel(m)}
                  </Chip>
                ))}
                <Chip
                  pressed={otherNudge}
                  onClick={() => {
                    setOtherNudge(!otherNudge)
                    setNudge(null)
                  }}
                >
                  {t('medicines.nudgeOther')}
                </Chip>
              </div>
              {otherNudge && <NudgeOffset onChange={setNudge} />}
            </div>
          )}
        </Card>
      )}
    </Sheet>
  )
}
