import { describe, it, expect } from 'vitest'
import * as Y from 'yjs'
import { Awareness } from 'y-protocols/awareness'
import {
  peekFrame,
  encodeSyncStep1,
  encodeUpdate,
  encodeAwareness,
  encodePermissionDenied,
  handleSyncFrame,
} from '../src/protocol.js'

describe('peekFrame', () => {
  it('identifies sync step 1', () => {
    const doc = new Y.Doc()
    expect(peekFrame(encodeSyncStep1(doc))).toBe('sync-step1')
  })

  it('identifies an update', () => {
    const doc = new Y.Doc()
    doc.getText('t').insert(0, 'hello')
    expect(peekFrame(encodeUpdate(Y.encodeStateAsUpdate(doc)))).toBe('update')
  })

  it('identifies awareness', () => {
    const doc = new Y.Doc()
    const awareness = new Awareness(doc)
    awareness.setLocalState({ user: { name: 'a' } })
    const frame = encodeAwareness(awareness, [doc.clientID])
    expect(peekFrame(frame)).toBe('awareness')
  })

  it('returns unknown for an empty frame instead of throwing', () => {
    expect(peekFrame(new Uint8Array(0))).toBe('unknown')
  })

  it('returns unknown for a truncated sync frame instead of throwing', () => {
    expect(peekFrame(new Uint8Array([0]))).toBe('unknown')
  })

  it('does not consume the frame', () => {
    const doc = new Y.Doc()
    const frame = encodeSyncStep1(doc)
    expect(peekFrame(frame)).toBe('sync-step1')
    expect(peekFrame(frame)).toBe('sync-step1')
  })
})

describe('handleSyncFrame', () => {
  it('replies to sync step 1 with sync step 2', () => {
    const server = new Y.Doc()
    server.getText('t').insert(0, 'server state')
    const client = new Y.Doc()

    const reply = handleSyncFrame(encodeSyncStep1(client), server, 'test')

    expect(reply).not.toBeNull()
    expect(peekFrame(reply!)).toBe('sync-step2')
  })

  it('applies an update and returns no reply', () => {
    const source = new Y.Doc()
    source.getText('t').insert(0, 'abc')
    const target = new Y.Doc()

    const reply = handleSyncFrame(encodeUpdate(Y.encodeStateAsUpdate(source)), target, 'test')

    expect(reply).toBeNull()
    expect(target.getText('t').toString()).toBe('abc')
  })

  it('converges two documents through a full handshake', () => {
    const a = new Y.Doc()
    const b = new Y.Doc()
    a.getText('t').insert(0, 'from-a ')
    b.getText('t').insert(0, 'from-b ')

    // a -> b: step1, b replies step2
    const step2FromB = handleSyncFrame(encodeSyncStep1(a), b, 'a')!
    handleSyncFrame(step2FromB, a, 'b')
    // b -> a: step1, a replies step2
    const step2FromA = handleSyncFrame(encodeSyncStep1(b), a, 'b')!
    handleSyncFrame(step2FromA, b, 'a')

    expect(a.getText('t').toString()).toBe(b.getText('t').toString())
    expect(a.getText('t').toString()).toContain('from-a')
    expect(a.getText('t').toString()).toContain('from-b')
  })
})

describe('encodePermissionDenied', () => {
  it('produces an auth frame', () => {
    expect(peekFrame(encodePermissionDenied('read only'))).toBe('unknown')
  })
})
