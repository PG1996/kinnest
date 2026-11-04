import type { InputHTMLAttributes, SelectHTMLAttributes } from 'react'
import { cn } from '../../lib/cn'

const base = 'min-h-12 w-full rounded-2xl border border-line bg-app px-4 text-base text-ink disabled:opacity-60'

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(base, className)} {...props} />
}

export function Select({ className, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={cn(base, className)} {...props} />
}
