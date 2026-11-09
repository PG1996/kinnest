import { ChevronRight } from 'lucide-react'
import { useEffect, useRef, useState, type MouseEvent, type PointerEvent } from 'react'
import { cn } from '../../lib/cn'

const THUMB = 48
const PAD = 4

/**
 * Drag the thumb across to confirm; letting go early springs back. The thumb is also a button, so
 * Enter or Space confirms for keyboard and screen-reader users, while an ordinary tap does nothing.
 */
export function SlideToConfirm({
  label,
  armedLabel,
  onConfirm,
  disabled,
}: {
  label: string
  /** shown after a single tap on the handle; a second tap then confirms (for people who cannot drag) */
  armedLabel?: string
  onConfirm: () => void
  disabled?: boolean
}) {
  const [x, setX] = useState(0)
  const [dragging, setDragging] = useState(false)
  const [armed, setArmed] = useState(false)
  useEffect(() => {
    if (!armed) return
    const id = window.setTimeout(() => setArmed(false), 4000)
    return () => window.clearTimeout(id)
  }, [armed])
  const start = useRef(0)
  const max = useRef(1)

  const down = (e: PointerEvent<HTMLDivElement>) => {
    if (disabled) return
    max.current = Math.max(1, e.currentTarget.getBoundingClientRect().width - THUMB - 2 * PAD)
    start.current = e.clientX - x
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      /* not supported in every environment */
    }
    setDragging(true)
  }
  const move = (e: PointerEvent<HTMLDivElement>) => {
    if (!dragging) return
    setX(Math.min(max.current, Math.max(0, e.clientX - start.current)))
  }
  const up = (e: PointerEvent<HTMLDivElement>) => {
    if (!dragging) return
    setDragging(false)
    const reached = Math.min(max.current, Math.max(0, e.clientX - start.current)) >= max.current * 0.85
    setX(0)
    if (reached) onConfirm()
  }
  // Enter, Space and screen-reader activation click with detail 0 and confirm at once. A pointer tap only arms the
  // handle (so an accidental touch does nothing); a second tap within a few seconds confirms. Dragging always works.
  const click = (e: MouseEvent) => {
    if (disabled) return
    if (e.detail === 0 || armed) {
      setArmed(false)
      onConfirm()
    } else {
      setArmed(true)
    }
  }
  const shownLabel = armed && armedLabel ? armedLabel : label

  return (
    <div
      data-testid="slide-track"
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={() => {
        setDragging(false)
        setX(0)
      }}
      className={cn('relative h-14 touch-none select-none overflow-hidden rounded-full bg-primary-soft', disabled && 'opacity-50')}
    >
      <div className="absolute inset-y-0 left-0 rounded-full bg-primary/20" style={{ width: x + THUMB + 2 * PAD }} />
      <span
        aria-hidden="true"
        className="absolute inset-0 flex items-center justify-center pl-12 text-base font-extrabold text-med-ink"
        style={{ opacity: Math.max(0, 1 - x / 120) }}
      >
        {shownLabel}
      </span>
      <button
        type="button"
        aria-label={shownLabel}
        disabled={disabled}
        onClick={click}
        className="absolute flex items-center justify-center rounded-full bg-primary text-primary-ink shadow-md"
        style={{
          top: PAD,
          left: PAD + x,
          width: THUMB,
          height: THUMB,
          transition: dragging ? 'none' : 'left 260ms cubic-bezier(0.2, 0.9, 0.3, 1.2)',
        }}
      >
        <ChevronRight size={22} />
      </button>
    </div>
  )
}
