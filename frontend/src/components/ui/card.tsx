import type { HTMLAttributes } from 'react'
import { cn } from '../../lib/cn'

export type Tone = 'plain' | 'feed' | 'diaper' | 'sleep' | 'med' | 'warn'

const TONES: Record<Tone, string> = {
  plain: 'border-line bg-surface',
  feed: 'border-transparent bg-feed-bg text-ink',
  diaper: 'border-transparent bg-diaper-bg text-ink',
  sleep: 'border-transparent bg-sleep-bg text-ink',
  med: 'border-transparent bg-med-bg text-ink',
  warn: 'border-transparent bg-warn-bg text-ink',
}

/** The ink colour for a tone's eyebrow label ("LAST FED"). */
export const EYEBROW: Record<Tone, string> = {
  plain: 'text-muted',
  feed: 'text-feed-ink',
  diaper: 'text-diaper-ink',
  sleep: 'text-sleep-ink',
  med: 'text-med-ink',
  warn: 'text-warn-ink',
}

export function Card({
  className,
  tone = 'plain',
  interactive,
  ...props
}: HTMLAttributes<HTMLDivElement> & { tone?: Tone; interactive?: boolean }) {
  return (
    <div
      className={cn('rounded-card border p-5 shadow-sm', TONES[tone], interactive && 'transition active:scale-[0.99]', className)}
      {...props}
    />
  )
}

export function Eyebrow({ tone = 'plain', className, ...props }: HTMLAttributes<HTMLParagraphElement> & { tone?: Tone }) {
  return <p className={cn('text-sm font-extrabold uppercase tracking-wide', EYEBROW[tone], className)} {...props} />
}
