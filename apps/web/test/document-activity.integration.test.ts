import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { prisma } from '@crdt/db'
import { lastActivityByDocument } from '../src/lib/document-activity.js'

let ownerId: string
let workspaceId: string
let editedId: string
let otherEditedId: string
let untouchedId: string

// Each document's own newest row is its highest id. That row is deliberately NOT the
// newest createdAt in its own log, and not the global newest createdAt either, so only
// a per-document ORDER BY id DESC gives the right answer: returning the globally newest
// row, or ordering by createdAt, both fail.
const editedNewestAt = new Date('2026-09-10T10:00:00Z')
const otherNewestAt = new Date('2026-09-05T10:00:00Z')

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
  otherEditedId = (
    await prisma.document.create({ data: { workspaceId, type: 'doc', title: 'other edited' } })
  ).id
  untouchedId = (
    await prisma.document.create({ data: { workspaceId, type: 'doc', title: 'untouched' } })
  ).id

  const at = (iso: string) => new Date(iso)
  // Inserted one at a time so ids alternate between the two documents.
  const rows: [string, Date][] = [
    [editedId, at('2026-09-01T10:00:00Z')],
    [otherEditedId, at('2026-09-30T10:00:00Z')], // the global newest createdAt
    [editedId, at('2026-09-20T10:00:00Z')], // newer createdAt than its own last insert
    [otherEditedId, at('2026-09-02T10:00:00Z')],
    [editedId, editedNewestAt],
    [otherEditedId, otherNewestAt],
  ]
  for (const [documentId, createdAt] of rows) {
    await prisma.documentUpdate.create({
      data: { documentId, update: Buffer.from([1]), clientId: 'a', createdAt },
    })
  }
})

afterAll(async () => {
  await prisma.workspace.delete({ where: { id: workspaceId } })
  await prisma.user.delete({ where: { id: ownerId } })
})

describe('lastActivityByDocument', () => {
  it('returns each document its own newest update and omits documents with none', async () => {
    const activity = await lastActivityByDocument([editedId, otherEditedId, untouchedId])

    expect(activity.get(editedId)).toEqual(editedNewestAt)
    expect(activity.get(otherEditedId)).toEqual(otherNewestAt)
    expect(activity.has(untouchedId)).toBe(false)
    expect(activity.size).toBe(2)
  })

  it('does no work for an empty id list', async () => {
    expect((await lastActivityByDocument([])).size).toBe(0)
  })
})
