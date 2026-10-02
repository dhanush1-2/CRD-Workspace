'use client'

import { useDocState } from '@/lib/doc-state'
import styles from './app-shell.module.css'

// Who else is in the open document. Renders nothing when nobody is, so the nav has no
// empty gap. Each avatar is filled with the colour that peer announced through
// awareness, and the initial plus the accessible name carry identity so it is never
// colour alone.
export function NavPresence() {
  const { peers } = useDocState()
  if (peers.length === 0) return null

  return (
    <div className={styles.presence} role="group" aria-label="People here" data-testid="presence">
      {peers.map((peer) => (
        <span
          key={peer.clientId}
          className={styles.avatar}
          style={{ background: peer.color }}
          title={peer.name}
          role="img"
          aria-label={peer.name}
          data-testid={`presence-${peer.name}`}
        >
          {peer.name.slice(0, 1).toUpperCase()}
        </span>
      ))}
    </div>
  )
}
