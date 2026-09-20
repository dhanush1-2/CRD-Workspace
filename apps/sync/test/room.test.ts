import { describe, it, expect, vi } from 'vitest'
import * as Y from 'yjs'
import { DocumentRoom, LOAD_ORIGIN, type Connection } from '../src/room.js'
import { encodeSyncStep1, encodeUpdate, handleSyncFrame, peekFrame } from '../src/protocol.js'
import type { Role } from '@crdt/shared/types'

function fakeConnection(id: string, role: Role = 'editor') {
  const sent: Uint8Array[] = []
  const closed: Array<{ code: number; reason: string }> = []
  const conn: Connection = {
    id,
    userId: `usr_${id}`,
    role,
    send: (data) => { sent.push(data) },
    close: (code, reason) => { closed.push({ code, reason }) },
  }
  return { conn, sent, closed }
}

describe('DocumentRoom', () => {
  it('relays an editor update to peers but not back to the sender', () => {
    const room = new DocumentRoom('doc_1', { onPersist: () => {} })
    const a = fakeConnection('a')
    const b = fakeConnection('b')
    room.add(a.conn)
    room.add(b.conn)

    const source = new Y.Doc()
    source.getText('t').insert(0, 'hello')
    room.handleFrame(a.conn, encodeUpdate(Y.encodeStateAsUpdate(source)))

    expect(a.sent).toHaveLength(0)
    expect(b.sent).toHaveLength(1)
    expect(peekFrame(b.sent[0]!)).toBe('update')
    expect(room.doc.getText('t').toString()).toBe('hello')
  })

  it('answers sync-step1 on the sender connection only', () => {
    const room = new DocumentRoom('doc_1', { onPersist: () => {} })
    room.doc.getText('t').insert(0, 'server state')
    const a = fakeConnection('a')
    const b = fakeConnection('b')
    room.add(a.conn)
    room.add(b.conn)

    room.handleFrame(a.conn, encodeSyncStep1(new Y.Doc()))

    expect(a.sent.map(peekFrame)).toContain('sync-step2')
    expect(b.sent).toHaveLength(0)
  })

  it('calls onPersist once per applied update with the sender id', () => {
    const onPersist = vi.fn()
    const room = new DocumentRoom('doc_1', { onPersist })
    const a = fakeConnection('a')
    room.add(a.conn)

    const source = new Y.Doc()
    source.getText('t').insert(0, 'x')
    room.handleFrame(a.conn, encodeUpdate(Y.encodeStateAsUpdate(source)))

    expect(onPersist).toHaveBeenCalledTimes(1)
    expect(onPersist.mock.calls[0]![1]).toBe('a')
  })

  it('does not persist state loaded from storage', () => {
    const onPersist = vi.fn()
    const room = new DocumentRoom('doc_1', { onPersist })

    const stored = new Y.Doc()
    stored.getText('t').insert(0, 'from disk')
    room.loadState(Y.encodeStateAsUpdate(stored))

    expect(onPersist).not.toHaveBeenCalled()
    expect(room.doc.getText('t').toString()).toBe('from disk')
  })

  it('drops a viewer update: no peer relay, no persistence, permission denied sent', () => {
    const onPersist = vi.fn()
    const room = new DocumentRoom('doc_1', { onPersist })
    const viewer = fakeConnection('v', 'viewer')
    const editor = fakeConnection('e', 'editor')
    room.add(viewer.conn)
    room.add(editor.conn)

    const source = new Y.Doc()
    source.getText('t').insert(0, 'sneaky')
    room.handleFrame(viewer.conn, encodeUpdate(Y.encodeStateAsUpdate(source)))

    expect(room.doc.getText('t').toString()).toBe('')
    expect(editor.sent).toHaveLength(0)
    expect(onPersist).not.toHaveBeenCalled()
    expect(viewer.sent).toHaveLength(1) // the permission-denied frame
  })

  it('drops a viewer handshake sync-step2 without sending anything back', () => {
    const room = new DocumentRoom('doc_1', { onPersist: () => {} })
    const viewer = fakeConnection('v', 'viewer')
    room.add(viewer.conn)

    const client = new Y.Doc()
    const step2 = handleSyncFrame(encodeSyncStep1(room.doc), client, 'test')!
    room.handleFrame(viewer.conn, step2)

    expect(viewer.sent).toHaveLength(0)
  })

  it('reports size and stops relaying to removed connections', () => {
    const room = new DocumentRoom('doc_1', { onPersist: () => {} })
    const a = fakeConnection('a')
    const b = fakeConnection('b')
    room.add(a.conn)
    room.add(b.conn)
    expect(room.size).toBe(2)

    room.remove(b.conn)
    expect(room.size).toBe(1)

    const source = new Y.Doc()
    source.getText('t').insert(0, 'y')
    room.handleFrame(a.conn, encodeUpdate(Y.encodeStateAsUpdate(source)))
    expect(b.sent).toHaveLength(0)
  })

  it('survives a malformed frame without throwing', () => {
    const room = new DocumentRoom('doc_1', { onPersist: () => {} })
    const a = fakeConnection('a')
    room.add(a.conn)

    expect(() => room.handleFrame(a.conn, new Uint8Array([200, 200, 200]))).not.toThrow()
    expect(room.size).toBe(1)
  })
})
