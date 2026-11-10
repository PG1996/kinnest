import { cva, type VariantProps } from 'class-variance-authority'
import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { cn } from '../../lib/cn'

const button = cva(
  'inline-flex items-center justify-center gap-2 rounded-full font-semibold transition active:scale-[0.98] disabled:opacity-50 disabled:active:scale-100',
  {
    variants: {
      variant: {
        primary: 'bg-primary text-primary-ink',
        soft: 'bg-primary-soft text-ink',
        outline: 'border-2 border-line bg-surface text-ink',
        ghost: 'text-muted hover:bg-line/50',
        danger: 'bg-danger text-primary-ink',
      },
      size: { sm: 'min-h-8 gap-1 px-3 text-[13px]', md: 'min-h-11 px-4 text-[15px]', lg: 'min-h-12 px-5 text-base' },
    },
    defaultVariants: { variant: 'primary', size: 'md' },
  },
)

export function Button({
  className,
  variant,
  size,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & VariantProps<typeof button>) {
  return <button className={cn(button({ variant, size }), className)} {...props} />
}

/** A 44 px round icon button; `label` is its accessible name. */
export function IconButton({
  label,
  children,
  className,
  ...props
}: { label: string; children: ReactNode } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      aria-label={label}
      className={cn('inline-flex size-11 items-center justify-center rounded-full bg-surface text-ink shadow-sm active:scale-95', className)}
      {...props}
    >
      {children}
    </button>
  )
}

export const linkButtonClass = (
  variant: VariantProps<typeof button>['variant'] = 'primary',
  size: VariantProps<typeof button>['size'] = 'md',
) => button({ variant, size })
