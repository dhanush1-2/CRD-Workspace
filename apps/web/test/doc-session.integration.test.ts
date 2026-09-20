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
    // Distinguishable tokens (not just a call count) so the assertion can check the
    // *value* actually carried in `provider.params`, not merely that fetchToken ran
    // twice — `provider.connect()` reads `params` synchronously, while the refresh
    // that repopulates it is async, so only checking the call count would pass even
    // if the stale first token were the one still in `params`.
    const issued: string[] = []
    const session = createDocSession({
      documentId: 'doc_3',
      syncUrl: `ws://127.0.0.1:${server.port}`,
      disableBc: true,
      WebSocketImpl: WebSocket as unknown as typeof globalThis.WebSocket,
      fetchToken: async () => {
        const token = await tokenFor('doc_3', `a${issued.length}`)()
        issued.push(token)
        return token
      },
    })

    await eventually(() => issued.length === 1)
    const firstToken = issued[0]
    session.provider.disconnect()
    session.provider.connect()
    await eventually(() => issued.length >= 2)
    const secondToken = issued[issued.length - 1]
    expect(secondToken).not.toBe(firstToken)
    await eventually(() => session.provider.params.token === secondToken)

    session.destroy()
  })

  it('recovers from a failed initial token fetch', async () => {
    let attempts = 0
    const flaky = createDocSession({
      documentId: 'doc_4',
      syncUrl: `ws://127.0.0.1:${server.port}`,
      disableBc: true,
      WebSocketImpl: WebSocket as unknown as typeof globalThis.WebSocket,
      tokenRetryDelayMs: 50,
      fetchToken: async () => {
        attempts += 1
        if (attempts === 1) throw new Error('token service unavailable')
        return tokenFor('doc_4', 'a')()
      },
    })
    const steady = createDocSession({
      documentId: 'doc_4',
      syncUrl: `ws://127.0.0.1:${server.port}`,
      disableBc: true,
      WebSocketImpl: WebSocket as unknown as typeof globalThis.WebSocket,
      fetchToken: tokenFor('doc_4', 'b'),
    })

    flaky.doc.getText('t').insert(0, 'recovered')
    await eventually(() => steady.doc.getText('t').toString() === 'recovered', 5000)
    expect(attempts).toBeGreaterThanOrEqual(2)

    flaky.destroy()
    steady.destroy()
  })
})
