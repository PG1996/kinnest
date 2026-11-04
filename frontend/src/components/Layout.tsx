import { useQueryClient } from '@tanstack/react-query'
import { Home, Settings, Users } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { api } from '../api/client'
import { cn } from '../lib/cn'
import ThemeToggle from './ThemeToggle'
import { Button } from './ui/button'

export default function Layout() {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const navigate = useNavigate()
  const signOut = async () => {
    await api('/api/auth/logout', { method: 'POST' }).catch(() => undefined)
    qc.clear()
    navigate('/login')
  }
  const link = ({ isActive }: { isActive: boolean }) =>
    cn('flex min-h-12 flex-1 flex-col items-center justify-center gap-0.5 text-xs', isActive ? 'text-primary' : 'text-muted')
  return (
    <div className="mx-auto flex min-h-dvh max-w-xl flex-col">
      <header className="flex items-center justify-between px-4 pt-3">
        <span className="text-lg font-semibold">{t('app.name')}</span>
        <div className="flex items-center">
          <ThemeToggle />
          <Button variant="ghost" onClick={signOut}>
            {t('common.signOut')}
          </Button>
        </div>
      </header>
      <main className="flex-1 space-y-4 px-4 py-4">
        <Outlet />
      </main>
      <nav className="sticky bottom-0 flex border-t border-line bg-surface">
        <NavLink to="/" end className={link}>
          <Home size={22} />
          {t('nav.home')}
        </NavLink>
        <NavLink to="/members" className={link}>
          <Users size={22} />
          {t('nav.members')}
        </NavLink>
        <NavLink to="/settings" className={link}>
          <Settings size={22} />
          {t('nav.settings')}
        </NavLink>
      </nav>
    </div>
  )
}
