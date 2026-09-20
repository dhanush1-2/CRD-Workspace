import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { prisma } from '@crdt/db'
import { requireWorkspaceRole, requireDocumentRole, HttpError } from '../src/lib/auth-guard.js'

let ownerId: string
let editorId: string
let viewerId: string
let strangerId: string
let workspaceId: string
let documentId: string

beforeAll(async () => {
  const make = (email: string, name: string) =>
    prisma.user.create({ data: { email, name, passwordHash: 'x' }, select: { id: true } })

  ownerId = (await make('rbac-owner@example.com', 'owner')).id
  editorId = (await make('rbac-editor@example.com', 'editor')).id
  viewerId = (await make('rbac-viewer@example.com', 'viewer')).id
  strangerId = (await make('rbac-stranger@example.com', 'stranger')).id

  const workspace = await prisma.workspace.create({ data: { name: 'rbac', ownerId } })
  workspaceId = workspace.id

  await prisma.workspaceMember.createMany({
    data: [
      { workspaceId, userId: ownerId, role: 'owner' },
      { workspaceId, userId: editorId, role: 'editor' },
      { workspaceId, userId: viewerId, role: 'viewer' },
    ],
  })

  documentId = (
    await prisma.document.create({ data: { workspaceId, type: 'board', title: 'rbac board' } })
  ).id
})

afterAll(async () => {
  await prisma.workspace.deleteMany({ where: { name: 'rbac' } })
  await prisma.user.deleteMany({ where: { email: { contains: 'rbac-' } } })
  await prisma.$disconnect()
})

async function statusOf(promise: Promise<unknown>): Promise<number> {
  try {
    await promise
    return 200
  } catch (error) {
    return error instanceof HttpError ? error.status : 500
  }
}

describe('workspace authorization', () => {
  it('lets an owner do owner-level things', async () => {
    await expect(requireWorkspaceRole(ownerId, workspaceId, 'owner')).resolves.toBe('owner')
  })

  it('lets an editor write but not administer', async () => {
    await expect(requireWorkspaceRole(editorId, workspaceId, 'editor')).resolves.toBe('editor')
    expect(await statusOf(requireWorkspaceRole(editorId, workspaceId, 'owner'))).toBe(403)
  })

  it('lets a viewer read but not write', async () => {
    await expect(requireWorkspaceRole(viewerId, workspaceId, 'viewer')).resolves.toBe('viewer')
    expect(await statusOf(requireWorkspaceRole(viewerId, workspaceId, 'editor'))).toBe(403)
  })

  it('gives a non-member 404, never 403, so ids cannot be probed', async () => {
    expect(await statusOf(requireWorkspaceRole(strangerId, workspaceId, 'viewer'))).toBe(404)
  })

  it('resolves a document role through its workspace', async () => {
    const result = await requireDocumentRole(viewerId, documentId, 'viewer')
    expect(result.role).toBe('viewer')
    expect(result.type).toBe('board')
  })

  it('gives 404 for a document in a workspace the caller is not in', async () => {
    expect(await statusOf(requireDocumentRole(strangerId, documentId, 'viewer'))).toBe(404)
  })

  it('gives 404 for a document that does not exist', async () => {
    expect(await statusOf(requireDocumentRole(ownerId, 'doc_missing', 'viewer'))).toBe(404)
  })
})
