'use client'

import { useCallback, useRef, useSyncExternalStore } from 'react'
import type * as Y from 'yjs'
import { listCards, listColumns, type CardView, type ColumnView } from '@crdt/shared/board'

export interface BoardSnapshot {
  columns: ColumnView[]
  cardsByColumn: Map<string, CardView[]>
}

const EMPTY: BoardSnapshot = { columns: [], cardsByColumn: new Map() }

function build(doc: Y.Doc): BoardSnapshot {
  const columns = listColumns(doc)
  const cardsByColumn = new Map<string, CardView[]>()
  for (const column of columns) cardsByColumn.set(column.id, listCards(doc, column.id))
  return { columns, cardsByColumn }
}

/**
 * Yjs is the store; React just reads it. The version counter exists because
 * getSnapshot must return a referentially stable value between updates, and
 * build() allocates a new object every call.
 */
export function useBoard(doc: Y.Doc | null): BoardSnapshot {
  const version = useRef(0)
  const cache = useRef<{ version: number; value: BoardSnapshot } | null>(null)

  const subscribe = useCallback(
    (onChange: () => void) => {
      if (!doc) return () => {}
      const handler = () => {
        version.current += 1
        onChange()
      }
      doc.on('update', handler)
      return () => doc.off('update', handler)
    },
    [doc],
  )

  const getSnapshot = useCallback(() => {
    if (!doc) return EMPTY
    if (!cache.current || cache.current.version !== version.current) {
      cache.current = { version: version.current, value: build(doc) }
    }
    return cache.current.value
  }, [doc])

  return useSyncExternalStore(subscribe, getSnapshot, () => EMPTY)
}
