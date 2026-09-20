import { z } from 'zod'
import { prisma } from '@crdt/db'
import { env } from '@/lib/env'
import { verifyPassword, signSession, sessionCookie } from '@/lib/session'
import { toResponse } from '@/lib/auth-guard'

const Body = z.object({ email: z.string().email(), password: z.string().min(1) })

export async function POST(request: Request): Promise<Response> {
  try {
    const parsed = Body.safeParse(await request.json())
    if (!parsed.success) return Response.json({ error: 'invalid body' }, { status: 400 })

    const user = await prisma.user.findUnique({ where: { email: parsed.data.email } })

    // Same message and same code for "no such user" and "wrong password", so the
    // endpoint cannot be used to enumerate registered addresses.
    const ok = user ? await verifyPassword(parsed.data.password, user.passwordHash) : false
    if (!user || !ok) return Response.json({ error: 'invalid credentials' }, { status: 401 })

    const token = await signSession(user.id, env.sessionSecret)
    return Response.json(
      { id: user.id, email: user.email, name: user.name },
      { headers: { 'set-cookie': sessionCookie(token) } },
    )
  } catch (error) {
    return toResponse(error)
  }
}
