import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { prisma } from '@crdt/db'
import type { Role } from '@crdt/shared/types'
import { getCurrentUser } from '@/lib/current-user'
import { HttpError, requireWorkspaceRole } from '@/lib/auth-guard'
import { AppShell } from '@/components/AppShell'
import { Panel } from '@/components/ui/Panel'
import { CreateDocumentForm } from './CreateDocumentForm'
import { MembersPanel } from './MembersPanel'
import styles from './workspace.module.css'
import ui from '@/components/ui/ui.module.css'

export default async function WorkspacePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const user = await getCurrentUser()
  // Outside any try/catch — redirect() signals by throwing.
  if (!user) redirect(`/login?next=${encodeURIComponent(`/workspaces/${id}`)}`)

  let role: Role
  try {
    role = await requireWorkspaceRole(user.id, id, 'viewer')
  } catch (error) {
    // requireWorkspaceRole already returns 404 rather than 403 for a workspace the
    // caller cannot see, so a non-member and a nonexistent id are indistinguishable
    // from out here — which is the point.
    if (error instanceof HttpError && error.status === 404) notFound()
    throw error
  }

  const workspace = await prisma.workspace.findUnique({
    where: { id },
    select: {
      name: true,
      documents: {
        select: { id: true, title: true, type: true },
        orderBy: { createdAt: 'asc' },
      },
      members: {
        select: { role: true, user: { select: { id: true, name: true, email: true } } },
        orderBy: { user: { name: 'asc' } },
      },
    },
  })
  if (!workspace) notFound()

  const canCreate = role === 'owner' || role === 'editor'

  return (
    <AppShell user={user} workspace={{ id, name: workspace.name }}>
      <div className={styles.page}>
        <Panel title="Documents" action={<span className={ui.badge}>{role}</span>}>
          {workspace.documents.length === 0 ? (
            <p className={ui.empty}>No documents yet.</p>
          ) : (
            <div className={styles.list}>
              {workspace.documents.map((document) => (
                <Link
                  key={document.id}
                  href={`/documents/${document.id}`}
                  className={styles.item}
                  data-testid={`document-${document.id}`}
                >
                  <span className={styles.itemName}>{document.title}</span>
                  <span className={styles.spacer} />
                  <span className={ui.badge}>{document.type}</span>
                </Link>
              ))}
            </div>
          )}
        </Panel>

        {canCreate && (
          <Panel title="New document">
            <CreateDocumentForm workspaceId={id} />
          </Panel>
        )}

        <Panel title="Members">
          <MembersPanel
            workspaceId={id}
            members={workspace.members.map((member) => ({
              id: member.user.id,
              name: member.user.name,
              email: member.user.email,
              role: member.role,
            }))}
            canManage={role === 'owner'}
          />
        </Panel>
      </div>
    </AppShell>
  )
}
