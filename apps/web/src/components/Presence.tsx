'use client'

import type { PresenceUser } from '@/hooks/use-presence'
import styles from './board.module.css'

export function Presence({ users }: { users: PresenceUser[] }) {
  if (users.length === 0) return <span style={{ color: '#71717a' }}>nobody else here</span>

  return (
    <div data-testid="presence" style={{ display: 'flex', gap: 6 }}>
      {users.map((user) => (
        <span
          key={user.clientId}
          title={user.name}
          data-testid={`presence-${user.name}`}
          style={{
            background: user.color,
            color: 'white',
            borderRadius: 999,
            padding: '2px 10px',
            fontSize: 12,
          }}
        >
          {user.name}
        </span>
      ))}
    </div>
  )
}

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
