import { Fragment, useState, type ClipboardEvent } from 'react'
import { useTranslation } from 'react-i18next'
import type { PlaceKind, VitalInput } from '../api/hooks'
import { BulkError, useBulkVitals } from '../hooks/log'
import { MEASUREMENTS, validateVital, type MeasurementKey } from '../lib/vitals'
import { PLACES } from '../lib/vitalsFormat'
import { Button } from './ui/button'

type Row = { id: string; date: string; time: string; place: PlaceKind } & Record<MeasurementKey, string>

const emptyRow = (): Row => ({
  id: crypto.randomUUID(), date: '', time: '09:00', place: 'home',
  ...(Object.fromEntries(MEASUREMENTS.map((m) => [m.key, ''])) as Record<MeasurementKey, string>),
})

const cellClass = 'min-h-10 w-full min-w-16 rounded-lg border border-line bg-app px-2 text-sm'

function toInput(r: Row): VitalInput {
  const out: VitalInput = { id: r.id, measured_at: '', place_kind: r.place }
  const when = new Date(`${r.date}T${r.time || '09:00'}`)
  out.measured_at = Number.isNaN(when.getTime()) ? '' : when.toISOString()
  for (const m of MEASUREMENTS) {
    const raw = r[m.key].trim().replace(',', '.')
    out[m.key] = raw === '' ? null : Number(raw)
  }
  return out
}

/** Many past readings at once: an editable table (or pasted spreadsheet rows), saved in one all-or-nothing request. */
export default function BulkVitals({ onDone }: { onDone?: () => void }) {
  const { t } = useTranslation()
  const [rows, setRows] = useState<Row[]>([emptyRow()])
  const [errors, setErrors] = useState<Record<number, string>>({})
  const bulk = useBulkVitals()

  const set = (i: number, k: keyof Row, v: string) => setRows(rows.map((r, j) => (j === i ? { ...r, [k]: v } : r)))

  const paste = (e: ClipboardEvent) => {
    const text = e.clipboardData.getData('text')
    if (!text.includes('\t')) return
    e.preventDefault()
    const parsed = text
      .split(/\r?\n/)
      .filter((line) => line.trim())
      .map((line) => {
        const [date = '', time = '', place = '', ...vals] = line.split('\t').map((c) => c.trim())
        const r = emptyRow()
        r.date = date
        r.time = time || r.time
        r.place = (PLACES as string[]).includes(place.toLowerCase()) ? (place.toLowerCase() as PlaceKind) : 'home'
        MEASUREMENTS.forEach((m, i) => (r[m.key] = vals[i] ?? ''))
        return r
      })
    const kept = rows.filter((r) => r.date || MEASUREMENTS.some((m) => r[m.key]))
    setRows([...kept, ...parsed])
  }

  const save = () => {
    const inputs = rows.map(toInput)
    const found: Record<number, string> = {}
    inputs.forEach((input, i) => {
      if (!input.measured_at) {
        found[i] = t('vitals.bulk.date')
        return
      }
      const problems = validateVital(input)
      if (Object.keys(problems).length) found[i] = Object.values(problems).join(' ')
    })
    setErrors(found)
    if (Object.keys(found).length) return
    bulk.mutate(inputs, {
      onError: (e) => setErrors(e instanceof BulkError ? e.rowErrors : {}),
      onSuccess: () => {
        setRows([emptyRow()])
        onDone?.()
      },
    })
  }

  return (
    <div className="space-y-3">
      <label className="block text-sm text-muted">
        {t('vitals.bulk.pasteHere')}
        <textarea
          aria-label={t('vitals.bulk.pasteHere')}
          onPaste={paste}
          rows={2}
          className="mt-1 w-full rounded-2xl border border-line bg-app p-2 text-sm"
        />
      </label>
      <p className="text-xs text-muted">{t('vitals.bulk.pasteHint')}</p>
      <div className="overflow-x-auto">
        <table className="w-full border-separate border-spacing-1 text-sm">
          <thead>
            <tr className="text-left text-xs text-muted">
              <th>{t('vitals.bulk.date')}</th>
              <th>{t('vitals.bulk.time')}</th>
              <th>{t('vitals.bulk.place')}</th>
              {MEASUREMENTS.map((m) => (
                <th key={m.key}>{`${t(m.label)} (${t(m.unit)})`}</th>
              ))}
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <Fragment key={r.id}>
                <tr>
                  <td>
                    <input aria-label={`${t('vitals.bulk.date')} ${i + 1}`} type="date" className={cellClass} value={r.date} onChange={(e) => set(i, 'date', e.target.value)} />
                  </td>
                  <td>
                    <input aria-label={`${t('vitals.bulk.time')} ${i + 1}`} type="time" className={cellClass} value={r.time} onChange={(e) => set(i, 'time', e.target.value)} />
                  </td>
                  <td>
                    <select aria-label={`${t('vitals.bulk.place')} ${i + 1}`} className={cellClass} value={r.place} onChange={(e) => set(i, 'place', e.target.value)}>
                      {PLACES.map((p) => (
                        <option key={p} value={p}>
                          {t(`vitals.places.${p}`)}
                        </option>
                      ))}
                    </select>
                  </td>
                  {MEASUREMENTS.map((m) => (
                    <td key={m.key}>
                      <input
                        aria-label={`${t(m.label)} ${i + 1}`}
                        type="number"
                        step="any"
                        inputMode="decimal"
                        className={cellClass}
                        value={r[m.key]}
                        onChange={(e) => set(i, m.key, e.target.value)}
                      />
                    </td>
                  ))}
                  <td>
                    {rows.length > 1 && (
                      <Button variant="ghost" aria-label={t('vitals.bulk.removeRow', { n: i + 1 })} onClick={() => setRows(rows.filter((_, j) => j !== i))}>
                        ×
                      </Button>
                    )}
                  </td>
                </tr>
                {errors[i] && (
                  <tr>
                    <td colSpan={MEASUREMENTS.length + 4} className="text-xs text-danger">
                      <span>{`${t('vitals.bulk.row', { n: i + 1 })}: `}</span>
                      <span>{errors[i]}</span>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
      {Object.keys(errors).length > 0 && <p className="text-sm text-danger">{t('vitals.bulk.fixRows')}</p>}
      {bulk.isSuccess && (
        <p className="text-sm">{t('vitals.bulk.saved', { created: bulk.data.created, existing: bulk.data.existing })}</p>
      )}
      <div className="flex gap-2">
        <Button variant="soft" onClick={() => setRows([...rows, emptyRow()])}>
          {t('vitals.bulk.addRow')}
        </Button>
        <Button onClick={save} disabled={bulk.isPending}>
          {t('vitals.bulk.save')}
        </Button>
      </div>
    </div>
  )
}
