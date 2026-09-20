'use client'

import { useCollaborativeDoc } from '@/hooks/use-doc'
import { useAnnouncePresence, usePresence } from '@/hooks/use-presence'
import { Board } from '@/components/Board'
import { Editor } from '@/components/Editor'
import { Presence } from '@/components/Presence'

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

  return (
    <main>
      <header
        style={{
          display: 'flex',
          gap: 12,
          alignItems: 'center',
          padding: '12px 16px',
          borderBottom: '1px solid #e4e4e7',
        }}
      >
        <span data-testid="status">{status}</span>
        {readOnly && <strong data-testid="read-only">read only</strong>}
        <Presence users={presence} />
      </header>

      {doc && provider && type === 'doc' && (
        <Editor doc={doc} provider={provider} user={user} readOnly={readOnly} />
      )}
      {doc && type === 'board' && <Board doc={doc} provider={provider} readOnly={readOnly} />}
    </main>
  )
}
