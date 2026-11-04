import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

/** Red banner once /api/health has been failing for `minOutageMs`, i.e. reminders may not be going out. */
export default function OfflineBanner({ checkEveryMs = 30_000, minOutageMs = 120_000 }: { checkEveryMs?: number; minOutageMs?: number }) {
  const { t } = useTranslation()
  const [down, setDown] = useState(false)
  useEffect(() => {
    let firstFailure: number | null = null
    let alive = true
    const check = async () => {
      try {
        const res = await fetch('/api/health', { cache: 'no-store' })
        if (!res.ok) throw new Error(String(res.status))
        firstFailure = null
        if (alive) setDown(false)
      } catch {
        const now = Date.now()
        firstFailure ??= now
        if (alive && now - firstFailure >= minOutageMs) setDown(true)
      }
    }
    const id = setInterval(check, checkEveryMs)
    return () => {
      alive = false
      clearInterval(id)
    }
  }, [checkEveryMs, minOutageMs])
  if (!down) return null
  return (
    <div role="alert" className="bg-danger px-4 py-2 text-center text-sm text-primary-ink">
      {t('offline.banner')}
    </div>
  )
}
