import { useTranslation } from 'react-i18next'
import type { FeedType } from '../api/hooks'
import Sheet from './Sheet'
import { Badge } from './ui/badge'
import { Button } from './ui/button'

const SIDES: FeedType[] = ['breast_left', 'breast_right', 'breast_both']

/** Which side? Shown when a feed timer is started from the card. The side after the last breast feed is suggested. */
export default function FeedSidePicker({ last, onPick, onClose }: { last: FeedType | null; onPick: (type: FeedType) => void; onClose: () => void }) {
  const { t } = useTranslation()
  const suggested: FeedType | null = last === 'breast_left' ? 'breast_right' : last === 'breast_right' ? 'breast_left' : null
  return (
    <Sheet tone="feed" title={t('home.sideTitle')} onClose={onClose}>
      <div className="space-y-2">
        {SIDES.map((side) => (
          <Button key={side} variant="outline" size="lg" className="w-full justify-between" onClick={() => onPick(side)}>
            <span>{t(`feedTypes.${side}`)}</span>
            {side === suggested && (
              <Badge tone="feed" variant="solid">
                {t('home.sideSuggested')}
              </Badge>
            )}
          </Button>
        ))}
      </div>
    </Sheet>
  )
}
