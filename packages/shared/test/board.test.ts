import { describe, it, expect } from 'vitest'
import * as Y from 'yjs'
import {
  addCard, addColumn, listCards, listColumns, moveCard, removeCard, renameCard,
} from '../src/board.js'

function board(): Y.Doc {
  const doc = new Y.Doc()
  addColumn(doc, { id: 'todo', title: 'To do' })
  addColumn(doc, { id: 'doing', title: 'Doing' })
  return doc
}

/** Exchange all state both ways, the way the sync server would. */
function sync(a: Y.Doc, b: Y.Doc): void {
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a, Y.encodeStateVector(b)))
  Y.applyUpdate(a, Y.encodeStateAsUpdate(b, Y.encodeStateVector(a)))
}

describe('board', () => {
  it('lists columns in insertion order', () => {
    const doc = board()
    expect(listColumns(doc).map((c) => c.id)).toEqual(['todo', 'doing'])
  })

  it('adds cards to a column in order', () => {
    const doc = board()
    addCard(doc, { id: 'c1', title: 'first', columnId: 'todo' })
    addCard(doc, { id: 'c2', title: 'second', columnId: 'todo', afterCardId: 'c1' })

    expect(listCards(doc, 'todo').map((c) => c.title)).toEqual(['first', 'second'])
  })

  it('inserts between two cards without touching their keys', () => {
    const doc = board()
    addCard(doc, { id: 'c1', title: 'first', columnId: 'todo' })
    addCard(doc, { id: 'c3', title: 'third', columnId: 'todo', afterCardId: 'c1' })
    const before = listCards(doc, 'todo').map((c) => c.order)

    addCard(doc, { id: 'c2', title: 'second', columnId: 'todo', afterCardId: 'c1' })

    const after = listCards(doc, 'todo')
    expect(after.map((c) => c.title)).toEqual(['first', 'second', 'third'])
    expect(after[0]!.order).toBe(before[0]!)
    expect(after[2]!.order).toBe(before[1]!)
  })

  it('moves a card to another column', () => {
    const doc = board()
    addCard(doc, { id: 'c1', title: 'first', columnId: 'todo' })
    moveCard(doc, 'c1', { columnId: 'doing' })

    expect(listCards(doc, 'todo')).toHaveLength(0)
    expect(listCards(doc, 'doing').map((c) => c.id)).toEqual(['c1'])
  })

  it('keeps a concurrent rename when the same card is moved elsewhere', () => {
    const a = board()
    addCard(a, { id: 'c1', title: 'original', columnId: 'todo' })
    const b = new Y.Doc()
    sync(a, b)

    moveCard(a, 'c1', { columnId: 'doing' })
    renameCard(b, 'c1', 'renamed')
    sync(a, b)

    for (const doc of [a, b]) {
      const card = listCards(doc, 'doing')[0]
      expect(card?.title).toBe('renamed')
      expect(card?.columnId).toBe('doing')
    }
  })

  it('converges when two replicas move the same card to different columns', () => {
    const a = board()
    addColumn(a, { id: 'done', title: 'Done' })
    addCard(a, { id: 'c1', title: 'contested', columnId: 'todo' })
    const b = new Y.Doc()
    sync(a, b)

    moveCard(a, 'c1', { columnId: 'doing' })
    moveCard(b, 'c1', { columnId: 'done' })
    sync(a, b)

    const columnsA = listColumns(a).map((c) => c.id)
    const placementsA = columnsA.flatMap((id) => listCards(a, id).map((c) => `${id}:${c.id}`))
    const placementsB = columnsA.flatMap((id) => listCards(b, id).map((c) => `${id}:${c.id}`))

    expect(placementsA).toEqual(placementsB)
    // The card exists exactly once across the whole board on both replicas.
    expect(placementsA.filter((p) => p.endsWith(':c1'))).toHaveLength(1)
  })

  it('converges when two replicas insert at the same position', () => {
    const a = board()
    addCard(a, { id: 'anchor', title: 'anchor', columnId: 'todo' })
    const b = new Y.Doc()
    sync(a, b)

    addCard(a, { id: 'from-a', title: 'from a', columnId: 'todo', afterCardId: 'anchor' })
    addCard(b, { id: 'from-b', title: 'from b', columnId: 'todo', afterCardId: 'anchor' })
    sync(a, b)

    expect(listCards(a, 'todo').map((c) => c.id)).toEqual(listCards(b, 'todo').map((c) => c.id))
    expect(listCards(a, 'todo')).toHaveLength(3)
  })

  it('breaks ties on card id so ordering is identical everywhere', () => {
    const a = board()
    const b = new Y.Doc()
    sync(a, b)

    // Force identical order keys by adding the first card on both replicas.
    addCard(a, { id: 'zzz', title: 'z', columnId: 'todo' })
    addCard(b, { id: 'aaa', title: 'a', columnId: 'todo' })
    sync(a, b)

    expect(listCards(a, 'todo').map((c) => c.id)).toEqual(['aaa', 'zzz'])
    expect(listCards(b, 'todo').map((c) => c.id)).toEqual(['aaa', 'zzz'])
  })

  it('removes a card', () => {
    const doc = board()
    addCard(doc, { id: 'c1', title: 'gone', columnId: 'todo' })
    removeCard(doc, 'c1')
    expect(listCards(doc, 'todo')).toHaveLength(0)
  })

  it('ignores operations on a card that does not exist', () => {
    const doc = board()
    expect(() => moveCard(doc, 'missing', { columnId: 'doing' })).not.toThrow()
    expect(() => renameCard(doc, 'missing', 'x')).not.toThrow()
    expect(() => removeCard(doc, 'missing')).not.toThrow()
  })
})
