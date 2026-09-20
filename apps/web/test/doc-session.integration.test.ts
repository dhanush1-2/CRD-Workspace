import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { WebSocket } from 'ws'
import { signDocToken } from '@crdt/shared/doc-token'
import { createSyncServer, type SyncServer } from '@crdt/sync/server'
// Imported via the `@` alias (rather than a relative path) specifically to prove the
// alias resolves under Vitest — use-doc.ts and later tasks' route handlers depend on it.
import { createDocSession } from '@/lib/doc-session.js'

const SECRET = 'test-secret-that-is-long-enough!!'
let server: SyncServer

beforeEach(async () => {
  server = await createSyncServer({ port: 0, jwtSecret: SECRET })
})

afterEach(async () => {
  await server.close()
})

function tokenFor(documentId: string, name: string) {
  return () =>
    signDocToken(
      { sub: `usr_${name}`, docId: documentId, role: 'editor', name, color: '#000' },
      SECRET,
    )
}

function eventually(predicate: () => boolean, timeoutMs = 3000): Promise<void> {
  return new Promise((resolve, reject) => {
    const started = Date.now()
    const tick = () => {
      if (predicate()) return resolve()
      if (Date.now() - started > timeoutMs) return reject(new Error('timed out'))
      setTimeout(tick, 20)
    }
    tick()
  })
}

describe('createDocSession', () => {
  it('syncs two sessions on the same document', async () => {
    const options = {
      syncUrl: `ws://127.0.0.1:${server.port}`,
      disableBc: true,
      WebSocketImpl: WebSocket as unknown as typeof globalThis.WebSocket,
    }
    const a = createDocSession({ ...options, documentId: 'doc_1', fetchToken: tokenFor('doc_1', 'a') })
    const b = createDocSession({ ...options, documentId: 'doc_1', fetchToken: tokenFor('doc_1', 'b') })

    a.doc.getText('t').insert(0, 'shared')
    await eventually(() => b.doc.getText('t').toString() === 'shared')

    a.destroy()
    b.destroy()
  })

  it('reports status transitions', async () => {
    const seen: string[] = []
    const session = createDocSession({
      documentId: 'doc_2',
      syncUrl: `ws://127.0.0.1:${server.port}`,
      disableBc: true,
      WebSocketImpl: WebSocket as unknown as typeof globalThis.WebSocket,
      fetchToken: tokenFor('doc_2', 'a'),
    })
    session.onStatus((status) => seen.push(status))

    await eventually(() => seen.includes('connected'))
    session.destroy()
  })

  it('fetches a fresh token on every reconnect', async () => {
    let fetches = 0
    const session = createDocSession({
      documentId: 'doc_3',
      syncUrl: `ws://127.0.0.1:${server.port}`,
      disableBc: true,
      WebSocketImpl: WebSocket as unknown as typeof globalThis.WebSocket,
      fetchToken: async () => {
        fetches += 1
        return tokenFor('doc_3', 'a')()
      },
    })

    await eventually(() => fetches === 1)
    session.provider.disconnect()
    session.provider.connect()
    await eventually(() => fetches >= 2)

    session.destroy()
  })
})
