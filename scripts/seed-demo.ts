import { prisma } from '@crdt/db'
import { addCard, addColumn } from '@crdt/shared/board'
import * as Y from 'yjs'

const doc = new Y.Doc()
addColumn(doc, { id: 'todo', title: 'To do' })
addColumn(doc, { id: 'doing', title: 'In progress' })
addColumn(doc, { id: 'done', title: 'Done' })
addCard(doc, { id: 'c1', title: 'Open this board in two windows', columnId: 'todo' })
addCard(doc, { id: 'c2', title: 'Drag a card and watch the other window', columnId: 'todo' })
addCard(doc, { id: 'c3', title: 'Go offline, keep editing, come back', columnId: 'doing' })

// The demo workspace is owned by whoever signs in with this address. Normalized
// exactly as sign-in normalizes provider emails, so the first GitHub or Google
// sign-in with it links to this user rather than creating a second one.
const ownerEmail = process.env.DEMO_OWNER_EMAIL?.trim().toLowerCase()
if (!ownerEmail || !ownerEmail.includes('@')) {
  throw new Error('DEMO_OWNER_EMAIL must be set to the email you will sign in with (GitHub or Google)')
}

const user = await prisma.user.upsert({
  where: { email: ownerEmail },
  update: {},
  create: { email: ownerEmail, name: 'Demo' },
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

console.log(`seeded board: /documents/${document.id} (owner: ${ownerEmail})`)
await prisma.$disconnect()
