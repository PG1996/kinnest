import { useRef, type KeyboardEvent } from 'react'
import { cn } from '../../lib/cn'

/** `detail` is a second line under the label (a value); it only shows in `scroll` mode. */
export type SegOption<T extends string> = { value: T; label: string; detail?: string }

/** A radio group drawn as a track with a sliding white pill. Arrow keys move the choice. */
export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
  className,
  kind = 'radio',
  scroll = false,
}: {
  label: string
  value: T
  options: SegOption<T>[]
  onChange: (v: T) => void
  className?: string
  /** `tab` renders a tablist (for switching panels); `radio` a radiogroup (for choosing a value). */
  kind?: 'radio' | 'tab'
  /** For many or long options: each keeps its own width and the row scrolls sideways, instead of equal squeezed columns. */
  scroll?: boolean
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([])
  const n = options.length
  const index = Math.max(0, options.findIndex((o) => o.value === value))
  const move = (e: KeyboardEvent, to: number) => {
    e.preventDefault()
    const next = (to + n) % n
    onChange(options[next].value)
    refs.current[next]?.focus()
  }
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') move(e, index + 1)
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') move(e, index - 1)
  }
  if (scroll)
    return (
      <div role={kind === 'tab' ? 'tablist' : 'radiogroup'} aria-label={label} onKeyDown={onKeyDown} className={cn('rounded-2xl bg-surface-2 p-1', className)}>
        <div className="flex gap-1 overflow-x-auto [scrollbar-width:none]">
          {options.map((o, i) => (
            <button
              key={o.value}
              ref={(el) => {
                refs.current[i] = el
              }}
              type="button"
              role={kind === 'tab' ? 'tab' : 'radio'}
              {...(kind === 'tab' ? { 'aria-selected': o.value === value } : { 'aria-checked': o.value === value })}
              tabIndex={o.value === value ? 0 : -1}
              onClick={() => onChange(o.value)}
              className={cn('min-h-11 shrink-0 whitespace-nowrap rounded-xl px-3.5 py-1.5 text-center', o.value === value ? 'bg-surface text-ink shadow-sm' : 'text-muted')}
            >
              <span data-testid="tab-name" className="block text-xs font-semibold">
                {o.label}
              </span>
              {o.detail && (
                <span data-testid="tab-value" className="block text-sm font-bold tabular-nums">
                  {o.detail}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>
    )
  return (
    <div role={kind === 'tab' ? 'tablist' : 'radiogroup'} aria-label={label} onKeyDown={onKeyDown} className={cn('rounded-2xl bg-surface-2 p-1', className)}>
      <div className="relative grid" style={{ gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))` }}>
        <span
          aria-hidden="true"
          className="absolute inset-y-0 rounded-xl bg-surface shadow-sm transition-[left] duration-300 ease-[cubic-bezier(.2,.9,.3,1.15)]"
          style={{ width: `${100 / n}%`, left: `${(index * 100) / n}%` }}
        />
        {options.map((o, i) => (
          <button
            key={o.value}
            ref={(el) => {
              refs.current[i] = el
            }}
            type="button"
            role={kind === 'tab' ? 'tab' : 'radio'}
            {...(kind === 'tab' ? { 'aria-selected': o.value === value } : { 'aria-checked': o.value === value })}
            tabIndex={o.value === value ? 0 : -1}
            onClick={() => onChange(o.value)}
            className={cn('relative min-h-11 rounded-xl px-2 text-sm font-semibold', o.value === value ? 'text-ink' : 'text-muted')}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  )
}
