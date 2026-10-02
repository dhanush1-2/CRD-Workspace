'use client'

import { colorFor } from '@/lib/color'
import type { WorkspaceMemberView } from '@/lib/members'
import { ROLE_LABEL } from '@/lib/role-label'
import { useShare } from '@/components/share-context'
import styles from './workspace.module.css'

export type { WorkspaceMemberView }

export function MembersPanel({
  members,
  canManage,
}: {
  members: WorkspaceMemberView[]
  canManage: boolean
}) {
  const openShare = useShare()

  return (
    <>
      <div className={styles.peopleHeader}>
        <button type="button" className={styles.manageLink} onClick={openShare} data-testid="open-share">
          {canManage ? 'Manage' : 'See who has access'}
        </button>
      </div>
      <div>
        {members.map((member) => (
          <div key={member.id} className={styles.memberRow} data-testid={`member-${member.id}`}>
            <span
              className={styles.avatar}
              style={{ background: colorFor(member.id) }}
              aria-hidden="true"
            >
              {(member.name || member.email).slice(0, 1).toUpperCase()}
            </span>
            <span className={styles.memberText}>
              <span className={styles.memberName}>{member.name}</span>
              <span className={styles.memberEmail}>{member.email}</span>
            </span>
            <span className={styles.memberRole}>{ROLE_LABEL[member.role]}</span>
          </div>
        ))}
      </div>
    </>
  )
}
