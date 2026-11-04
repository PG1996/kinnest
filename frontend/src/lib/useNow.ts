import { useEffect, useState } from 'react'

/** Current time that re-renders the caller every `everyMs`, so "2h 10m ago" keeps ticking. */
export function useNow(everyMs = 30_000): number {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), everyMs)
    return () => clearInterval(id)
  }, [everyMs])
  return now
}
