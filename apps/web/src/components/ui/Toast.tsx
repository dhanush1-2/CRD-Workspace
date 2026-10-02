'use client'

import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react'
import styles from './sheet.module.css'

type Toast = { id: number; message: string }

const ToastContext = createContext<(message: string) => void>(() => {})

export function useToast(): (message: string) => void {
  return useContext(ToastContext)
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const nextId = useRef(0)

  // useCallback with an empty dep list: this value goes into a context, so a new
  // identity on every render would re-render every consumer on every render.
  const show = useCallback((message: string) => {
    const id = nextId.current++
    setToasts((current) => [...current, { id, message }])
    // 3.2s per the handoff. Filtering by id rather than shifting means two
    // toasts raised close together each get their full dwell time.
    setTimeout(() => setToasts((current) => current.filter((t) => t.id !== id)), 3200)
  }, [])

  return (
    <ToastContext.Provider value={show}>
      {children}
      {/* The live region is always in the DOM and only its children come and go. A
          polite region inserted in the same tick as its text is unreliably announced,
          often not at all, and this toast is the only confirmation a screen-reader
          user gets that a role change saved. position: fixed, so empty it takes no
          space. */}
      <div className={styles.toastWrap} role="status" aria-live="polite" data-testid="toast-region">
        {toasts.map((toast) => (
          <div className={styles.toast} key={toast.id} data-testid="toast">
            <span className={styles.toastDot} aria-hidden="true" />
            {toast.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}
