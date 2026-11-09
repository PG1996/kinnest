import { Moon } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useTimeline } from '../api/hooks'
import Heatmap from '../components/Heatmap'
import PageHeader from '../components/PageHeader'
import StatCard from '../components/StatCard'
import { Card } from '../components/ui/card'
import { Segmented } from '../components/ui/segmented'
import { useCountUp } from '../lib/motion'
import { dailyStats, feedGrid, sleepGrid, type PatternKind } from '../lib/patterns'
import { formatAgo, formatHour, formatTime, toLocalDate } from '../lib/time'
import { lastDays } from '../lib/timeline'
import { useNow } from '../lib/useNow'

const LEVELS: Record<PatternKind, number> = { feeds: 3, sleep: 5 }

const clock = formatTime

/** Seven days of feeds or sleep as a heatmap, weekly averages with trends, and the longest sleep. */
export default function Patterns() {
  const { t } = useTranslation()
  const nowMs = useNow()
  const today = toLocalDate(new Date(nowMs))
  const [mode, setMode] = useState<PatternKind>('feeds')
  const [sel, setSel] = useState<[number, number] | null>(null)
  const range = useMemo(() => {
    const all = lastDays(14, new Date(`${today}T12:00:00`))
    const last = all[13]!
    return { days: all.slice(7), prev: all.slice(0, 7), from: all[0]!, to: new Date(last.getFullYear(), last.getMonth(), last.getDate(), 23, 59, 59, 999) }
  }, [today])
  const items = useTimeline({ from: range.from, to: range.to, kinds: ['feed', 'sleep', 'diaper'] }).data ?? []
  const now = useMemo(() => new Date(nowMs), [nowMs])
  const feeds = useMemo(() => feedGrid(items, range.days), [items, range.days])
  const sleep = useMemo(() => sleepGrid(items, range.days, now), [items, range.days, now])
  const stats = useMemo(() => dailyStats(items, range.days, now), [items, range.days, now])
  const before = useMemo(() => dailyStats(items, range.prev, now), [items, range.prev, now])

  const grid = mode === 'feeds' ? feeds : sleep
  const sleepText = (m: number) => t('patterns.asleepFor', { duration: formatAgo(m * 60_000) })
  const describeValue = (v: number) => (mode === 'feeds' ? t('patterns.feedsCount', { count: v }) : sleepText(v))

  const feedsShown = useCountUp(stats.feedsPerDay)
  const sleepShown = useCountUp(stats.sleepMinutesPerDay)
  const diapersShown = useCountUp(stats.diapersPerDay)
  const fmtSleep = (m: number) => `${Math.floor(m / 60)}h ${String(Math.round(m % 60)).padStart(2, '0')}`

  const delta = (cur: number, prev: number, text: (d: number) => string) =>
    before.daysWithData === 0 ? null : { up: cur >= prev, text: t('patterns.vsLast', { delta: text(Math.abs(cur - prev)) }) }

  let readout = mode === 'feeds' ? t('patterns.avgFeeds', { value: stats.feedsPerDay.toFixed(1) }) : t('patterns.avgSleep', { value: fmtSleep(stats.sleepMinutesPerDay) })
  let readoutSub = t('patterns.tapCell')
  if (sel) {
    const day = range.days[sel[0]]!
    const start = new Date(day.getFullYear(), day.getMonth(), day.getDate(), sel[1] * 2)
    readout = `${day.toLocaleDateString([], { weekday: 'short' })} · ${formatHour(sel[1] * 2)}`
    readoutSub = start.getTime() > nowMs ? t('patterns.notYet') : describeValue(grid[sel[0]]![sel[1]]!)
  }

  const longest = stats.longestSleep
  return (
    <>
      <PageHeader
        title={t('patterns.title')}
        subtitle={t('patterns.subtitle')}
        actions={
          <Segmented
            label={t('patterns.modeLabel')}
            value={mode}
            onChange={(m) => {
              setMode(m)
              setSel(null)
            }}
            options={[
              { value: 'feeds', label: t('patterns.modes.feeds') },
              { value: 'sleep', label: t('patterns.modes.sleep') },
            ]}
            className="w-44"
          />
        }
      />
      <Card className="space-y-3 p-4">
        <div role="status" className="flex min-h-9 items-center justify-between gap-2">
          <span className="font-bold">{readout}</span>
          <span className="text-sm text-muted">{readoutSub}</span>
        </div>
        <Heatmap
          key={mode}
          grid={grid}
          days={range.days}
          kind={mode}
          now={now}
          selected={sel}
          describeValue={describeValue}
          onSelect={(r, c) => setSel([r, c])}
          label={mode === 'feeds' ? t('patterns.gridFeeds') : t('patterns.gridSleep')}
        />
        <div className="flex items-center justify-end gap-1 text-xs text-muted">
          <span className="mr-1">{t('patterns.fewer')}</span>
          {Array.from({ length: LEVELS[mode] }, (_, i) => (
            <span key={i} data-legend={i} aria-hidden="true" className="size-3.5 rounded" style={{ background: `var(--heat-${i})` }} />
          ))}
          <span className="ml-1">{t('patterns.more')}</span>
        </div>
      </Card>
      <div className="grid grid-cols-3 gap-2">
        <StatCard
          label={t('patterns.stats.feeds')}
          value={feedsShown.toFixed(1)}
          series={stats.series.feeds}
          seriesLabel={`${t('patterns.stats.feeds')}: ${stats.series.feeds.join(', ')}`}
          delta={delta(stats.feedsPerDay, before.feedsPerDay, (d) => d.toFixed(1))}
        />
        <StatCard
          label={t('patterns.stats.sleep')}
          value={fmtSleep(sleepShown)}
          series={stats.series.sleep}
          seriesLabel={`${t('patterns.stats.sleep')}: ${stats.series.sleep.join(', ')}`}
          delta={delta(stats.sleepMinutesPerDay, before.sleepMinutesPerDay, (d) => formatAgo(d * 60_000))}
        />
        <StatCard
          label={t('patterns.stats.diapers')}
          value={diapersShown.toFixed(1)}
          series={stats.series.diapers}
          seriesLabel={`${t('patterns.stats.diapers')}: ${stats.series.diapers.join(', ')}`}
          delta={delta(stats.diapersPerDay, before.diapersPerDay, (d) => d.toFixed(1))}
        />
      </div>
      {longest && (
        <Card tone="sleep" className="flex items-center gap-3 p-4">
          <Moon size={26} aria-hidden="true" className="shrink-0 text-sleep" />
          <div>
            <p className="font-bold">{t('patterns.longest', { duration: formatAgo(longest.minutes * 60_000) })}</p>
            <p className="text-sm text-muted">
              {t('patterns.longestWhen', { day: longest.start.toLocaleDateString([], { weekday: 'short' }), from: clock(longest.start), to: clock(longest.end) })}
            </p>
          </div>
        </Card>
      )}
      {stats.daysWithData < 7 && <p className="text-center text-sm text-muted">{t('patterns.clearer')}</p>}
    </>
  )
}
