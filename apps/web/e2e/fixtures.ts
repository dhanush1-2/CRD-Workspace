import { prisma } from '@crdt/db'
import { hashPassword, signSession } from '../src/lib/session.js'
import type { Role } from '@crdt/shared/types'

export const E2E_PASSWORD = 'e2e-password-1234'

export async function seedWorkspace(label: string) {
  const owner = await prisma.user.create({
    data: {
      email: `${label}-owner@e2e.test`,
      name: 'Owner',
      passwordHash: await hashPassword(E2E_PASSWORD),
    },
  })
  const workspace = await prisma.workspace.create({ data: { name: label, ownerId: owner.id } })
  await prisma.workspaceMember.create({
    data: { workspaceId: workspace.id, userId: owner.id, role: 'owner' },
  })
  return { owner, workspace }
}

export async function addMember(workspaceId: string, label: string, role: Role) {
  const user = await prisma.user.create({
    data: {
      email: `${label}-${role}@e2e.test`,
      name: role === 'viewer' ? 'Vera' : 'Eddie',
      passwordHash: await hashPassword(E2E_PASSWORD),
    },
  })
  await prisma.workspaceMember.create({ data: { workspaceId, userId: user.id, role } })
  return user
}

export async function createDocument(workspaceId: string, type: 'doc' | 'board') {
  return prisma.document.create({ data: { workspaceId, type, title: `e2e ${type}` } })
}

export async function sessionCookieFor(userId: string) {
  return {
    name: 'crdt_session',
    value: await signSession(userId, process.env.SESSION_SECRET!),
    domain: 'localhost',
    path: '/',
  }
}

export async function cleanup(label: string) {
  await prisma.workspace.deleteMany({ where: { name: label } })
  await prisma.user.deleteMany({ where: { email: { contains: `${label}-` } } })
}

/**
 * Remove a user created through the signup UI, and the personal workspace signup
 * creates for them.
 *
 * cleanup(label) cannot do this: it finds workspaces by name, and signup names
 * the workspace after the person ("Ada's workspace"), not after the test label.
 * Workspace.ownerId is a plain string column rather than a relation, so deleting
 * the user does not cascade to it either — it has to go first, explicitly.
 */
export async function cleanupUser(email: string) {
  const user = await prisma.user.findUnique({ where: { email }, select: { id: true } })
  if (!user) return
  await prisma.workspace.deleteMany({ where: { ownerId: user.id } })
  await prisma.user.delete({ where: { id: user.id } })
}
