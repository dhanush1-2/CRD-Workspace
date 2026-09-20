import { prisma } from '@crdt/db'
import { loadConfig } from './config.js'
import { createSyncServer } from './server.js'
import { DocumentStore } from './store.js'
import { UpdateQueue } from './update-queue.js'

const config = loadConfig()

const log = (level: string, msg: string, extra: Record<string, unknown> = {}) =>
  console.log(JSON.stringify({ level, msg, ...extra, at: new Date().toISOString() }))

const store = new DocumentStore(prisma, { snapshotEvery: 100 })

const queue = new UpdateQueue(store, {
  flushIntervalMs: 500,
  maxBatch: 64,
  onError: (error, attempt) =>
    log('error', 'update flush failed', { attempt, error: String(error) }),
})

const server = await createSyncServer({
  port: config.port,
  jwtSecret: config.jwtSecret,
  idleEvictMs: config.idleEvictMs,
  loadDocument: (documentId) => store.load(documentId),
  onPersist: (documentId, update, clientId) => queue.enqueue(documentId, { update, clientId }),
  onDocumentPersisted: async (documentId, doc) => {
    if (store.needsSnapshot(documentId)) await store.snapshot(documentId, doc)
  },
  onReject: (documentId, reason) => log('warn', 'frame rejected', { documentId, reason }),
})

log('info', 'sync server listening', { port: server.port })

let shuttingDown = false
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    if (shuttingDown) return
    shuttingDown = true
    log('info', 'draining update queue before exit', { depth: queue.depth })
    void queue
      .close()
      .then(() => server.close())
      .then(() => prisma.$disconnect())
      .then(() => process.exit(0))
      .catch((error: unknown) => {
        // A throw anywhere in this chain would otherwise leave the process hanging
        // instead of exiting — the opposite of a clean shutdown. Log and force exit
        // non-zero so an orchestrator (or a human) notices instead of waiting forever.
        log('error', 'shutdown failed', { error: String(error) })
        process.exit(1)
      })
  })
}
