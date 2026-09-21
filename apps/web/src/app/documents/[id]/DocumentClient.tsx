'use client'

import Link from 'next/link'
import type { Role } from '@crdt/shared/types'
import { useCollaborativeDoc } from '@/hooks/use-doc'
import { useAnnouncePresence, usePresence } from '@/hooks/use-presence'
import { Board } from '@/components/Board'
import { Editor } from '@/components/Editor'
import { Presence } from '@/components/Presence'
import styles from './document.module.css'
import ui from '@/components/ui/ui.module.css'

export function DocumentClient({
  documentId,
  type,
  role,
  readOnly,
  title,
  workspace,
  user,
}: {
  documentId: string
  type: 'doc' | 'board'
  role: Role
  readOnly: boolean
  title: string
  workspace: { id: string; name: string }
  user: { name: string; color: string }
}) {
  const { doc, provider, status } = useCollaborativeDoc(documentId)
  const presence = usePresence(provider)
  useAnnouncePresence(provider, user)

  return (
    <main>
      <header className={styles.header}>
        <Link className={styles.back} href={`/workspaces/${workspace.id}`} data-testid="workspace-link">
          {workspace.name}
        </Link>
        <h1 className={styles.title} data-testid="document-title">
          {title}
        </h1>
        <span className={ui.badge} data-testid="role">
          {role}
        </span>
        <div className={styles.spacer} />
        <Presence users={presence} />
        {/*
          collaboration.spec.ts asserts getByTestId('status') toHaveText('connected').
          The status string stays this element's entire text content — the colour
          comes from the data-status attribute, not from any extra markup.
        */}
        <span className={styles.status} data-status={status} data-testid="status">
          {status}
        </span>
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
    </main>
  )
}
