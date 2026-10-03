'use client'

import Link from 'next/link'
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import type { Role } from '@crdt/shared/types'
import type { SessionUser } from '@/lib/current-user'
import type { WorkspaceMemberView } from '@/lib/members'
import { CommandPalette } from './CommandPalette'
import { NavPresence } from './NavPresence'
import { NavTabs } from './NavTabs'
import { ShareContext } from './share-context'
import { ShareSheet } from './ShareSheet'
import { SyncStatus } from './SyncStatus'
import { UserMenu } from './UserMenu'
import { Button } from './ui/Button'
import styles from './app-shell.module.css'
import ui from './ui/ui.module.css'

export type NavDocument = { id: string; title: string; type: 'doc' | 'board' }

// A client component: every prop below crosses the server/client boundary, so each
// must be serialisable. Plain strings, booleans and arrays of them: no Date, no
// functions, no Prisma rows.
export function AppShell({
  user,
  workspace,
  documents,
  workspaces,
  activeDocumentId,
  members = [],
  canManage = false,
  role,
  children,
}: {
  user: SessionUser
  /** Omitted on the dashboard, where there is no workspace in context. */
  workspace?: { id: string; name: string }
  documents?: NavDocument[]
  /** Every workspace, for the palette on the dashboard where there is no current one. */
  workspaces?: { id: string; name: string }[]
  activeDocumentId?: string
  /** The workspace's members, for the share sheet. */
  members?: WorkspaceMemberView[]
  /** Whether the viewer may invite people and change roles (workspace owners). */
  canManage?: boolean
  /** The viewer's role here. Omitted on the dashboard, which has no single role. */
  role?: Role
  children: ReactNode
}) {
  // Which overlay is open, if any. One slot rather than a boolean per overlay, so
  // opening one can never leave another open behind it.
  const [overlay, setOverlay] = useState<'share' | 'palette' | null>(null)
  // Stable identity: this goes into a context, and a new function every render
  // would re-render every consumer every render.
  const openShare = useCallback(() => setOverlay('share'), [])
  const openPalette = useCallback(() => setOverlay('palette'), [])
  const closeOverlay = useCallback(() => setOverlay(null), [])
  // Passed to the palette as its focus fallback. A ref rather than a data-testid
  // lookup, so production focus behaviour does not depend on a test hook.
  const searchButton = useRef<HTMLButtonElement>(null)

  // Meta on a Mac, Control elsewhere (the e2e suite also runs on Linux CI).
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key === 'k') {
        event.preventDefault()
        setOverlay('palette')
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

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
              /* No workspace in context, so there are no tabs. The bar is now sized to
                 its contents, so an unlabelled slot here would be a visible hole. */
              <div className={styles.tabsSlot}>
                <span className={styles.navContext} data-testid="nav-context">
                  Workspaces
                </span>
              </div>
            )}

            {role === 'viewer' && (
              <span className={`${ui.chip} ${styles.viewOnly}`} data-testid="view-only">
                View only
              </span>
            )}

            <button
              type="button"
              ref={searchButton}
              className={styles.search}
              onClick={openPalette}
              aria-label="Search"
              aria-keyshortcuts="Meta+K Control+K"
              data-testid="search"
            >
              <span className={styles.searchLabel}>Search</span>
              <span className={styles.kbd}>⌘K</span>
            </button>

            <SyncStatus />
            <NavPresence />

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
        {overlay === 'palette' && (
          <CommandPalette
            workspace={workspace}
            documents={documents}
            workspaces={workspaces}
            onClose={closeOverlay}
            onOpenShare={workspace ? openShare : undefined}
            fallbackFocus={searchButton}
          />
        )}

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
