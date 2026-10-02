import Link from 'next/link'
import type { ReactNode } from 'react'
import type { SessionUser } from '@/lib/current-user'
import { UserMenu } from './UserMenu'
import { Button } from './ui/Button'
import styles from './app-shell.module.css'

export type NavDocument = { id: string; title: string; type: 'doc' | 'board' }

export function AppShell({
  user,
  workspace,
  children,
}: {
  user: SessionUser
  /** Omitted on the dashboard, where there is no workspace in context. */
  workspace?: { id: string; name: string }
  documents?: NavDocument[]
  activeDocumentId?: string
  children: ReactNode
}) {
  return (
    <div className={styles.shell}>
      <div className={styles.navWrap}>
        <nav className={styles.nav}>
          <Link href="/" aria-label="All workspaces">
            <span className={styles.logo} />
          </Link>

          {workspace && (
            <>
              <Link className={styles.workspaceName} href={`/workspaces/${workspace.id}`}>
                {workspace.name}
              </Link>
              <span className={styles.divider} />
            </>
          )}

          {/* Task 5 renders NavTabs here. */}
          <div className={styles.tabsSlot} />

          {/*
            Rendered to spec but inert until Plan 5 builds the palette. Marked
            aria-disabled so it does not advertise an action that does nothing.
          */}
          <div className={styles.search} aria-disabled="true" title="Coming soon">
            <span className={styles.searchLabel}>Search</span>
            <span className={styles.kbd}>⌘K</span>
          </div>

          {/* Plan 2 fills this with the status pill. */}

          <Button variant="accent" aria-disabled="true" disabled title="Coming soon">
            Share
          </Button>

          <UserMenu user={user} />
        </nav>
      </div>

      <div className={styles.content}>{children}</div>
    </div>
  )
}
