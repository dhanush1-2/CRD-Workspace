import type { ReactNode } from 'react'
import styles from './ui.module.css'

export function Panel({
  title,
  action,
  children,
}: {
  title?: string
  action?: ReactNode
  children: ReactNode
}) {
  return (
    <section className={`${styles.glass} ${styles.panel}`}>
      {(title ?? action) && (
        <header className={styles.panelHeader}>
          {title ? <h2>{title}</h2> : <span />}
          {action}
        </header>
      )}
      <div className={styles.panelBody}>{children}</div>
    </section>
  )
}
