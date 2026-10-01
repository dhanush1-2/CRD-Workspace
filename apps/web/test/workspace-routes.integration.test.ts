import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { cookies } from 'next/headers'
import { prisma } from '@crdt/db'
import { requireWorkspaceRole, requireDocumentRole, HttpError } from '../src/lib/auth-guard.js'
import { POST as upsertMember } from '../src/app/api/workspaces/[id]/members/route.js'
import { signSession, SESSION_COOKIE } from '../src/lib/session.js'

vi.mock('next/headers', () => ({ cookies: vi.fn() }))

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

describe('members route: last-owner guard', () => {
  let soleOwner: { id: string; email: string }
  let coOwnerA: { id: string; email: string }
  let coOwnerB: { id: string; email: string }
  let soleOwnerWorkspaceId: string
  let twoOwnerWorkspaceId: string

  beforeAll(async () => {
    process.env.SESSION_SECRET = 'session-secret-long-enough-for-guard-test!!'

    const make = (email: string, name: string) =>
      prisma.user.create({
        data: { email, name, passwordHash: 'x' },
        select: { id: true, email: true },
      })

    soleOwner = await make('lastowner-sole@example.com', 'sole')
    coOwnerA = await make('lastowner-a@example.com', 'a')
    coOwnerB = await make('lastowner-b@example.com', 'b')

    const ws1 = await prisma.workspace.create({
      data: { name: 'lastowner-sole-ws', ownerId: soleOwner.id },
    })
    soleOwnerWorkspaceId = ws1.id
    await prisma.workspaceMember.create({
      data: { workspaceId: ws1.id, userId: soleOwner.id, role: 'owner' },
    })

    const ws2 = await prisma.workspace.create({
      data: { name: 'lastowner-two-ws', ownerId: coOwnerA.id },
    })
    twoOwnerWorkspaceId = ws2.id
    await prisma.workspaceMember.createMany({
      data: [
        { workspaceId: ws2.id, userId: coOwnerA.id, role: 'owner' },
        { workspaceId: ws2.id, userId: coOwnerB.id, role: 'owner' },
      ],
    })
  })

  afterAll(async () => {
    await prisma.workspace.deleteMany({
      where: { name: { in: ['lastowner-sole-ws', 'lastowner-two-ws'] } },
    })
    await prisma.user.deleteMany({ where: { email: { contains: 'lastowner-' } } })
  })

  async function postAs(actingUserId: string, workspaceId: string, body: unknown) {
    const token = await signSession(actingUserId, process.env.SESSION_SECRET!)
    vi.mocked(cookies).mockResolvedValue({
      get: (name: string) => (name === SESSION_COOKIE ? { value: token } : undefined),
    } as never)

    const request = new Request('http://localhost/api', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    return upsertMember(request, { params: Promise.resolve({ id: workspaceId }) })
  }

  it("rejects demoting the workspace's only owner to a lesser role", async () => {
    const response = await postAs(soleOwner.id, soleOwnerWorkspaceId, {
      email: soleOwner.email,
      role: 'viewer',
    })
    expect(response.status).toBe(400)
    const body = (await response.json()) as { error: string }
    expect(body.error).toContain('owner')

    const stillOwner = await prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId: soleOwnerWorkspaceId, userId: soleOwner.id } },
    })
    expect(stillOwner?.role).toBe('owner')
  })

  it('finds the invitee regardless of the case or whitespace the inviter typed', async () => {
    const response = await postAs(soleOwner.id, soleOwnerWorkspaceId, {
      email: `  ${coOwnerB.email.toUpperCase()}  `,
      role: 'viewer',
    })
    expect(response.status).toBe(201)

    const member = await prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId: soleOwnerWorkspaceId, userId: coOwnerB.id } },
    })
    expect(member?.role).toBe('viewer')
  })

  it('allows demoting an owner when another owner remains', async () => {
    const response = await postAs(coOwnerA.id, twoOwnerWorkspaceId, {
      email: coOwnerA.email,
      role: 'editor',
    })
    expect(response.status).toBe(201)

    const demoted = await prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId: twoOwnerWorkspaceId, userId: coOwnerA.id } },
    })
    expect(demoted?.role).toBe('editor')
  })
})
