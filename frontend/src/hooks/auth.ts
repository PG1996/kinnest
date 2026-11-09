import { useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { api } from '../api/client'
import { unsubscribeQuietly } from '../push/subscribe'

/** Removes this phone's push subscription first, then ends the session and clears cached data. */
export function useSignOut() {
  const qc = useQueryClient()
  const navigate = useNavigate()
  return async () => {
    await unsubscribeQuietly()
    await api('/api/auth/logout', { method: 'POST' }).catch(() => undefined)
    qc.clear()
    navigate('/login')
  }
}
