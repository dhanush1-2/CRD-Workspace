'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { NavDocument } from './AppShell'
import styles from './command-palette.module.css'

type Item = { id: string; label: string; kind: string; run: () => void }

export function CommandPalette({
  workspace,
  documents,
  workspaces,
  onClose,
  onOpenShare,
}: {
  workspace?: { id: string; name: string }
  documents?: NavDocument[]
  workspaces?: { id: string; name: string }[]
  onClose: () => void
  onOpenShare?: () => void
}) {
  const router = useRouter()
  const [query, setQuery] = useState('')
  const [index, setIndex] = useState(0)
  const input = useRef<HTMLInputElement>(null)

  const items = useMemo<Item[]>(() => {
    const go = (href: string) => () => {
      onClose()
      router.push(href)
    }
    const list: Item[] = []
    for (const document of documents ?? []) {
      list.push({
        id: `doc-${document.id}`,
        label: document.title,
        kind: document.type === 'board' ? 'Board' : 'Page',
        run: go(`/documents/${document.id}`),
      })
    }
    for (const entry of workspaces ?? []) {
      list.push({
        id: `ws-${entry.id}`,
        label: entry.name,
        kind: 'Workspace',
        run: go(`/workspaces/${entry.id}`),
      })
    }
    if (workspace) {
      list.push({ id: 'overview', label: 'Overview', kind: 'Go', run: go(`/workspaces/${workspace.id}`) })
    }
    list.push({ id: 'dashboard', label: 'All workspaces', kind: 'Go', run: go('/') })
    if (workspace && onOpenShare) {
      list.push({
        id: 'share',
        label: 'Share',
        kind: 'Action',
        run: () => {
          onClose()
          onOpenShare()
        },
      })
    }
    return list
  }, [documents, workspaces, workspace, onOpenShare, onClose, router])

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    return q ? items.filter((item) => item.label.toLowerCase().includes(q)) : items
  }, [items, query])

  // Clamp rather than reset: typing narrows the list, and an index past the end
  // would leave nothing selected and make Enter a no-op.
  const selected = Math.min(index, Math.max(shown.length - 1, 0))

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null
    input.current?.focus()
    return () => opener?.focus()
  }, [])

  return (
    <div
      className={styles.overlay}
      data-testid="palette-overlay"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div className={styles.sheet} role="dialog" aria-modal="true" aria-label="Search" data-testid="palette">
        <input
          className={styles.input}
          ref={input}
          value={query}
          placeholder="Search documents and actions"
          aria-label="Search documents and actions"
          role="combobox"
          aria-expanded="true"
          aria-controls="palette-list"
          aria-activedescendant={shown[selected] ? `palette-item-${shown[selected]!.id}` : undefined}
          data-testid="palette-input"
          onChange={(event) => {
            setQuery(event.target.value)
            setIndex(0)
          }}
          onKeyDown={(event) => {
            if (event.key === 'Escape') return onClose()
            if (event.key === 'ArrowDown') {
              event.preventDefault()
              setIndex((value) => (shown.length === 0 ? 0 : (value + 1) % shown.length))
            } else if (event.key === 'ArrowUp') {
              event.preventDefault()
              setIndex((value) => (shown.length === 0 ? 0 : (value - 1 + shown.length) % shown.length))
            } else if (event.key === 'Enter') {
              event.preventDefault()
              shown[selected]?.run()
            }
          }}
        />

        {shown.length === 0 ? (
          <p className={styles.empty}>No matches</p>
        ) : (
          <ul className={styles.list} id="palette-list" role="listbox" aria-label="Results">
            {shown.map((item, position) => (
              <li
                className={`${styles.item} ${position === selected ? styles.itemOn : ''}`}
                key={item.id}
                id={`palette-item-${item.id}`}
                role="option"
                aria-selected={position === selected}
                data-testid={`palette-item-${item.id}`}
                onPointerDown={(event) => {
                  event.preventDefault()
                  item.run()
                }}
              >
                {item.label}
                <span className={styles.kind}>{item.kind}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
