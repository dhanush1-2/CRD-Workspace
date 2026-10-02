import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { prisma } from '@crdt/db'
import type { Role } from '@crdt/shared/types'
import { getCurrentUser } from '@/lib/current-user'
import { HttpError, requireWorkspaceRole } from '@/lib/auth-guard'
import { AppShell } from '@/components/AppShell'
import { lastActivityByDocument } from '@/lib/document-activity'
import { formatCount, formatRelativeTime } from '@/lib/format'
import type { WorkspaceMemberView } from '@/lib/members'
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
        select: { id: true, title: true, type: true, createdAt: true },
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
  // One mapping for both consumers (the nav's share sheet and the People panel).
  // Only strings cross into client components: no Prisma rows.
  const members: WorkspaceMemberView[] = workspace.members.map((member) => ({
    id: member.user.id,
    name: member.user.name,
    email: member.user.email,
    role: member.role,
  }))
  const now = new Date()
  const lastActivity = await lastActivityByDocument(workspace.documents.map((d) => d.id))

  return (
    <AppShell
      user={user}
      workspace={{ id, name: workspace.name }}
      documents={workspace.documents.map(({ id: documentId, title, type }) => ({
        id: documentId,
        title,
        type,
      }))}
      members={members}
      canManage={role === 'owner'}
      role={role}
    >
      <div className={styles.page}>
        <div className={styles.header}>
          <h1>{workspace.name}</h1>
          <p className={ui.bgPill}>
            {formatCount(workspace.documents.length, 'document')} ·{' '}
            {formatCount(workspace.members.length, 'person', 'people')}
          </p>
        </div>

        <section className={styles.section} aria-labelledby="documents-heading">
          <h2 id="documents-heading">Documents</h2>
          {workspace.documents.length === 0 && !canCreate ? (
            <p className={ui.bgPill}>Nothing here yet.</p>
          ) : (
            <div className={styles.grid}>
              <div className={styles.docs} data-testid="document-list">
                {workspace.documents.map((document) => (
                  <Link
                    key={document.id}
                    href={`/documents/${document.id}`}
                    className={`${ui.glass} ${ui.tile} ${styles.docTile}`}
                    data-testid={`document-${document.id}`}
                  >
                    <span className={`${ui.chip} ${ui.chipAccent}`} data-testid="document-kind">
                      {document.type === 'board' ? 'Board' : 'Page'}
                    </span>
                    <span className={styles.docText}>
                      <span className={styles.docTitle}>{document.title}</span>
                      <span className={styles.docUpdated}>
                        updated {formatRelativeTime(lastActivity.get(document.id) ?? document.createdAt, now)}
                      </span>
                    </span>
                  </Link>
                ))}
              </div>
              {canCreate && <CreateDocumentForm workspaceId={id} />}
            </div>
          )}
        </section>

        <section className={styles.section} aria-labelledby="people-heading">
          <h2 id="people-heading">People</h2>
          <div className={`${ui.glass} ${styles.people}`}>
            <MembersPanel members={members} canManage={role === 'owner'} />
          </div>
        </section>
      </div>
    </AppShell>
  )
}
