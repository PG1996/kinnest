import { useTranslation } from 'react-i18next'
import type { DiaperStats } from '../lib/diaperDays'
import { formatAgo, formatTime } from '../lib/time'
import { Card } from './ui/card'

/** The day in four numbers: wet and dirty against the usual, how long since the last wet one, the longest gap. */
export default function DiaperTiles({ stats, nowMs, isToday }: { stats: DiaperStats; nowMs: number; isToday: boolean }) {
  const { t } = useTranslation()
  const tile = (id: string, label: string, value: string, sub?: string) => (
    <div key={id} data-testid={`tile-${id}`} className="rounded-tile bg-surface/70 px-3 py-2">
      <span className="block text-[11px] font-semibold text-muted">{label}</span>
      <span className="block text-xl font-bold tabular-nums">{value}</span>
      <span className="block min-h-4 text-[11px] text-muted">{sub ?? ''}</span>
    </div>
  )
  const lastWet =
    stats.lastWetAt === null ? '—' : isToday ? t('diapers.ago', { ago: formatAgo(nowMs - stats.lastWetAt) }) : formatTime(stats.lastWetAt)
  return (
    <Card tone="diaper" className="p-3">
      <div className="grid grid-cols-2 gap-2">
        {tile('wet', t('diapers.tileWet'), String(stats.wet), stats.usualWet === null ? undefined : t('diapers.usual', { n: stats.usualWet }))}
        {tile('dirty', t('diapers.tileDirty'), String(stats.dirty), stats.usualDirty === null ? undefined : t('diapers.usual', { n: stats.usualDirty }))}
        {tile('last-wet', t('diapers.tileLastWet'), lastWet)}
        {tile('gap', t('diapers.tileGap'), stats.longestGapMin === null ? '—' : formatAgo(stats.longestGapMin * 60_000))}
      </div>
    </Card>
  )
}
