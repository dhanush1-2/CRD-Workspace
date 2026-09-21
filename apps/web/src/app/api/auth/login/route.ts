import { z } from 'zod'
import { prisma } from '@crdt/db'
import { env } from '@/lib/env'
import { verifyPassword, signSession, sessionCookie } from '@/lib/session'
import { toResponse } from '@/lib/auth-guard'

const Body = z.object({ email: z.string().email(), password: z.string().min(1) })

// A syntactically valid scrypt hash that no password derives to. Used in place
// of a real stored hash when the email is unknown, so verifyPassword always
// runs the same scrypt computation and an unknown email cannot be told apart
// from a wrong password by response timing.
const DUMMY_HASH = `scrypt$${'a'.repeat(32)}$${'b'.repeat(128)}`

export async function POST(request: Request): Promise<Response> {
  try {
    const body = await request.json().catch(() => null)
    const parsed = Body.safeParse(body)
    if (!parsed.success) return Response.json({ error: 'invalid body' }, { status: 400 })

    const user = await prisma.user.findUnique({ where: { email: parsed.data.email } })

    // Same message and same code — and the same verifyPassword call, run against
    // a dummy hash when there is no user — for "no such user" and "wrong
    // password", so the endpoint cannot be used to enumerate registered
    // addresses by status, body, or timing.
    const ok = await verifyPassword(parsed.data.password, user?.passwordHash ?? DUMMY_HASH)
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
