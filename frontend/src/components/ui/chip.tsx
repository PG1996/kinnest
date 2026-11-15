import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { cn } from '../../lib/cn'

export function Chip({
  pressed,
  className,
  ...props
}: { pressed: boolean } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      className={cn(
        'min-h-11 rounded-full border px-3.5 text-sm font-semibold transition',
        pressed ? 'border-primary bg-primary text-primary-ink' : 'border-line bg-surface text-ink',
        className,
      )}
      {...props}
    />
  )
}

export function ChipGroup({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    // no m-0: it would beat a parent's space-y (a zero-specificity :where rule) and glue the next block to the chips
    <fieldset className="border-0 p-0">
      <legend className="pb-2 text-[13px] font-semibold text-muted">{label}</legend>
      <div className={cn('flex flex-wrap gap-2', className)}>{children}</div>
    </fieldset>
  )
}
