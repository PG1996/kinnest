import type { HTMLAttributes } from 'react'
import { cn } from '../../lib'

export function Card({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('rounded-card border border-line bg-surface p-5 shadow-sm', className)} {...props} />
}
