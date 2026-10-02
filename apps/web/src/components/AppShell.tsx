'use client'

import Link from 'next/link'
import { useCallback, useState, type ReactNode } from 'react'
import type { SessionUser } from '@/lib/current-user'
import type { WorkspaceMemberView } from '@/lib/members'
import { NavTabs } from './NavTabs'
import { ShareContext } from './share-context'
import { ShareSheet } from './ShareSheet'
import { UserMenu } from './UserMenu'
import { Button } from './ui/Button'
import styles from './app-shell.module.css'

export type NavDocument = { id: string; title: string; type: 'doc' | 'board' }

// A client component: every prop below crosses the server/client boundary, so each
// must be serialisable. Plain strings, booleans and arrays of them: no Date, no
// functions, no Prisma rows.
export function AppShell({
  user,
  workspace,
  documents,
  activeDocumentId,
  members = [],
  canManage = false,
  children,
}: {
  user: SessionUser
  /** Omitted on the dashboard, where there is no workspace in context. */
  workspace?: { id: string; name: string }
  documents?: NavDocument[]
  activeDocumentId?: string
  /** The workspace's members, for the share sheet. */
  members?: WorkspaceMemberView[]
  /** Whether the viewer may invite people and change roles (workspace owners). */
  canManage?: boolean
  children: ReactNode
}) {
  // Which overlay is open, if any. One slot rather than a boolean per overlay, so
  // opening one can never leave another open behind it.
  const [overlay, setOverlay] = useState<'share' | null>(null)
  // Stable identity: this goes into a context, and a new function every render
  // would re-render every consumer every render.
  const openShare = useCallback(() => setOverlay('share'), [])
  const closeOverlay = useCallback(() => setOverlay(null), [])

  return (
    <ShareContext.Provider value={workspace ? openShare : noop}>
      <div className={styles.shell}>
        <div className={styles.navWrap}>
          <nav className={styles.nav} aria-label="Primary">
            <Link href="/" aria-label="All workspaces">
              <span className={styles.logo} />
            </Link>

            {workspace && (
              <>
                <Link
                  className={styles.workspaceName}
                  href={`/workspaces/${workspace.id}`}
                  title={workspace.name}
                  data-testid="workspace-link"
                >
                  {workspace.name}
                </Link>
                <span className={styles.divider} />
              </>
            )}

            {workspace && documents ? (
              <NavTabs
                workspaceId={workspace.id}
                documents={documents}
                activeDocumentId={activeDocumentId}
              />
            ) : (
              <div className={styles.tabsSlot} />
            )}

            {/*
              Rendered to spec but inert until Plan 5 builds the palette. Marked
              aria-disabled so it does not advertise an action that does nothing.
            */}
            <div className={styles.search} aria-disabled="true" title="Coming soon">
              <span className={styles.searchLabel}>Search</span>
              <span className={styles.kbd}>⌘K</span>
            </div>

            {/* Plan 2 fills this with the status pill. */}

            {workspace && (
              <Button variant="accent" onClick={openShare} data-testid="share">
                Share
              </Button>
            )}

            <UserMenu user={user} />
          </nav>
        </div>

        <main className={styles.content}>{children}</main>

        {/*
          Outside the nav on purpose: the nav has a backdrop-filter, which makes it
          the containing block for any position:fixed descendant. Rendered inside
          it, the overlay would be confined to the nav's 56px bar instead of
          covering the viewport.
        */}
        {workspace && overlay === 'share' && (
          <ShareSheet
            workspaceId={workspace.id}
            workspaceName={workspace.name}
            members={members}
            canManage={canManage}
            onClose={closeOverlay}
          />
        )}
      </div>
    </ShareContext.Provider>
  )
}

function noop() {}
