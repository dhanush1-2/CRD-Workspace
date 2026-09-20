import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { prisma } from '../src/index.js'

describe('schema', () => {
  let workspaceId: string
  let documentId: string

  beforeAll(async () => {
    const ws = await prisma.workspace.create({
      data: { name: 'test-ws', ownerId: 'usr_test' },
    })
    workspaceId = ws.id
    const doc = await prisma.document.create({
      data: { workspaceId, type: 'board', title: 'test-board' },
    })
    documentId = doc.id
  })

  afterAll(async () => {
    await prisma.workspace.delete({ where: { id: workspaceId } })
    await prisma.$disconnect()
  })

  it('stores binary updates and returns them in insertion order', async () => {
    await prisma.documentUpdate.createMany({
      data: [
        { documentId, update: Buffer.from([1, 2, 3]), clientId: 'c1' },
        { documentId, update: Buffer.from([4, 5, 6]), clientId: 'c2' },
      ],
    })

    const rows = await prisma.documentUpdate.findMany({
      where: { documentId },
      orderBy: { id: 'asc' },
    })

    expect(rows).toHaveLength(2)
    expect(Array.from(rows[0]!.update)).toEqual([1, 2, 3])
    expect(rows[0]!.id < rows[1]!.id).toBe(true)
  })

  it('cascades deletes from document to updates', async () => {
    const doomed = await prisma.document.create({
      data: { workspaceId, type: 'doc', title: 'doomed' },
    })
    await prisma.documentUpdate.create({
      data: { documentId: doomed.id, update: Buffer.from([9]), clientId: 'c1' },
    })

    await prisma.document.delete({ where: { id: doomed.id } })

    const orphans = await prisma.documentUpdate.findMany({
      where: { documentId: doomed.id },
    })
    expect(orphans).toHaveLength(0)
  })
})
