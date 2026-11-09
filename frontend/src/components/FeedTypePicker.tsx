import { useTranslation } from 'react-i18next'
import type { FeedType } from '../api/hooks'
import { cn } from '../lib/cn'

const MOM: { type: FeedType; short: string }[] = [
  { type: 'breast_left', short: 'L' },
  { type: 'breast_right', short: 'R' },
  { type: 'breast_both', short: 'Both' },
]
const BOTTLE: FeedType[] = ['expressed', 'formula']

/** The feed types in two groups: Mom's feed (L, R, Both) and the bottle (expressed, formula). One choice across both. */
export default function FeedTypePicker({ value, onChange }: { value: FeedType; onChange: (t: FeedType) => void }) {
  const { t } = useTranslation()
  const chip = (type: FeedType, text: string) => (
    <label
      key={type}
      className={cn(
        'flex min-h-11 cursor-pointer items-center justify-center rounded-full border-2 px-3 text-sm font-bold',
        value === type ? 'border-primary bg-primary text-primary-ink' : 'border-line bg-surface',
      )}
    >
      <input
        type="radio"
        name="feed-type"
        aria-label={t(`feedTypes.${type}`)}
        className="sr-only"
        checked={value === type}
        onChange={() => onChange(type)}
      />
      {text}
    </label>
  )
  return (
    <div className="space-y-3">
      <fieldset className="m-0 space-y-1.5 border-0 p-0" aria-label={t('feed.momGroup')}>
        <legend className="mb-1.5 text-xs font-semibold text-muted">{t('feed.momGroup')}</legend>
        <div className="grid grid-cols-3 gap-2">{MOM.map((m) => chip(m.type, m.short))}</div>
      </fieldset>
      <fieldset className="m-0 space-y-1.5 border-0 p-0" aria-label={t('feed.bottleGroup')}>
        <legend className="mb-1.5 text-xs font-semibold text-muted">{t('feed.bottleGroup')}</legend>
        <div className="grid grid-cols-2 gap-2">{BOTTLE.map((b) => chip(b, t(`feedTypes.${b}`)))}</div>
      </fieldset>
    </div>
  )
}
