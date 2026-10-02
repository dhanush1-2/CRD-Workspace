'use client'

import { useEffect, useId, useRef, type ReactNode } from 'react'
import styles from './sheet.module.css'

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

export function Sheet({
  title,
  onClose,
  maxWidth = 510,
  children,
}: {
  title: string
  onClose: () => void
  maxWidth?: number
  children: ReactNode
}) {
  const sheet = useRef<HTMLDivElement>(null)
  const titleId = useId()

  // Hold the latest onClose in a ref so the effect below runs once per mount.
  // If it depended on onClose, a caller passing an inline handler would re-run
  // the effect on every render: focus would jump back to the opener and then to
  // the first field while the user is typing.
  const closeRef = useRef(onClose)
  useEffect(() => {
    closeRef.current = onClose
  })

  useEffect(() => {
    // Remember what opened the sheet. Without this, closing drops focus to
    // <body> and a keyboard user restarts from the top of the document.
    const opener = document.activeElement as HTMLElement | null
    sheet.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus()

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        closeRef.current()
        return
      }
      if (event.key !== 'Tab') return
      // Cycle focus inside the dialog: a modal that lets Tab walk into the page
      // behind it is a modal only visually.
      const items = [...(sheet.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])]
      if (items.length === 0) return
      const first = items[0]!
      const last = items[items.length - 1]!
      if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      }
    }

    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      opener?.focus()
    }
  }, [])

  return (
    <div
      className={styles.overlay}
      data-testid="sheet-overlay"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div
        className={styles.sheet}
        style={{ maxWidth }}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-testid="sheet"
        ref={sheet}
      >
        <h2 className={styles.title} id={titleId}>
          {title}
        </h2>
        {children}
      </div>
    </div>
  )
}
