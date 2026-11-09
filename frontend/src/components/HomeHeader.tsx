import { Bell } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { useKid, useMembers } from '../api/hooks'
import { toLocalDate } from '../lib/time'
import { AvatarStack } from './ui/avatar'

const DAY_MS = 24 * 3600_000

/** Baby name, age, today's date, who is in the family and the way to notification settings. */
export default function HomeHeader({ now }: { now: number }) {
  const { t } = useTranslation()
  const kid = useKid().data
  const memberRows = useMembers().data
  const members = (Array.isArray(memberRows) ? memberRows : []).filter((m) => !m.pending && m.name)
  const date = new Date(now).toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' })
  const born = kid?.birth_date ? new Date(`${kid.birth_date}T00:00:00`).getTime() : null
  const days = born != null ? Math.max(0, Math.floor((new Date(`${toLocalDate(new Date(now))}T00:00:00`).getTime() - born) / DAY_MS)) : null
  return (
    <header className="flex items-center justify-between gap-3">
      <div className="min-w-0">
        <h1 className="truncate text-lg font-bold">{kid?.name || t('app.name')}</h1>
        <p className="text-sm text-muted">{days != null ? `${t('home.daysOld', { count: days })} · ${date}` : date}</p>
      </div>
      <div className="flex items-center gap-1">
        {members.length > 0 && <AvatarStack names={members.map((m) => m.name)} />}
        <Link
          to="/family?tab=settings"
          aria-label={t('home.notifications')}
          className="flex size-11 items-center justify-center rounded-full bg-surface text-ink shadow-sm"
        >
          <Bell size={22} aria-hidden="true" />
        </Link>
      </div>
    </header>
  )
}
