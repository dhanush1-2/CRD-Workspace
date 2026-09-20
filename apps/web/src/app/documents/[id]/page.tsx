import { notFound, redirect } from 'next/navigation'
import { requireUser, requireDocumentRole, HttpError } from '@/lib/auth-guard'
import { DocumentClient } from './DocumentClient'

export default async function DocumentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  let user
  try {
    user = await requireUser()
  } catch {
    redirect('/login')
  }

  try {
    const { role, type } = await requireDocumentRole(user.id, id, 'viewer')
    return <DocumentClient documentId={id} type={type} readOnly={role === 'viewer'} />
  } catch (error) {
    if (error instanceof HttpError && error.status === 404) notFound()
    throw error
  }
}
