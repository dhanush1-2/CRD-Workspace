import { cookies } from 'next/headers'
import { prisma } from '@crdt/db'
import type { Role } from '@crdt/shared/types'
import { env } from './env.js'
import { SESSION_COOKIE, verifySession } from './session.js'

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
    this.name = 'HttpError'
  }
}

export function toResponse(error: unknown): Response {
  if (error instanceof HttpError) {
    return Response.json({ error: error.message }, { status: error.status })
  }
  console.error(error)
  return Response.json({ error: 'internal error' }, { status: 500 })
}

export async function requireUser() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value
  if (!token) throw new HttpError(401, 'not authenticated')

  let userId: string
  try {
    userId = await verifySession(token, env.sessionSecret)
  } catch {
    throw new HttpError(401, 'not authenticated')
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, name: true },
  })
  if (!user) throw new HttpError(401, 'not authenticated')
  return user
}

const RANK: Record<Role, number> = { viewer: 0, editor: 1, owner: 2 }

/**
 * Resolve the caller's role in a workspace, requiring at least `minimum`.
 * Returns 404 rather than 403 for a workspace the caller cannot see, so the API
 * never confirms that an id exists to someone with no access to it.
 */
export async function requireWorkspaceRole(
  userId: string,
  workspaceId: string,
  minimum: Role,
): Promise<Role> {
  const membership = await prisma.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId, userId } },
    select: { role: true },
  })
  if (!membership) throw new HttpError(404, 'not found')
  if (RANK[membership.role] < RANK[minimum]) throw new HttpError(403, 'insufficient role')
  return membership.role
}

export async function requireDocumentRole(
  userId: string,
  documentId: string,
  minimum: Role,
): Promise<{ role: Role; workspaceId: string; type: 'doc' | 'board' }> {
  const document = await prisma.document.findUnique({
    where: { id: documentId },
    select: { workspaceId: true, type: true },
  })
  if (!document) throw new HttpError(404, 'not found')

  const role = await requireWorkspaceRole(userId, document.workspaceId, minimum)
  return { role, workspaceId: document.workspaceId, type: document.type }
}
