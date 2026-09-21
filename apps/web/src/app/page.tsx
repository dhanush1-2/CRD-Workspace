import Link from 'next/link'
import { redirect } from 'next/navigation'
import { prisma } from '@crdt/db'
import { getCurrentUser } from '@/lib/current-user'
import { AppShell } from '@/components/AppShell'
import { Panel } from '@/components/ui/Panel'
import { CreateWorkspaceForm } from './CreateWorkspaceForm'
import styles from './dashboard.module.css'
import ui from '@/components/ui/ui.module.css'

export default async function HomePage() {
  const user = await getCurrentUser()
  if (!user) redirect('/login')

  // Read through the membership table rather than listing workspaces and filtering:
  // a workspace you are not a member of is never loaded in the first place, which is
  // the same rule requireWorkspaceRole enforces on every API route.
  const memberships = await prisma.workspaceMember.findMany({
    where: { userId: user.id },
    select: {
      role: true,
      workspace: {
        select: { id: true, name: true, _count: { select: { documents: true } } },
      },
    },
    orderBy: { workspace: { name: 'asc' } },
  })

  return (
    <AppShell user={user}>
      <div className={styles.page}>
        <Panel title="Your workspaces">
          {memberships.length === 0 ? (
            <p className={ui.empty}>
              No workspaces yet. Create one below and it is yours to share.
            </p>
          ) : (
            <div className={styles.list}>
              {memberships.map(({ role, workspace }) => (
                <Link
                  key={workspace.id}
                  href={`/workspaces/${workspace.id}`}
                  className={styles.item}
                  data-testid={`workspace-${workspace.id}`}
                >
                  <span className={styles.itemName}>{workspace.name}</span>
                  <span className={styles.itemMeta}>
                    {workspace._count.documents}{' '}
                    {workspace._count.documents === 1 ? 'document' : 'documents'}
                  </span>
                  <span className={styles.spacer} />
                  <span className={ui.badge}>{role}</span>
                </Link>
              ))}
            </div>
          )}
        </Panel>

        <Panel title="Create a workspace">
          <CreateWorkspaceForm />
        </Panel>
      </div>
    </AppShell>
  )
}
