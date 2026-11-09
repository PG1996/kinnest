import { TriangleAlert } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { DraftRow, ScanDraft } from '../api/scan'
import type { PlaceKind, VitalInput } from '../api/hooks'
import { BulkError, useBulkVitals } from '../hooks/log'
import { toLocalDate } from '../lib/time'
import { MEASUREMENTS, shownUnit, shownValue, storedValue, validateVital, type MeasurementKey } from '../lib/vitals'
import { PLACES } from '../lib/vitalsFormat'
import { Button } from './ui/button'
import { Card } from './ui/card'
import { Chip, ChipGroup } from './ui/chip'
import { Input } from './ui/field'

type Row = { id: string; include: boolean; date: string; time: string; values: Partial<Record<MeasurementKey, string>>; unsure: Set<MeasurementKey> }

const toRow = (r: DraftRow, i: number): Row => {
  const when = r.measured_at ? new Date(r.measured_at) : null
  const ok = when && !Number.isNaN(when.getTime())
  const pad = (n: number) => String(n).padStart(2, '0')
  return {
    id: `row-${i}`,
    include: true,
    date: ok ? toLocalDate(when) : '',
    time: ok ? `${pad(when.getHours())}:${pad(when.getMinutes())}` : '09:00',
    values: Object.fromEntries(Object.entries(r.values).filter(([, v]) => v != null).map(([k, v]) => [k, String(shownValue(k as MeasurementKey, v as number))])),
    unsure: new Set(r.unsure),
  }
}

/** The scanned draft: every row can be unticked or corrected. Nothing is saved until "Save". */
export default function ScanReview({ draft, photoUrl, photoAlt, onDone }: { draft: ScanDraft; photoUrl: string; photoAlt: string; onDone: (saved: number) => void }) {
  const { t } = useTranslation()
  const [rows, setRows] = useState<Row[]>(() => draft.rows.map(toRow))
  const [place, setPlace] = useState<PlaceKind>('home')
  const [defaultDate, setDefaultDate] = useState('')
  const [errors, setErrors] = useState<Record<number, string>>({})
  const [failure, setFailure] = useState('')
  const bulk = useBulkVitals()
  const chosen = rows.filter((r) => r.include)
  const update = (i: number, patch: Partial<Row>) => setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)))
  const setValue = (i: number, k: MeasurementKey, v: string) => update(i, { values: { ...rows[i]!.values, [k]: v }, unsure: new Set([...rows[i]!.unsure].filter((x) => x !== k)) })

  const toInput = (r: Row): VitalInput => {
    const day = r.date || defaultDate
    const when = day ? new Date(`${day}T${r.time || '09:00'}`) : null
    const input: VitalInput = { id: crypto.randomUUID(), measured_at: when && !Number.isNaN(when.getTime()) ? when.toISOString() : '', place_kind: place }
    for (const m of MEASUREMENTS) {
      const raw = (r.values[m.key] ?? '').trim().replace(',', '.')
      input[m.key] = raw === '' ? null : storedValue(m.key, Number(raw))
    }
    return input
  }

  const save = () => {
    const inputs = rows.map((r) => (r.include ? toInput(r) : null))
    const found: Record<number, string> = {}
    inputs.forEach((input, i) => {
      if (!input) return
      if (!input.measured_at) return void (found[i] = t('vitals.bulk.date'))
      const problems = validateVital(input)
      if (Object.keys(problems).length) found[i] = Object.values(problems).join(' ')
    })
    setErrors(found)
    setFailure('')
    if (Object.keys(found).length) return
    bulk.mutate(
      inputs.filter((x): x is VitalInput => x !== null),
      {
        onError: (e) => {
          const rowErrors = e instanceof BulkError ? e.rowErrors : {}
          setErrors(rowErrors)
          if (Object.keys(rowErrors).length === 0) setFailure(e instanceof TypeError ? t('vitals.bulk.offline') : e.message)
        },
        onSuccess: (r) => onDone(r.created + r.existing),
      },
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-3">
        <img src={photoUrl || undefined} alt={photoAlt} className="size-20 shrink-0 rounded-tile bg-surface-2 object-cover" />
        <p className="text-sm font-bold text-muted">{t('scan.draftTitle')}</p>
      </div>
      {draft.warnings.length > 0 && (
        <Card tone="warn" className="space-y-1 p-4">
          {draft.warnings.map((w) => (
            <p key={w} className="flex gap-2 text-sm font-bold">
              <TriangleAlert size={18} aria-hidden="true" className="mt-0.5 shrink-0" />
              {w}
            </p>
          ))}
        </Card>
      )}
      {draft.rows.length === 0 && <p className="text-sm text-muted">{t('scan.none')}</p>}
      <ChipGroup label={t('scan.placeLabel')}>
        {PLACES.map((p) => (
          <Chip key={p} pressed={place === p} onClick={() => setPlace(p)}>
            {t(`vitals.places.${p}`)}
          </Chip>
        ))}
      </ChipGroup>
      <div className="space-y-1">
        <label htmlFor="scan-default-date" className="block text-[13px] font-semibold text-muted">
          {t('scan.defaultDate')}
        </label>
        <Input id="scan-default-date" type="date" value={defaultDate} onChange={(e) => setDefaultDate(e.target.value)} />
      </div>
      <ul className="space-y-3">
        {rows.map((r, i) => (
          <li key={r.id}>
            <Card className={`space-y-2 p-3 ${r.include ? '' : 'opacity-50'}`}>
              <div className="flex items-center gap-3">
                <input
                  type="checkbox"
                  aria-label={`${t('scan.include')} ${i + 1}`}
                  checked={r.include}
                  onChange={(e) => update(i, { include: e.target.checked })}
                  className="size-6 accent-primary"
                />
                <input
                  type="date"
                  aria-label={`${t('vitals.bulk.date')} ${i + 1}`}
                  value={r.date}
                  onChange={(e) => update(i, { date: e.target.value })}
                  className="min-h-11 flex-1 rounded-xl border border-line bg-app px-2 text-sm"
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                {MEASUREMENTS.filter((m) => r.values[m.key] !== undefined || r.unsure.has(m.key)).map((m) => (
                  <label key={m.key} className="block text-xs text-muted">
                    <span className="flex items-center gap-1">
                      {`${t(m.label)} (${t(shownUnit(m))})`}
                      {r.unsure.has(m.key) && <span className="rounded-full bg-warn-bg px-1.5 text-[11px] font-bold text-warn-ink">{t('scan.check')}</span>}
                    </span>
                    <input
                      type="number"
                      step="any"
                      inputMode="decimal"
                      aria-label={`${t(m.label)} ${i + 1}`}
                      value={r.values[m.key] ?? ''}
                      onChange={(e) => setValue(i, m.key, e.target.value)}
                      className="mt-0.5 min-h-11 w-full rounded-xl border border-line bg-app px-2 text-base text-ink"
                    />
                  </label>
                ))}
              </div>
              {errors[i] && (
                <p className="text-xs text-danger">
                  <span>{`${t('vitals.bulk.row', { n: i + 1 })}: `}</span>
                  <span>{errors[i]}</span>
                </p>
              )}
            </Card>
          </li>
        ))}
      </ul>
      {Object.keys(errors).length > 0 && <p className="text-sm text-danger">{t('vitals.bulk.fixRows')}</p>}
      {failure && <p className="text-sm text-danger">{failure}</p>}
      <Button size="lg" className="w-full" onClick={save} disabled={bulk.isPending || chosen.length === 0}>
        {t('scan.save', { count: chosen.length })}
      </Button>
    </div>
  )
}
