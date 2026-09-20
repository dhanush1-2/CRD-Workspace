'use client'

import { useState } from 'react'
import type * as Y from 'yjs'
import { addCard, addColumn, moveCard, removeCard } from '@crdt/shared/board'
import { useBoard } from '@/hooks/use-board'

interface BoardProps {
  doc: Y.Doc
  readOnly?: boolean
}

interface DragPayload {
  cardId: string
}

export function Board({ doc, readOnly = false }: BoardProps) {
  const { columns, cardsByColumn } = useBoard(doc)
  const [dragOver, setDragOver] = useState<string | null>(null)

  function handleDrop(event: React.DragEvent, columnId: string, beforeCardId?: string) {
    event.preventDefault()
    setDragOver(null)
    if (readOnly) return

    const raw = event.dataTransfer.getData('application/x-card')
    if (!raw) return

    let payload: DragPayload
    try {
      payload = JSON.parse(raw) as DragPayload
    } catch {
      return
    }

    moveCard(doc, payload.cardId, { columnId, beforeCardId })
  }

  return (
    <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start', padding: 16 }}>
      {columns.map((column) => (
        <section
          key={column.id}
          data-testid={`column-${column.id}`}
          onDragOver={(event) => {
            event.preventDefault()
            setDragOver(column.id)
          }}
          onDragLeave={() => setDragOver(null)}
          onDrop={(event) => handleDrop(event, column.id)}
          style={{
            width: 260,
            background: dragOver === column.id ? '#eef2ff' : '#f4f4f5',
            borderRadius: 8,
            padding: 12,
          }}
        >
          <h2 style={{ fontSize: 14, margin: '0 0 12px' }}>{column.title}</h2>

          {(cardsByColumn.get(column.id) ?? []).map((card) => (
            <article
              key={card.id}
              data-testid={`card-${card.id}`}
              data-column={column.id}
              draggable={!readOnly}
              onDragStart={(event) => {
                event.dataTransfer.setData(
                  'application/x-card',
                  JSON.stringify({ cardId: card.id } satisfies DragPayload),
                )
                event.dataTransfer.effectAllowed = 'move'
              }}
              onDrop={(event) => {
                event.stopPropagation()
                handleDrop(event, column.id, card.id)
              }}
              style={{
                background: 'white',
                border: '1px solid #e4e4e7',
                borderRadius: 6,
                padding: '8px 10px',
                marginBottom: 8,
                cursor: readOnly ? 'default' : 'grab',
              }}
            >
              <span>{card.title}</span>
              {!readOnly && (
                <button
                  aria-label={`Delete ${card.title}`}
                  onClick={() => removeCard(doc, card.id)}
                  style={{ float: 'right', border: 'none', background: 'none', cursor: 'pointer' }}
                >
                  ×
                </button>
              )}
            </article>
          ))}

          {!readOnly && (
            <button
              data-testid={`add-card-${column.id}`}
              onClick={() =>
                addCard(doc, {
                  id: crypto.randomUUID(),
                  title: 'New card',
                  columnId: column.id,
                })
              }
              style={{ width: '100%', padding: 8, borderRadius: 6, border: '1px dashed #a1a1aa' }}
            >
              + Add card
            </button>
          )}
        </section>
      ))}

      {!readOnly && (
        <button
          data-testid="add-column"
          onClick={() => addColumn(doc, { id: crypto.randomUUID(), title: 'New column' })}
          style={{ padding: 12, borderRadius: 8, border: '1px dashed #a1a1aa' }}
        >
          + Add column
        </button>
      )}
    </div>
  )
}
