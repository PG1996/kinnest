import { cn } from '../../lib/cn'

/** An on/off setting: a real button with role="switch", so keyboards and screen readers get its state. */
export function Switch({ checked, onChange, label, disabled }: { checked: boolean; onChange: () => void; label: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={onChange}
      className={cn(
        'relative h-8 w-14 shrink-0 rounded-full transition-colors disabled:opacity-50',
        checked ? 'bg-primary' : 'bg-surface-2 ring-1 ring-line',
      )}
    >
      <span
        aria-hidden="true"
        className={cn('absolute top-1 size-6 rounded-full bg-surface shadow transition-all', checked ? 'left-7' : 'left-1')}
        style={checked ? { background: 'var(--primary-ink)' } : undefined}
      />
    </button>
  )
}
