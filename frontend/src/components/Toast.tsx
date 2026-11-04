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
      className="fixed inset-x-4 bottom-20 z-20 mx-auto flex max-w-md items-center justify-between gap-3 rounded-2xl bg-ink px-4 py-2 text-app shadow-lg"
    >
      <span>{toast.message}</span>
      {toast.action && (
        <Button variant="ghost" className="text-accent" onClick={toast.action.run}>
          {toast.action.label}
        </Button>
      )}
    </div>
  )
}
