"use client"
import React, { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react'
import { cn } from '../../utils/cn'

type Toast = { id: string; title?: string; description?: string; variant?: 'success' | 'error' | 'info' }

type ToastCtx = {
  toasts: Toast[]
  toast: (t: Omit<Toast, 'id'>) => void
  dismiss: (id: string) => void
}

const Ctx = createContext<ToastCtx | undefined>(undefined)

export function useToast(): ToastCtx {
  const v = useContext(Ctx)
  if (!v) throw new Error('useToast must be used within <Toaster/>')
  return v
}

export function Toaster({ className, children }: { className?: string; children?: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const idRef = useRef(0)

  const dismiss = useCallback((id: string) => {
    setToasts((arr) => arr.filter((t) => t.id !== id))
  }, [])

  const toast = useCallback((t: Omit<Toast, 'id'>) => {
    const id = `${Date.now()}-${idRef.current++}`
    const next: Toast = { id, ...t }
    setToasts((arr) => [...arr, next])
    // auto dismiss
    setTimeout(() => dismiss(id), 4000)
  }, [dismiss])

  const value = useMemo(() => ({ toasts, toast, dismiss }), [toasts, toast, dismiss])

  return (
    <Ctx.Provider value={value}>
      {children}
      <div className={cn('pointer-events-none fixed inset-0 z-50 flex flex-col items-end gap-2 p-4', className)}>
        {toasts.map((t) => (
          <div
            key={t.id}
            className={cn(
              'pointer-events-auto w-full max-w-sm rounded-md border p-3 shadow-md backdrop-blur-sm',
              t.variant === 'success' && 'border-green-200 bg-green-50 text-green-900',
              t.variant === 'error' && 'border-red-200 bg-red-50 text-red-900',
              (!t.variant || t.variant === 'info') && 'border-gray-200 bg-white text-gray-900'
            )}
          >
            {t.title && <div className="text-sm font-medium">{t.title}</div>}
            {t.description && <div className="text-xs text-gray-600">{t.description}</div>}
          </div>
        ))}
      </div>
    </Ctx.Provider>
  )
}
