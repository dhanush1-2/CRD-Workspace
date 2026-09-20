import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import * as Y from 'yjs'
import { WebsocketProvider } from 'y-websocket'
import { WebSocket } from 'ws'
import { prisma } from '@crdt/db'
import { signDocToken } from '@crdt/shared/doc-token'
import { createSyncServer, type SyncServer } from '../src/server.js'
import { DocumentStore } from '../src/store.js'
import { UpdateQueue } from '../src/update-queue.js'

const SECRET = 'test-secret-that-is-long-enough!!'

let documentId: string

beforeEach(async () => {
  const ws = await prisma.workspace.create({ data: { name: 'durability', ownerId: 'usr_t' } })
  const doc = await prisma.document.create({
    data: { workspaceId: ws.id, type: 'doc', title: 'durable' },
  })
  documentId = doc.id
})

afterAll(async () => {
  await prisma.workspace.deleteMany({ where: { name: 'durability' } })
  await prisma.$disconnect()
})

async function startServer(store: DocumentStore): Promise<{ server: SyncServer; queue: UpdateQueue }> {
  const queue = new UpdateQueue(store, { flushIntervalMs: 50, maxBatch: 8 })
  const server = await createSyncServer({
    port: 0,
    jwtSecret: SECRET,
    loadDocument: (id) => store.load(id),
    onPersist: (id, update, clientId) => queue.enqueue(id, { update, clientId }),
    onDocumentPersisted: async (id, doc) => {
      if (store.needsSnapshot(id)) await store.snapshot(id, doc)
    },
  })
  return { server, queue }
}

async function connect(server: SyncServer, name: string) {
  const token = await signDocToken(
    { sub: `usr_${name}`, docId: documentId, role: 'editor', name, color: '#000' },
    SECRET,
  )
  const doc = new Y.Doc()
  const provider = new WebsocketProvider(`ws://127.0.0.1:${server.port}`, documentId, doc, {
    params: { token },
    WebSocketPolyfill: WebSocket as unknown as typeof globalThis.WebSocket,
    disableBc: true,
  })
  await new Promise<void>((resolve) => provider.once('sync', () => resolve()))
  return { doc, provider }
}

describe('durability', () => {
  it('restores document state after a full server restart', async () => {
    const store = new DocumentStore(prisma, { snapshotEvery: 100 })

    const first = await startServer(store)
    const writer = await connect(first.server, 'alice')
    writer.doc.getText('t').insert(0, 'survives restart')

    await new Promise((r) => setTimeout(r, 150))
    await first.queue.close()
    writer.provider.destroy()
    await first.server.close()

    const second = await startServer(store)
    const reader = await connect(second.server, 'bob')

    expect(reader.doc.getText('t').toString()).toBe('survives restart')

    reader.provider.destroy()
    await second.queue.close()
    await second.server.close()
  })

  it('writes a snapshot once the threshold is crossed and still loads correctly', async () => {
    const store = new DocumentStore(prisma, { snapshotEvery: 5 })

    const first = await startServer(store)
    const writer = await connect(first.server, 'alice')

    for (let i = 0; i < 12; i += 1) {
      writer.doc.getText('t').insert(writer.doc.getText('t').length, `${i} `)
      await new Promise((r) => setTimeout(r, 60))
    }

    await first.queue.close()
    const expected = writer.doc.getText('t').toString()
    writer.provider.destroy()
    await first.server.close()

    const snapshots = await prisma.documentSnapshot.findMany({ where: { documentId } })
    expect(snapshots.length).toBeGreaterThan(0)

    const second = await startServer(new DocumentStore(prisma, { snapshotEvery: 5 }))
    const reader = await connect(second.server, 'bob')
    expect(reader.doc.getText('t').toString()).toBe(expected)

    reader.provider.destroy()
    await second.queue.close()
    await second.server.close()
  })

  it('does not persist a viewer edit', async () => {
    const store = new DocumentStore(prisma, { snapshotEvery: 100 })
    const { server, queue } = await startServer(store)

    const token = await signDocToken(
      { sub: 'usr_v', docId: documentId, role: 'viewer', name: 'v', color: '#000' },
      SECRET,
    )
    const doc = new Y.Doc()
    const provider = new WebsocketProvider(`ws://127.0.0.1:${server.port}`, documentId, doc, {
      params: { token },
      WebSocketPolyfill: WebSocket as unknown as typeof globalThis.WebSocket,
      disableBc: true,
    })
    await new Promise<void>((resolve) => provider.once('sync', () => resolve()))

    doc.getText('t').insert(0, 'viewer edit')
    await new Promise((r) => setTimeout(r, 200))
    await queue.close()

    const rows = await prisma.documentUpdate.findMany({ where: { documentId } })
    expect(rows).toHaveLength(0)

    provider.destroy()
    await server.close()
  })
})
