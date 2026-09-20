import { createServer, type IncomingMessage, type Server } from 'node:http'
import { randomUUID } from 'node:crypto'
import { WebSocketServer, type WebSocket } from 'ws'
import { verifyDocToken } from '@crdt/shared/doc-token'
import { DocumentRoom, type Connection } from './room.js'
import { encodeSyncStep1 } from './protocol.js'

export interface SyncServerOptions {
  port: number
  jwtSecret: string
  idleEvictMs?: number
  onPersist?(documentId: string, update: Uint8Array, clientId: string): void
  loadDocument?(documentId: string): Promise<Uint8Array | null>
  onReject?(documentId: string, reason: string): void
}

export interface SyncServer {
  readonly port: number
  readonly roomCount: number
  close(): Promise<void>
}

const MAX_FRAME_BYTES = 1024 * 1024

export async function createSyncServer(options: SyncServerOptions): Promise<SyncServer> {
  const idleEvictMs = options.idleEvictMs ?? 30_000
  const rooms = new Map<string, DocumentRoom>()
  const evictTimers = new Map<string, NodeJS.Timeout>()

  const http: Server = createServer((req, res) => {
    if (req.url === '/healthz') {
      res.writeHead(200, { 'content-type': 'text/plain' })
      res.end('ok')
      return
    }
    res.writeHead(404)
    res.end()
  })

  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_FRAME_BYTES })

  async function roomFor(documentId: string): Promise<DocumentRoom> {
    const existing = rooms.get(documentId)
    if (existing) return existing

    const room = new DocumentRoom(documentId, {
      onPersist: (update, clientId) => options.onPersist?.(documentId, update, clientId),
      onReject: (reason) => options.onReject?.(documentId, reason),
    })
    rooms.set(documentId, room)

    if (options.loadDocument) {
      const state = await options.loadDocument(documentId)
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
      void onConnection(ws, req)
    })
  })

  async function onConnection(ws: WebSocket, req: IncomingMessage): Promise<void> {
    try {
      const url = new URL(req.url ?? '/', 'http://localhost')
      // decodeURIComponent throws URIError on a malformed percent-escape (e.g. a lone
      // "%" or "%zz"). That throw must not escape as an unhandled rejection, so it is
      // inside this try, which closes with the permanent 4400 below.
      const documentId = decodeURIComponent(url.pathname.slice(1))
      const token = url.searchParams.get('token')

      if (!documentId) return void ws.close(4401, 'missing document id')
      if (!token) return void ws.close(4401, 'missing token')

      let claims
      try {
        claims = await verifyDocToken(token, options.jwtSecret)
      } catch {
        return void ws.close(4401, 'invalid token')
      }

      if (claims.docId !== documentId) return void ws.close(4403, 'token document mismatch')

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

      ws.on('message', (data: Buffer) => {
        room.handleFrame(conn, new Uint8Array(data.buffer, data.byteOffset, data.byteLength))
      })

      ws.on('close', () => {
        room.remove(conn)
        if (room.size === 0) scheduleEvict(documentId)
      })

      ws.on('error', () => {
        room.remove(conn)
        if (room.size === 0) scheduleEvict(documentId)
      })

      // The server opens the sync handshake by advertising its own state vector.
      conn.send(encodeSyncStep1(room.doc))
    } catch {
      // Any parse failure before we can identify the document. Permanent range,
      // so the client stops retrying a request that cannot succeed.
      ws.close(4400, 'malformed request')
    }
  }

  await new Promise<void>((resolve) => http.listen(options.port, resolve))
  const address = http.address()
  const port = typeof address === 'object' && address ? address.port : options.port

  return {
    port,
    get roomCount() { return rooms.size },
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
