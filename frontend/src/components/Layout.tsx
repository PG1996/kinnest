import { Outlet } from 'react-router-dom'
import { useThemeSync } from '../lib/theme'
import { useSync } from '../offline/useSync'
import GlassNav from './GlassNav'
import OfflineBanner from './OfflineBanner'
import ParentSetup from './ParentSetup'

export default function Layout() {
  useSync()
  useThemeSync()
  return (
    <div className="mx-auto flex min-h-dvh max-w-xl flex-col">
      <OfflineBanner />
      <main className="flex-1 space-y-4 px-4 pt-5 pb-28">
        <Outlet />
      </main>
      <GlassNav />
      <ParentSetup />
    </div>
  )
}
