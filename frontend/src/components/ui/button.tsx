import { cva, type VariantProps } from 'class-variance-authority'
import type { ButtonHTMLAttributes } from 'react'
import { cn } from '../../lib'

const button = cva(
  'inline-flex min-h-12 items-center justify-center gap-2 rounded-full px-5 text-base font-medium transition active:scale-[0.98] disabled:opacity-50',
  {
    variants: {
      variant: {
        primary: 'bg-primary text-primary-ink',
        soft: 'bg-accent/30 text-ink',
        ghost: 'text-muted hover:bg-line/50',
        danger: 'bg-danger text-primary-ink',
      },
    },
    defaultVariants: { variant: 'primary' },
  },
)

export function Button({
  className,
  variant,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & VariantProps<typeof button>) {
  return <button className={cn(button({ variant }), className)} {...props} />
}

export const linkButtonClass = (variant: VariantProps<typeof button>['variant'] = 'primary') => button({ variant })
