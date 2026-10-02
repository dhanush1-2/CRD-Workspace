'use client'

import type { PresenceUser } from '@/hooks/use-presence'
import styles from './board.module.css'

export function CardPresence({ users, cardId }: { users: PresenceUser[]; cardId: string }) {
  const here = users.filter((user) => user.cardId === cardId)
  if (here.length === 0) return null

  return (
    <div data-testid={`card-presence-${cardId}`} className={styles.peers}>
      {here.map((user) => (
        <span className={styles.peerChip} key={user.clientId}>
          <span className={styles.peerAvatar} style={{ background: user.color }} aria-hidden="true">
            {user.name.slice(0, 1).toUpperCase()}
          </span>
          {user.name}
        </span>
      ))}
    </div>
  )
}
