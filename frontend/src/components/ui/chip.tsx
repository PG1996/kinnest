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
        'min-h-11 rounded-full border-2 px-4 text-sm font-bold transition',
        pressed ? 'border-primary bg-primary text-primary-ink' : 'border-line bg-surface text-ink',
        className,
      )}
      {...props}
    />
  )
}

export function ChipGroup({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <fieldset className="m-0 border-0 p-0">
      <legend className="pb-2 text-sm font-extrabold text-muted">{label}</legend>
      <div className={cn('flex flex-wrap gap-2', className)}>{children}</div>
    </fieldset>
  )
}
