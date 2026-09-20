import { describe, it, expect } from 'vitest'
import { guard } from '../src/guard.js'
import type { FrameKind } from '../src/protocol.js'
import type { Role } from '@crdt/shared/types'

const WRITE_KINDS: FrameKind[] = ['sync-step2', 'update']
const READ_KINDS: FrameKind[] = ['sync-step1', 'awareness', 'query-awareness']

describe('guard', () => {
  for (const role of ['owner', 'editor'] as Role[]) {
    it(`allows every legitimate frame for ${role}`, () => {
      for (const kind of [...WRITE_KINDS, ...READ_KINDS]) {
        expect(guard(role, kind).allow, `${role} / ${kind}`).toBe(true)
      }
    })
  }

  it('allows a viewer to read state and publish presence', () => {
    for (const kind of READ_KINDS) {
      expect(guard('viewer', kind).allow, kind).toBe(true)
    }
  })

  it('denies a viewer every write frame', () => {
    for (const kind of WRITE_KINDS) {
      expect(guard('viewer', kind).allow, kind).toBe(false)
    }
  })

  it('notifies a viewer who sends a real update', () => {
    const decision = guard('viewer', 'update')
    expect(decision.allow).toBe(false)
    expect(decision.notify).toBe(true)
    expect(decision.reason).toBe('viewer_update')
  })

  it('silently drops a viewer handshake sync-step2 without notifying', () => {
    // Every y-websocket client answers the server's sync-step1 with a sync-step2,
    // even when it has nothing to contribute. Notifying on that would fire a
    // permission-denied on every single viewer connection.
    const decision = guard('viewer', 'sync-step2')
    expect(decision.allow).toBe(false)
    expect(decision.notify).toBe(false)
    expect(decision.reason).toBe('viewer_sync_step2')
  })

  it('denies unknown frames for every role', () => {
    for (const role of ['owner', 'editor', 'viewer'] as Role[]) {
      const decision = guard(role, 'unknown')
      expect(decision.allow, role).toBe(false)
      expect(decision.reason).toBe('malformed_frame')
    }
  })

  it('denies a frame kind outside the known union instead of allowing it', () => {
    // The compile-time exhaustiveness check cannot fire at runtime; this pins
    // that an unexpected kind is denied rather than falling through to allow.
    for (const role of ['owner', 'editor', 'viewer'] as Role[]) {
      const decision = guard(role, 'future-mutation-frame' as FrameKind)
      expect(decision.allow, role).toBe(false)
    }
  })
})
