'use client'

import { useEffect } from 'react'
import type { Role } from '@crdt/shared/types'
import { useCollaborativeDoc } from '@/hooks/use-doc'
import { useAnnouncePresence, usePresence } from '@/hooks/use-presence'
import { Board } from '@/components/Board'
import { Editor } from '@/components/Editor'
import { Presence } from '@/components/Presence'
import { clearDocState, publishDocState } from '@/lib/doc-state'
import { ROLE_LABEL } from '@/lib/role-label'
import styles from './document.module.css'
import ui from '@/components/ui/ui.module.css'

export function DocumentClient({
  documentId,
  type,
  role,
  readOnly,
  user,
}: {
  documentId: string
  type: 'doc' | 'board'
  role: Role
  readOnly: boolean
  user: { name: string; color: string }
}) {
  const { doc, provider, status } = useCollaborativeDoc(documentId)
  const presence = usePresence(provider)
  useAnnouncePresence(provider, user)

  // Deliberately no dependency array. `presence` is a new array on every render, so a
  // dependency list would either lie or re-run anyway. The store's own equality gate
  // (same() in doc-state.ts), not a dep list, is what stops redundant notifies.
  // Adding deps here "to fix the lint" would silently stop peers from publishing.
  useEffect(() => {
    publishDocState({
      documentId,
      status,
      peers: presence.map((peer) => ({
        clientId: peer.clientId,
        name: peer.name,
        color: peer.color,
      })),
    })
  })

  useEffect(() => () => clearDocState(documentId), [documentId])

  return (
    <div>
      <header className={styles.header}>
        <span className={ui.badge} data-testid="role">
          {ROLE_LABEL[role]}
        </span>
        <div className={styles.spacer} />
        <Presence users={presence} />
        {readOnly && (
          <strong className={styles.readOnly} data-testid="read-only">
            read only
          </strong>
        )}
      </header>

      {doc && provider && type === 'doc' && (
        <Editor doc={doc} provider={provider} user={user} readOnly={readOnly} />
      )}
      {doc && type === 'board' && <Board doc={doc} provider={provider} readOnly={readOnly} />}
    </div>
  )
}
