import { notFound, redirect } from 'next/navigation'
import { prisma } from '@crdt/db'
import type { Role } from '@crdt/shared/types'
import { requireDocumentRole, HttpError } from '@/lib/auth-guard'
import { getCurrentUser } from '@/lib/current-user'
import { colorFor } from '@/lib/color'
import type { WorkspaceMemberView } from '@/lib/members'
import { AppShell } from '@/components/AppShell'
import { DocumentClient } from './DocumentClient'
import ui from '@/components/ui/ui.module.css'

export default async function DocumentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const user = await getCurrentUser()
  // There is a sign-in page now, so send them to it with the destination attached
  // rather than rendering a dead end. Outside any try/catch: redirect() throws.
  if (!user) redirect(`/login?next=${encodeURIComponent(`/documents/${id}`)}`)

  // Declared with an explicit type: `let role, type` would be implicitly `any`
  // under this repo's strict compiler settings.
  let access: { role: Role; workspaceId: string; type: 'doc' | 'board' }
  try {
    access = await requireDocumentRole(user.id, id, 'viewer')
  } catch (error) {
    if (error instanceof HttpError && error.status === 404) notFound()
    throw error
  }
  const { role, type } = access

  // Display data only, and only after the role check has passed.
  const document = await prisma.document.findUnique({
    where: { id },
    select: {
      title: true,
      workspace: {
        select: {
          id: true,
          name: true,
          members: {
            select: { role: true, user: { select: { id: true, name: true, email: true } } },
            orderBy: { user: { name: 'asc' } },
          },
        },
      },
    },
  })
  if (!document) notFound()

  // Sibling documents for the nav's tab strip. Display data only, after the
  // role check above.
  const siblings = await prisma.document.findMany({
    where: { workspaceId: document.workspace.id },
    select: { id: true, title: true, type: true },
    orderBy: { createdAt: 'asc' },
  })

  // The nav's Share button opens the sheet from here too, so it needs the members.
  // Mapped to plain strings: AppShell is a client component, and passing
  // document.workspace whole would also carry the Prisma members rows across.
  const members: WorkspaceMemberView[] = document.workspace.members.map((member) => ({
    id: member.user.id,
    name: member.user.name,
    email: member.user.email,
    role: member.role,
  }))

  return (
    <AppShell
      user={user}
      workspace={{ id: document.workspace.id, name: document.workspace.name }}
      documents={siblings}
      activeDocumentId={id}
      members={members}
      canManage={role === 'owner'}
      role={role}
    >
      {/* The page's only heading: the nav shows the title as a tab, not a heading. */}
      <h1 className={ui.labelHidden}>{document.title}</h1>
      <DocumentClient
        documentId={id}
        type={type}
        readOnly={role === 'viewer'}
        user={{ name: user.name, color: colorFor(user.id) }}
      />
    </AppShell>
  )
}
