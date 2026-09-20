import { signDocToken, DEFAULT_TTL_SECONDS } from '@crdt/shared/doc-token'
import { env } from '@/lib/env'
import { requireDocumentRole, requireUser, toResponse } from '@/lib/auth-guard'
import { colorFor } from '@/lib/color'

/**
 * Exported separately from the route handler so it can be tested without the
 * Next.js request context.
 */
export async function mintDocToken(
  user: { id: string; name: string; email: string },
  documentId: string,
): Promise<{ token: string; expiresAt: string; role: string }> {
  const { role } = await requireDocumentRole(user.id, documentId, 'viewer')

  const token = await signDocToken(
    {
      sub: user.id,
      docId: documentId,
      role,
      name: user.name,
      color: colorFor(user.id),
    },
    env.syncJwtSecret,
    DEFAULT_TTL_SECONDS,
  )

  return {
    token,
    expiresAt: new Date(Date.now() + DEFAULT_TTL_SECONDS * 1000).toISOString(),
    role,
  }
}

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const user = await requireUser()
    const { id } = await params
    return Response.json(await mintDocToken(user, id))
  } catch (error) {
    return toResponse(error)
  }
}
