import { notFound } from 'next/navigation'
import { prisma } from '@crdt/db'
import { DocumentClient } from './DocumentClient'

export default async function DocumentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const document = await prisma.document.findUnique({ where: { id } })
  if (!document) notFound()

  // Role is resolved properly in Task 18; until then every visitor is an editor.
  return <DocumentClient documentId={document.id} type={document.type} readOnly={false} />
}
