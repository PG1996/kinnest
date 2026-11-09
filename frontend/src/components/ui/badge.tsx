import { useTranslation } from 'react-i18next'
import type { PlaceKind } from '../../api/hooks'
import { cn } from '../../lib/cn'
import type { Tone } from './card'

const BG: Record<Tone, string> = {
  plain: 'bg-surface-2 text-ink',
  feed: 'bg-feed-bg text-feed-ink',
  diaper: 'bg-diaper-bg text-diaper-ink',
  sleep: 'bg-sleep-bg text-sleep-ink',
  med: 'bg-med-bg text-med-ink',
  warn: 'bg-warn-bg text-warn-ink',
}

export function Badge({ tone = 'plain', className, children }: { tone?: Tone; className?: string; children: React.ReactNode }) {
  return <span className={cn('inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-extrabold', BG[tone], className)}>{children}</span>
}

const PLACE_TONE: Record<PlaceKind, Tone> = { home: 'diaper', hospital: 'feed', clinic: 'med', other: 'plain' }

export function PlaceBadge({ place }: { place: PlaceKind }) {
  const { t } = useTranslation()
  return <Badge tone={PLACE_TONE[place]}>{t(`vitals.places.${place}`)}</Badge>
}
