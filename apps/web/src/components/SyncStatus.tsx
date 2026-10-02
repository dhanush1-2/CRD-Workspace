'use client'

import type { DocStatus } from '@/lib/doc-session'
import { useDocState } from '@/lib/doc-state'
import styles from './app-shell.module.css'

const DISPLAY: Record<DocStatus, { label: string; dot: string }> = {
  connected: { label: 'Synced', dot: 'var(--ok)' },
  connecting: { label: 'Syncing', dot: 'var(--sync)' },
  disconnected: { label: 'Offline', dot: 'var(--danger)' },
  fatal: { label: 'Offline', dot: 'var(--danger)' },
}

// Reads the document the page below has published. Renders nothing where there is
// no document (dashboard, workspace page), so the nav has no empty pill there.
export function SyncStatus() {
  const { documentId, status, peers } = useDocState()
  if (documentId === null) return null

  const { label, dot } = DISPLAY[status]
  // `peers` excludes this tab's own client, so the count is people other than you.
  // "1 here" with one peer follows the design's pattern and needs no plural handling.
  const text = status === 'connected' && peers.length > 0 ? `${peers.length} here` : label

  return (
    <span className={styles.status} data-testid="status" data-status={status}>
      <span className={styles.statusDot} style={{ background: dot }} aria-hidden="true" />
      <span className={styles.statusLabel}>{text}</span>
    </span>
  )
}
