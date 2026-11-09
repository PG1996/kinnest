import { HeartPulse, History, Home, LayoutGrid, Users, type LucideIcon } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { NavLink } from 'react-router-dom'
import { cn } from '../lib/cn'

const ITEMS: { to: string; key: string; Icon: LucideIcon; end?: boolean }[] = [
  { to: '/', key: 'home', Icon: Home, end: true },
  { to: '/timeline', key: 'timeline', Icon: History },
  { to: '/health', key: 'health', Icon: HeartPulse },
  { to: '/patterns', key: 'patterns', Icon: LayoutGrid },
  { to: '/family', key: 'family', Icon: Users },
]

/** Floating frosted bar: the current area shows icon and label, the others icon only. */
export default function GlassNav() {
  const { t } = useTranslation()
  return (
    <nav
      aria-label={t('nav.label')}
      className="fixed inset-x-4 bottom-[max(1rem,env(safe-area-inset-bottom))] z-20 mx-auto flex h-16 max-w-md items-center justify-between rounded-[28px] border border-white/60 bg-surface/75 px-2 shadow-[0_12px_32px_-12px_rgba(85,70,184,0.35)] backdrop-blur-[18px] backdrop-saturate-150"
    >
      {ITEMS.map(({ to, key, Icon, end }) => (
        <NavLink
          key={to}
          to={to}
          end={end}
          aria-label={t(`nav.${key}`)}
          className={({ isActive }) =>
            cn(
              'flex h-12 items-center justify-center gap-2 rounded-full text-sm font-bold transition-all',
              isActive ? 'bg-primary-soft px-4 text-med-ink' : 'w-12 text-muted',
            )
          }
        >
          {({ isActive }) => (
            <>
              <Icon size={22} aria-hidden="true" />
              {isActive && t(`nav.${key}`)}
            </>
          )}
        </NavLink>
      ))}
    </nav>
  )
}
