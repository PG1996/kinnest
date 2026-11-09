import { Check } from 'lucide-react'
import { useEffect } from 'react'
import { Button } from './ui/button'

export type ToastData = { message: string; action?: { label: string; run: () => void } }

export default function Toast({ toast, onClose, ms = 5000 }: { toast: ToastData; onClose: () => void; ms?: number }) {
  useEffect(() => {
    const id = setTimeout(onClose, ms)
    return () => clearTimeout(id)
  }, [toast, onClose, ms])
  return (
    <div
      role="status"
      className="fixed inset-x-4 bottom-24 z-40 mx-auto flex max-w-md items-center gap-3 rounded-2xl bg-ink py-1.5 pr-2 pl-4 text-app shadow-xl"
    >
      <Check size={20} aria-hidden="true" className="shrink-0 text-diaper" />
      <span className="flex-1 font-bold">{toast.message}</span>
      {toast.action && (
        <Button variant="ghost" className="min-h-11 rounded-xl bg-white/15 px-4 text-app hover:bg-white/25" onClick={toast.action.run}>
          {toast.action.label}
        </Button>
      )}
    </div>
  )
}
