import { useEffect, useRef, useState } from 'react'

/** True when the user asked for less motion, or when we cannot tell (tests, old browsers). */
export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return true
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/** Counts from 0 to `target` with an ease-out curve; shows the final value at once under reduced motion. */
export function useCountUp(target: number, ms = 900): number {
  const reduced = prefersReducedMotion()
  const [value, setValue] = useState(reduced ? target : 0)
  const shown = useRef(reduced ? target : 0)
  useEffect(() => {
    if (reduced) return
    const begin = shown.current // a new target animates from what is on screen, never from zero again
    const start = performance.now()
    let raf = 0
    const step = (now: number) => {
      const k = Math.min(1, (now - start) / ms)
      shown.current = begin + (target - begin) * (1 - Math.pow(1 - k, 3))
      setValue(shown.current)
      if (k < 1) raf = requestAnimationFrame(step)
    }
    raf = requestAnimationFrame(step)
    return () => cancelAnimationFrame(raf)
  }, [target, ms, reduced])
  return reduced ? target : value
}
