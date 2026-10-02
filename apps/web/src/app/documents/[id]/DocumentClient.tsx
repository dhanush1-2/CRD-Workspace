'use client'

import { useEffect } from 'react'
import { useCollaborativeDoc } from '@/hooks/use-doc'
import { useAnnouncePresence, usePresence } from '@/hooks/use-presence'
import { Board } from '@/components/Board'
import { Editor } from '@/components/Editor'
import { clearDocState, publishDocState } from '@/lib/doc-state'
import styles from './document.module.css'

export function DocumentClient({
  documentId,
  type,
  readOnly,
  user,
}: {
  documentId: string
  type: 'doc' | 'board'
  readOnly: boolean
  user: { name: string; color: string }
}) {
  const { doc, provider, status } = useCollaborativeDoc(documentId)
  const presence = usePresence(provider)
  useAnnouncePresence(provider, user)

  // Deliberately no dependency array: this runs after every render, and the store's
  // equality gate (same() in doc-state.ts) is what makes that cheap, because an
  // identical publish returns before notifying anyone. [documentId, status, presence]
  // would also be correct, since usePresence caches its snapshot by version and the
  // reference only changes when awareness does. Either way it is the gate that keeps
  // this safe, so keep it.
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
    // The sheet is for the document only: the board is a horizontal scroller with its
    // own gutters and would be crushed into a 780px column.
    <div className={type === 'doc' ? styles.page : undefined}>
      {doc && provider && type === 'doc' && (
        <Editor doc={doc} provider={provider} user={user} readOnly={readOnly} />
      )}
      {doc && type === 'board' && <Board doc={doc} provider={provider} readOnly={readOnly} />}
    </div>
  )
}
