import { useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { flush } from './sync'

/** Try to send queued entries on start, every 30 s, when the phone comes online, and on returning to the app. */
export function useSync() {
  const qc = useQueryClient()
  useEffect(() => {
    const run = async () => {
      const result = await flush().catch(() => null)
      if (result?.sent) qc.invalidateQueries({ queryKey: ['summary'] })
    }
    const onVisible = () => document.visibilityState === 'visible' && run()
    run()
    const id = setInterval(run, 30_000)
    window.addEventListener('online', run)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearInterval(id)
      window.removeEventListener('online', run)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [qc])
}
