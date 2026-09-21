import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { prisma } from '@crdt/db'
import { POST as signup } from '../src/app/api/auth/signup/route.js'
import { POST as login } from '../src/app/api/auth/login/route.js'

const EMAIL = 'route-test@example.com'

beforeAll(async () => {
  process.env.SESSION_SECRET = 'session-secret-long-enough-here!'
  process.env.SYNC_JWT_SECRET = 'sync-secret-that-is-long-enough!'
  await prisma.user.deleteMany({ where: { email: EMAIL } })
})

afterAll(async () => {
  // Workspace.ownerId is a plain string field, not a cascading relation, so
  // deleting the User alone leaves the personal workspace signup creates
  // orphaned. Delete it explicitly before removing the user.
  const user = await prisma.user.findUnique({ where: { email: EMAIL } })
  if (user) {
    await prisma.workspace.deleteMany({ where: { ownerId: user.id } })
  }
  await prisma.user.deleteMany({ where: { email: EMAIL } })
  await prisma.$disconnect()
})

const post = (body: unknown) =>
  new Request('http://localhost/api', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })

describe('auth routes', () => {
  it('creates a user, a personal workspace, and a session cookie, all correctly linked', async () => {
    const response = await signup(post({ email: EMAIL, password: 'hunter2hunter2', name: 'Route' }))

    expect(response.status).toBe(201)
    expect(response.headers.get('set-cookie')).toContain('crdt_session=')

    const user = await prisma.user.findUnique({
      where: { email: EMAIL },
      include: { memberships: true },
    })
    expect(user).not.toBeNull()
    expect(user!.passwordHash).not.toContain('hunter2')
    expect(user!.memberships).toHaveLength(1)
    expect(user!.memberships[0]?.role).toBe('owner')

    // The workspace and its owner membership are created via a single nested Prisma
    // write (matching the sibling POST /api/workspaces route), rather than as two
    // separate sequential writes — proving they're correctly linked to each other
    // and to the user is the regression check for that atomicity, since a partial
    // failure between them would either leave no workspace at all or a membership
    // pointing at the wrong workspace.
    const workspace = await prisma.workspace.findUnique({
      where: { id: user!.memberships[0]!.workspaceId },
    })
    expect(workspace).not.toBeNull()
    expect(workspace!.ownerId).toBe(user!.id)
    expect(workspace!.name).toBe("Route's workspace")
  })

  it('rejects a duplicate email', async () => {
    const response = await signup(post({ email: EMAIL, password: 'hunter2hunter2', name: 'Again' }))
    expect(response.status).toBe(409)
  })

  it('rejects a short password with 400', async () => {
    const response = await signup(post({ email: 'x@example.com', password: 'short', name: 'X' }))
    expect(response.status).toBe(400)
  })

  it('returns 400, not 500, for a genuinely malformed JSON body', async () => {
    // Not a wrong-shaped valid JSON body (that's the test above) — this is JSON that
    // fails to parse at all, which request.json() throws SyntaxError for. toResponse
    // doesn't recognize a bare SyntaxError as an HttpError, so without a guard this
    // fell through to a generic 500 with a logged stack trace.
    const malformed = new Request('http://localhost/api', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{not valid json',
    })
    const response = await signup(malformed)
    expect(response.status).toBe(400)
  })

  it('logs in with the right password', async () => {
    const response = await login(post({ email: EMAIL, password: 'hunter2hunter2' }))
    expect(response.status).toBe(200)
    expect(response.headers.get('set-cookie')).toContain('crdt_session=')
  })

  it('returns 401 for a wrong password without saying which field was wrong', async () => {
    const response = await login(post({ email: EMAIL, password: 'wrongwrongwrong' }))
    expect(response.status).toBe(401)
    const body = (await response.json()) as { error: string }
    expect(body.error).toBe('invalid credentials')
  })

  it('returns 401 for an unknown email with the same message', async () => {
    const response = await login(post({ email: 'nobody@example.com', password: 'whatever12345' }))
    expect(response.status).toBe(401)
    const body = (await response.json()) as { error: string }
    expect(body.error).toBe('invalid credentials')
  })
})
