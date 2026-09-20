import { createServer, type IncomingMessage, type Server } from 'node:http'
import { randomUUID } from 'node:crypto'
import { WebSocketServer, type WebSocket } from 'ws'
import type * as Y from 'yjs'
import { verifyDocToken } from '@crdt/shared/doc-token'
import { DocumentRoom, type Connection } from './room.js'
import { encodeSyncStep1 } from './protocol.js'
import { Metrics } from './metrics.js'

export interface SyncServerOptions {
  port: number
  jwtSecret: string
  idleEvictMs?: number
  onPersist?(documentId: string, update: Uint8Array, clientId: string): void
  loadDocument?(documentId: string): Promise<Uint8Array | null>
  onDocumentPersisted?(documentId: string, doc: Y.Doc): void | Promise<void>
  onReject?(documentId: string, reason: string): void
  metrics?: Metrics
}

export interface SyncServer {
  readonly port: number
  readonly roomCount: number
  readonly metrics: Metrics
  close(): Promise<void>
}

const MAX_FRAME_BYTES = 1024 * 1024

export async function createSyncServer(options: SyncServerOptions): Promise<SyncServer> {
  const idleEvictMs = options.idleEvictMs ?? 30_000
  const rooms = new Map<string, DocumentRoom>()
  const evictTimers = new Map<string, NodeJS.Timeout>()
  const metrics = options.metrics ?? new Metrics()
  let connectionCount = 0

  const http: Server = createServer((req, res) => {
    if (req.url === '/healthz') {
      res.writeHead(200, { 'content-type': 'text/plain' })
      res.end('ok')
      return
    }
    if (req.url === '/metrics') {
      metrics.set('sync_connections_active', connectionCount)
      metrics.set('sync_documents_open', rooms.size)
      res.writeHead(200, { 'content-type': 'text/plain; version=0.0.4' })
      res.end(metrics.render())
      return
    }
    res.writeHead(404)
    res.end()
  })

  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_FRAME_BYTES })

  async function roomFor(documentId: string): Promise<DocumentRoom> {
    const existing = rooms.get(documentId)
    if (existing) return existing

    // `room` is referenced inside its own constructor's `onPersist` callback below. That
    // is safe because `onPersist` only fires on a later `doc.on('update')` event, never
    // during construction — by the time it runs, `room` has already been assigned.
    const room: DocumentRoom = new DocumentRoom(documentId, {
      onPersist: (update, clientId) => {
        metrics.inc('sync_updates_received_total', { role: 'writer' })
        options.onPersist?.(documentId, update, clientId)
        void Promise.resolve(options.onDocumentPersisted?.(documentId, room.doc)).catch(
          (error: unknown) => {
            console.error(
              JSON.stringify({ level: 'error', msg: 'snapshot failed', documentId, error: String(error) }),
            )
          },
        )
      },
      onReject: (reason) => {
        metrics.inc('sync_updates_rejected_total', { reason })
        options.onReject?.(documentId, reason)
      },
    })
    rooms.set(documentId, room)

    if (options.loadDocument) {
      const started = performance.now()
      const state = await options.loadDocument(documentId)
      metrics.observe('sync_document_load_duration_seconds', (performance.now() - started) / 1000)
      if (state) room.loadState(state)
    }
    return room
  }

  function scheduleEvict(documentId: string): void {
    const existing = evictTimers.get(documentId)
    if (existing) clearTimeout(existing)

    const timer = setTimeout(() => {
      const room = rooms.get(documentId)
      if (room && room.size === 0) {
        room.destroy()
        rooms.delete(documentId)
      }
      evictTimers.delete(documentId)
    }, idleEvictMs)
    timer.unref()
    evictTimers.set(documentId, timer)
  }

  http.on('upgrade', (req, socket, head) => {
    wss.handleUpgrade(req, socket, head, (ws) => {
      // Pause the socket immediately. `onConnection` now awaits real I/O (token
      // verification, and — once a document is loaded from storage — a database round
      // trip) before it attaches the `message` listener below. Node's `ws` starts
      // parsing incoming frames as soon as the upgrade completes, and an emitted
      // 'message' event with no listener is simply lost, not queued. A fast loopback
      // client that sends its sync-step1 frame the instant it opens can otherwise race
      // ahead of that listener and have its first frame silently dropped, hanging the
      // handshake forever. Pausing here and resuming right after the listener is
      // attached closes that window.
      ws.pause()
      void onConnection(ws, req)
    })
  })

  async function onConnection(ws: WebSocket, req: IncomingMessage): Promise<void> {
    // The socket arrives paused (see the 'upgrade' handler). Every early-rejection path
    // below closes the connection without ever reaching the `ws.resume()` call further
    // down, which would otherwise leave the socket paused forever — unable to read the
    // client's close-frame acknowledgement, so the close handshake stalls until ws's own
    // 30s close timeout forces it. Resuming before closing lets it complete immediately.
    const closeEarly = (code: number, reason: string): void => {
      ws.resume()
      ws.close(code, reason)
    }

    try {
      const url = new URL(req.url ?? '/', 'http://localhost')
      // decodeURIComponent throws URIError on a malformed percent-escape (e.g. a lone
      // "%" or "%zz"). That throw must not escape as an unhandled rejection, so it is
      // inside this try, which closes with the permanent 4400 below.
      const documentId = decodeURIComponent(url.pathname.slice(1))
      const token = url.searchParams.get('token')

      if (!documentId) return void closeEarly(4401, 'missing document id')
      if (!token) return void closeEarly(4401, 'missing token')

      let claims
      try {
        claims = await verifyDocToken(token, options.jwtSecret)
      } catch {
        return void closeEarly(4401, 'invalid token')
      }

      if (claims.docId !== documentId) return void closeEarly(4403, 'token document mismatch')

      const room = await roomFor(documentId)
      const evictTimer = evictTimers.get(documentId)
      if (evictTimer) {
        clearTimeout(evictTimer)
        evictTimers.delete(documentId)
      }

      const conn: Connection = {
        id: randomUUID(),
        userId: claims.sub,
        role: claims.role,
        send: (data) => { if (ws.readyState === ws.OPEN) ws.send(data) },
        close: (code, reason) => ws.close(code, reason),
      }

      room.add(conn)
      connectionCount += 1
      // A socket error is typically followed by its own 'close' event once the
      // connection tears down, so both handlers below can fire for the same
      // connection. Decrementing in both unconditionally would double-count;
      // this flag makes the decrement happen exactly once regardless of which
      // event(s) fire.
      let countedConnection = true
      const uncountConnection = (): void => {
        if (!countedConnection) return
        countedConnection = false
        connectionCount -= 1
      }

      ws.on('message', (data: Buffer) => {
        room.handleFrame(conn, new Uint8Array(data.buffer, data.byteOffset, data.byteLength))
      })

      ws.on('close', () => {
        room.remove(conn)
        uncountConnection()
        if (room.size === 0) scheduleEvict(documentId)
      })

      ws.on('error', () => {
        room.remove(conn)
        uncountConnection()
        if (room.size === 0) scheduleEvict(documentId)
      })

      // Safe to let frames flow now that the listener above is attached — see the
      // `ws.pause()` comment in the 'upgrade' handler for why this matters.
      ws.resume()

      // The server opens the sync handshake by advertising its own state vector.
      conn.send(encodeSyncStep1(room.doc))
    } catch {
      // Any parse failure before we can identify the document. Permanent range,
      // so the client stops retrying a request that cannot succeed.
      closeEarly(4400, 'malformed request')
    }
  }

  await new Promise<void>((resolve) => http.listen(options.port, resolve))
  const address = http.address()
  const port = typeof address === 'object' && address ? address.port : options.port

  return {
    port,
    get roomCount() { return rooms.size },
    metrics,
    async close() {
      for (const timer of evictTimers.values()) clearTimeout(timer)
      evictTimers.clear()
      for (const client of wss.clients) client.terminate()
      for (const room of rooms.values()) room.destroy()
      rooms.clear()
      await new Promise<void>((resolve) => wss.close(() => resolve()))
      await new Promise<void>((resolve) => http.close(() => resolve()))
    },
  }
}
