import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { prisma } from '@crdt/db'
import { lastActivityByDocument } from '../src/lib/document-activity.js'

let ownerId: string
let workspaceId: string
let editedId: string
let untouchedId: string
let newestUpdateAt: Date

beforeAll(async () => {
  ownerId = (
    await prisma.user.create({
      data: { email: 'doc-activity-owner@example.com', name: 'owner' },
      select: { id: true },
    })
  ).id
  workspaceId = (await prisma.workspace.create({ data: { name: 'activity', ownerId } })).id
  editedId = (
    await prisma.document.create({ data: { workspaceId, type: 'doc', title: 'edited' } })
  ).id
  untouchedId = (
    await prisma.document.create({ data: { workspaceId, type: 'doc', title: 'untouched' } })
  ).id

  const at = (iso: string) => new Date(iso)
  newestUpdateAt = at('2026-09-30T10:00:00Z')
  await prisma.documentUpdate.createMany({
    data: [
      { documentId: editedId, update: Buffer.from([1]), clientId: 'a', createdAt: at('2026-09-01T10:00:00Z') },
      { documentId: editedId, update: Buffer.from([2]), clientId: 'a', createdAt: newestUpdateAt },
    ],
  })
})

afterAll(async () => {
  await prisma.workspace.delete({ where: { id: workspaceId } })
  await prisma.user.delete({ where: { id: ownerId } })
})

describe('lastActivityByDocument', () => {
  it('returns the newest update per document and omits documents with none', async () => {
    const activity = await lastActivityByDocument([editedId, untouchedId])

    expect(activity.get(editedId)).toEqual(newestUpdateAt)
    expect(activity.has(untouchedId)).toBe(false)
  })

  it('does no work for an empty id list', async () => {
    expect((await lastActivityByDocument([])).size).toBe(0)
  })
})
