import type { InputHTMLAttributes, SelectHTMLAttributes } from 'react'
import { cn } from '../../lib/cn'

// 44px tall (easy to tap) with 16px text (iPhones zoom into anything smaller)
const base =
  'min-h-11 w-full rounded-xl border border-line bg-surface px-3 text-base text-ink placeholder:text-muted/70 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20 disabled:opacity-60'

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(base, className)} {...props} />
}

export function Select({ className, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={cn(base, className)} {...props} />
}
