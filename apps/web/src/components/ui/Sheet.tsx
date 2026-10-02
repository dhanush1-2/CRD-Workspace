'use client'

import { useEffect, useId, useRef, type ReactNode } from 'react'
import { containTab, FOCUSABLE } from './focus-trap'
import styles from './sheet.module.css'

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
      containTab(event, sheet.current)
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
