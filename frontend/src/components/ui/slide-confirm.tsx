import { ChevronRight } from 'lucide-react'
import { useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { cn } from '../../lib/cn'

const THUMB = 48
const PAD = 4

/**
 * Drag the thumb across to confirm; letting go early springs back. The thumb is also a button, so
 * Enter or Space confirms for keyboard and screen-reader users.
 */
export function SlideToConfirm({
  label,
  onConfirm,
  disabled,
}: {
  label: string
  onConfirm: () => void
  disabled?: boolean
}) {
  const [x, setX] = useState(0)
  const [dragging, setDragging] = useState(false)
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
  const key = (e: KeyboardEvent) => {
    if (disabled) return
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      onConfirm()
    }
  }

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
        {label}
      </span>
      <button
        type="button"
        aria-label={label}
        disabled={disabled}
        onKeyDown={key}
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
