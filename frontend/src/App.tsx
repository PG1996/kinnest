import { useTranslation } from 'react-i18next'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { useMe } from './api/hooks'
import Layout from './components/Layout'
import DiaperDay from './pages/DiaperDay'
import Family from './pages/Family'
import Health from './pages/Health'
import Home from './pages/Home'
import Login from './pages/Login'
import Patterns from './pages/Patterns'
import SleepDay from './pages/SleepDay'
import Timeline from './pages/Timeline'

/** Old addresses (notification links, bookmarks) land on their new home and keep any extra query. */
function Redirect({ to }: { to: string }) {
  const { search } = useLocation()
  const extra = search.replace(/^\?/, '')
  const [path, query = ''] = to.split('?')
  const merged = [query, extra].filter(Boolean).join('&')
  return <Navigate to={{ pathname: path, search: merged ? `?${merged}` : '' }} replace />
}

function RequireAuth() {
  const { t } = useTranslation()
  const me = useMe()
  if (me.isPending) return <p className="p-6 text-center text-muted">{t('common.loading')}</p>
  if (!me.data) return <Navigate to="/login" replace />
  return <Layout />
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route element={<RequireAuth />}>
        <Route index element={<Home />} />
        <Route path="timeline" element={<Timeline />} />
        <Route path="health" element={<Health />} />
        <Route path="patterns" element={<Patterns />} />
        <Route path="sleep" element={<SleepDay />} />
        <Route path="diapers" element={<DiaperDay />} />
        <Route path="family" element={<Family />} />
        <Route path="medicines" element={<Redirect to="/health?tab=medicines" />} />
        <Route path="members" element={<Redirect to="/family?tab=members" />} />
        <Route path="settings" element={<Redirect to="/family?tab=settings" />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
