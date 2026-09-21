import { notFound } from 'next/navigation'
import { requireUser, requireDocumentRole, HttpError } from '@/lib/auth-guard'
import { colorFor } from '@/lib/color'
import { DocumentClient } from './DocumentClient'

export default async function DocumentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  let user
  try {
    user = await requireUser()
  } catch {
    // There is no /login route in this build — that's a documented, deliberate cut,
    // not a missing page. Redirecting there produced a bare 404 with no explanation,
    // so render an inline message instead.
    return (
      <main style={{ padding: 24 }}>
        <p>
          Sign in required. This build has no sign-in page; authenticate via the API
          directly (see README).
        </p>
      </main>
    )
  }

  try {
    const { role, type } = await requireDocumentRole(user.id, id, 'viewer')
    return (
      <DocumentClient
        documentId={id}
        type={type}
        readOnly={role === 'viewer'}
        user={{ name: user.name, color: colorFor(user.id) }}
      />
    )
  } catch (error) {
    if (error instanceof HttpError && error.status === 404) notFound()
    throw error
  }
}
