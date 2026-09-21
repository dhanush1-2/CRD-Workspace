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

  it('bounds reconnect attempts after a terminal close and reports a fatal status', async () => {
    // A server that will fatally reject every connection, no matter how fresh the
    // token, mirrors a real SYNC_JWT_SECRET mismatch between deployed processes: the
    // fetched token is genuinely valid, just not for *this* server, so every attempt
    // ends in a 4401 close that y-websocket never retries on its own.
    const mismatchedSecret = 'a-totally-different-secret-value!!'
    const badServer = await createSyncServer({ port: 0, jwtSecret: mismatchedSecret })
    let fetchCount = 0

    try {
      const session = createDocSession({
        documentId: 'doc_fatal',
        syncUrl: `ws://127.0.0.1:${badServer.port}`,
        disableBc: true,
        WebSocketImpl: WebSocket as unknown as typeof globalThis.WebSocket,
        tokenRetryDelayMs: 5,
        fatalBackoffBaseMs: 5,
        fatalMaxDelayMs: 20,
        fatalMaxAttempts: 4,
        fetchToken: async () => {
          fetchCount += 1
          return tokenFor('doc_fatal', 'x')()
        },
      })

      const statuses: string[] = []
      session.onStatus((status) => statuses.push(status))

      await eventually(() => statuses.includes('fatal'), 3000)

      const countAtFatal = fetchCount
      // Give the old, unbackoffed code plenty of time to prove it would have kept
      // going — this window alone was enough to produce thousands of requests before
      // the fix.
      await new Promise((r) => setTimeout(r, 200))

      expect(fetchCount).toBe(countAtFatal)
      expect(fetchCount).toBeLessThan(20)

      session.destroy()
    } finally {
      await badServer.close()
    }
  }, 5000)
})
