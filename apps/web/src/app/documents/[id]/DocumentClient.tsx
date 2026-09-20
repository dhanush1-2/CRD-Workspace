'use client'

import { useCollaborativeDoc } from '@/hooks/use-doc'
import { Board } from '@/components/Board'

export function DocumentClient({
  documentId,
  type,
  readOnly,
}: {
  documentId: string
  type: 'doc' | 'board'
  readOnly: boolean
}) {
  const { doc, status } = useCollaborativeDoc(documentId)

  return (
    <main>
      <header style={{ padding: '12px 16px', borderBottom: '1px solid #e4e4e7' }}>
        <span data-testid="status">{status}</span>
        {readOnly && <strong style={{ marginLeft: 12 }}>read only</strong>}
      </header>
      {doc && type === 'board' && <Board doc={doc} readOnly={readOnly} />}
    </main>
  )
}
