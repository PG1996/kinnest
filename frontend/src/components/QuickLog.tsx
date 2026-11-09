import { Baby, Droplets, Moon, Pill, Ruler, type LucideIcon } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { cn } from '../lib/cn'

const TILE =
  'flex h-[68px] flex-col items-center justify-center gap-1 rounded-tile bg-surface text-sm font-bold text-ink shadow-sm transition active:scale-[0.97]'

function Tile({ Icon, tint, children }: { Icon: LucideIcon; tint: string; children: React.ReactNode }) {
  return (
    <>
      <Icon size={24} aria-hidden="true" className={tint} />
      {children}
    </>
  )
}

/** One-tap logging. Feed and Diaper open their screens; Sleep toggles; Medicine scrolls to today's doses; Vital opens the add form. */
export default function QuickLog({
  asleep,
  onFeed,
  onDiaper,
  onSleep,
  onMedicine,
}: {
  asleep: boolean
  onFeed: () => void
  onDiaper: () => void
  onSleep: () => void
  onMedicine: () => void
}) {
  const { t } = useTranslation()
  return (
    <section aria-label={t('home.quickLog')} className="space-y-2">
      <h2 className="text-sm font-extrabold text-muted">{t('home.quickLog')}</h2>
      <div className="grid grid-cols-3 gap-2.5">
        <button type="button" className={TILE} onClick={onFeed}>
          <Tile Icon={Baby} tint="text-feed">{t('home.feed')}</Tile>
        </button>
        <button type="button" className={TILE} onClick={onDiaper}>
          <Tile Icon={Droplets} tint="text-diaper">{t('home.diaper')}</Tile>
        </button>
        <button type="button" className={cn(TILE, asleep && 'bg-sleep-bg')} onClick={onSleep}>
          <Tile Icon={Moon} tint="text-sleep">{asleep ? t('sleep.end') : t('sleep.start')}</Tile>
        </button>
        <button type="button" className={TILE} onClick={onMedicine}>
          <Tile Icon={Pill} tint="text-med">{t('home.quick.medicine')}</Tile>
        </button>
        <Link to="/health?tab=vitals&add=1" className={TILE}>
          <Tile Icon={Ruler} tint="text-primary">{t('home.quick.vital')}</Tile>
        </Link>
      </div>
    </section>
  )
}
