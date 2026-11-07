import { useTranslation } from 'react-i18next'
import { Navigate, Route, Routes } from 'react-router-dom'
import { useMe } from './api/hooks'
import Layout from './components/Layout'
import Home from './pages/Home'
import Login from './pages/Login'
import Members from './pages/Members'
import MedicinesPage from './pages/Medicines'
import Settings from './pages/Settings'

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
        <Route path="members" element={<Members />} />
        <Route path="medicines" element={<MedicinesPage />} />
        <Route path="settings" element={<Settings />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
