import { useTranslation } from 'react-i18next'
import type { PlaceKind } from '../../api/hooks'
import { cn } from '../../lib/cn'
import type { Tone } from './card'

export type BadgeVariant = 'soft' | 'solid' | 'outline'

const SOFT: Record<Tone, string> = {
  plain: 'bg-surface-2 text-ink',
  feed: 'bg-feed-bg text-feed-ink',
  diaper: 'bg-diaper-bg text-diaper-ink',
  sleep: 'bg-sleep-bg text-sleep-ink',
  med: 'bg-med-bg text-med-ink',
  warn: 'bg-warn-bg text-warn-ink',
}
const SOLID: Record<Tone, string> = {
  plain: 'bg-ink text-app',
  feed: 'bg-feed text-primary-ink',
  diaper: 'bg-diaper text-primary-ink',
  sleep: 'bg-sleep text-primary-ink',
  med: 'bg-med text-primary-ink',
  warn: 'bg-warn-solid text-warn-solid-ink',
}
const OUTLINE: Record<Tone, string> = {
  plain: 'border-line text-ink',
  feed: 'border-feed/40 text-feed-ink',
  diaper: 'border-diaper/40 text-diaper-ink',
  sleep: 'border-sleep/40 text-sleep-ink',
  med: 'border-med/40 text-med-ink',
  warn: 'border-warn-solid text-warn-ink',
}
const DOT: Record<Tone, string> = { plain: 'bg-muted', feed: 'bg-feed', diaper: 'bg-diaper', sleep: 'bg-sleep', med: 'bg-med', warn: 'bg-warn-solid' }
const STYLES: Record<BadgeVariant, Record<Tone, string>> = { soft: SOFT, solid: SOLID, outline: OUTLINE }

/**
 * A small pill in a tone (soft by default; solid or outline). `dot` adds a status dot and `pulse` a soft ping ring around it,
 * for something live. The ping stops for people who ask for reduced motion.
 */
export function Badge({
  tone = 'plain',
  variant = 'soft',
  dot = false,
  pulse = false,
  className,
  children,
}: {
  tone?: Tone
  variant?: BadgeVariant
  dot?: boolean
  pulse?: boolean
  className?: string
  children: React.ReactNode
}) {
  const dotColor = variant === 'solid' ? 'bg-current' : DOT[tone]
  return (
    <span data-badge className={cn('inline-flex h-6 items-center gap-1.5 rounded-full border border-transparent px-2.5 text-xs font-bold whitespace-nowrap', STYLES[variant][tone], className)}>
      {dot && (
        <span data-badge-dot aria-hidden="true" className="relative flex size-1.5 shrink-0">
          {pulse && <span className={cn('absolute inset-0 animate-ping rounded-full opacity-60 motion-reduce:animate-none', dotColor)} />}
          <span className={cn('relative size-1.5 rounded-full', dotColor)} />
        </span>
      )}
      {children}
    </span>
  )
}

const PLACE_TONE: Record<PlaceKind, Tone> = { home: 'diaper', hospital: 'feed', clinic: 'med', other: 'plain' }

export function PlaceBadge({ place }: { place: PlaceKind }) {
  const { t } = useTranslation()
  return <Badge tone={PLACE_TONE[place]}>{t(`vitals.places.${place}`)}</Badge>
}
