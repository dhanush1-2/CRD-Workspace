import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { prisma } from '@crdt/db'
import { verifyDocToken } from '@crdt/shared/doc-token'
import { mintDocToken } from '../src/app/api/documents/[id]/token/route.js'

const SECRET = 'sync-secret-that-is-long-enough!'

let viewerId: string
let documentId: string

beforeAll(async () => {
  process.env.SYNC_JWT_SECRET = SECRET

  const viewer = await prisma.user.create({
    data: { email: 'token-viewer@example.com', name: 'Viewer', passwordHash: 'x' },
  })
  viewerId = viewer.id

  const workspace = await prisma.workspace.create({ data: { name: 'token-test', ownerId: viewerId } })
  await prisma.workspaceMember.create({
    data: { workspaceId: workspace.id, userId: viewerId, role: 'viewer' },
  })
  documentId = (
    await prisma.document.create({
      data: { workspaceId: workspace.id, type: 'board', title: 'token board' },
    })
  ).id
})

afterAll(async () => {
  await prisma.workspace.deleteMany({ where: { name: 'token-test' } })
  await prisma.user.deleteMany({ where: { email: 'token-viewer@example.com' } })
  await prisma.$disconnect()
})

describe('mintDocToken', () => {
  it('embeds the caller role and document id', async () => {
    const { token, role } = await mintDocToken(
      { id: viewerId, name: 'Viewer', email: 'token-viewer@example.com' },
      documentId,
    )

    expect(role).toBe('viewer')
    const claims = await verifyDocToken(token, SECRET)
    expect(claims.role).toBe('viewer')
    expect(claims.docId).toBe(documentId)
    expect(claims.sub).toBe(viewerId)
  })

  it('refuses to mint a token for a document the caller cannot see', async () => {
    const stranger = await prisma.user.create({
      data: { email: 'token-stranger@example.com', name: 'S', passwordHash: 'x' },
    })
    await expect(
      mintDocToken({ id: stranger.id, name: 'S', email: 'token-stranger@example.com' }, documentId),
    ).rejects.toMatchObject({ status: 404 })

    await prisma.user.delete({ where: { id: stranger.id } })
  })

  it('never mints a token that outlives its ttl', async () => {
    const { token, expiresAt } = await mintDocToken(
      { id: viewerId, name: 'Viewer', email: 'token-viewer@example.com' },
      documentId,
    )
    await verifyDocToken(token, SECRET)

    const remainingMs = new Date(expiresAt).getTime() - Date.now()
    expect(remainingMs).toBeGreaterThan(0)
    expect(remainingMs).toBeLessThanOrEqual(15 * 60 * 1000 + 1000)
  })
})
