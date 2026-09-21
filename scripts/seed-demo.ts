import { prisma } from '@crdt/db'
import { addCard, addColumn } from '@crdt/shared/board'
import * as Y from 'yjs'
import { hashPassword } from '../apps/web/src/lib/session.js'

const doc = new Y.Doc()
addColumn(doc, { id: 'todo', title: 'To do' })
addColumn(doc, { id: 'doing', title: 'In progress' })
addColumn(doc, { id: 'done', title: 'Done' })
addCard(doc, { id: 'c1', title: 'Open this board in two windows', columnId: 'todo' })
addCard(doc, { id: 'c2', title: 'Drag a card and watch the other window', columnId: 'todo' })
addCard(doc, { id: 'c3', title: 'Go offline, keep editing, come back', columnId: 'doing' })

const password = process.env.DEMO_PASSWORD
if (!password) throw new Error('DEMO_PASSWORD must be set')

const user = await prisma.user.upsert({
  where: { email: 'demo@crdt.test' },
  update: {},
  create: { email: 'demo@crdt.test', name: 'Demo', passwordHash: await hashPassword(password) },
})

const workspace = await prisma.workspace.create({ data: { name: 'Demo', ownerId: user.id } })
await prisma.workspaceMember.create({
  data: { workspaceId: workspace.id, userId: user.id, role: 'owner' },
})

const document = await prisma.document.create({
  data: { workspaceId: workspace.id, type: 'board', title: 'Demo board' },
})

// Seed through the update log, exactly as the sync server would, so the demo board
// loads by the same code path as every other document.
await prisma.documentUpdate.create({
  data: {
    documentId: document.id,
    update: Buffer.from(Y.encodeStateAsUpdate(doc)),
    clientId: 'seed',
  },
})

console.log(`seeded board: /documents/${document.id}`)
await prisma.$disconnect()
