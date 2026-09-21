import { z } from 'zod'
import { prisma } from '@crdt/db'
import { env } from '@/lib/env'
import { hashPassword, signSession, sessionCookie } from '@/lib/session'
import { toResponse } from '@/lib/auth-guard'

const Body = z.object({
  email: z.string().email(),
  password: z.string().min(12),
  name: z.string().min(1).max(80),
})

export async function POST(request: Request): Promise<Response> {
  try {
    const body = await request.json().catch(() => null)
    const parsed = Body.safeParse(body)
    if (!parsed.success) return Response.json({ error: 'invalid body' }, { status: 400 })

    const { email, password, name } = parsed.data

    const existing = await prisma.user.findUnique({ where: { email } })
    if (existing) return Response.json({ error: 'email already registered' }, { status: 409 })

    const user = await prisma.user.create({
      data: { email, name, passwordHash: await hashPassword(password) },
      select: { id: true, email: true, name: true },
    })

    // Everyone starts with a workspace they own, so signup lands somewhere usable.
    // Nested like the sibling POST /api/workspaces route already does it: Prisma's
    // nested writes are implicitly transactional, so the workspace and its owner
    // membership are created atomically. (The user itself is still a separate,
    // earlier write — Workspace.ownerId is a plain string field, not a relation, so
    // there's no nested-create path from User down to it.)
    await prisma.workspace.create({
      data: {
        name: `${name}'s workspace`,
        ownerId: user.id,
        members: { create: { userId: user.id, role: 'owner' } },
      },
    })

    const token = await signSession(user.id, env.sessionSecret)
    return Response.json(user, {
      status: 201,
      headers: { 'set-cookie': sessionCookie(token) },
    })
  } catch (error) {
    return toResponse(error)
  }
}
