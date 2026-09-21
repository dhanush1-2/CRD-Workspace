import Link from 'next/link'
import type { ReactNode } from 'react'
import { colorFor } from '@/lib/color'
import type { SessionUser } from '@/lib/current-user'
import { SignOutButton } from './SignOutButton'
import styles from './app-shell.module.css'

export function AppShell({
  user,
  breadcrumb,
  children,
}: {
  user: SessionUser
  breadcrumb?: ReactNode
  children: ReactNode
}) {
  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        <Link className={styles.brand} href="/">
          CRDT Workspace
        </Link>
        {breadcrumb && <nav className={styles.breadcrumb}>{breadcrumb}</nav>}
        <div className={styles.spacer} />
        {/*
          colorFor is the same helper the presence cursors use, so the colour on
          your avatar here is the colour collaborators see next to your edits.
        */}
        <span
          className={styles.avatar}
          style={{ background: colorFor(user.id) }}
          aria-hidden="true"
        >
          {user.name.slice(0, 1).toUpperCase()}
        </span>
        <span className={styles.userName} data-testid="current-user">
          {user.name}
        </span>
        <SignOutButton />
      </header>
      <div className={styles.content}>{children}</div>
    </div>
  )
}
