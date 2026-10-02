'use client'

import { useRouter } from 'next/navigation'
import { useState, type FormEvent } from 'react'
import type { Role } from '@crdt/shared/types'
import { Button } from '@/components/ui/Button'
import { Sheet } from '@/components/ui/Sheet'
import { useToast } from '@/components/ui/Toast'
import { colorFor } from '@/lib/color'
import type { WorkspaceMemberView } from '@/lib/members'
import { ROLE_LABEL } from '@/lib/role-label'
import styles from './share-sheet.module.css'
import ui from '@/components/ui/ui.module.css'

export function ShareSheet({
  workspaceId,
  workspaceName,
  members,
  canManage,
  onClose,
}: {
  workspaceId: string
  workspaceName: string
  members: WorkspaceMemberView[]
  canManage: boolean
  onClose: () => void
}) {
  const router = useRouter()
  const toast = useToast()
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  async function post(email: string, role: Role, announce: string): Promise<boolean> {
    setError(null)
    setPending(true)
    let response: Response
    try {
      response = await fetch(`/api/workspaces/${workspaceId}/members`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, role }),
      })
    } catch {
      // fetch rejects, rather than resolving with an error status, when the request
      // never reaches the server. Without this the rejection escapes and pending
      // stays true, leaving the control disabled with nothing shown.
      setError('Could not reach the server. Check your connection and try again.')
      setPending(false)
      return false
    }
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { error?: string } | null
      setError(
        response.status === 404
          ? `We couldn't find ${email}. Ask them to sign in once, then try again.`
          : response.status === 403
            ? 'Your role in this workspace changed. Reload the page.'
            : (body?.error ?? 'Could not update that member'),
      )
      setPending(false)
      return false
    }
    setPending(false)
    toast(announce)
    router.refresh()
    return true
  }

  async function onInvite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    const data = new FormData(form)
    const email = String(data.get('email') ?? '').trim()
    if (!email) return
    // The members route upserts, so posting an existing member would silently
    // change their role instead of inviting anyone. Catch it here and say so;
    // role changes have their own control on the row.
    const existing = members.find((m) => m.email.toLowerCase() === email.toLowerCase())
    if (existing) {
      setError(`${email} already has access.`)
      return
    }
    const role = String(data.get('role') ?? 'editor') as Role
    // Clear the field only on success, as MembersPanel does: a failed invite keeps
    // what was typed so it can be corrected.
    if (await post(email, role, `${email} added`)) form.reset()
  }

  return (
    <Sheet title={`Share "${workspaceName}"`} onClose={onClose}>
      {canManage && (
        <form className={styles.invite} onSubmit={onInvite}>
          <input
            className={styles.inviteInput}
            name="email"
            type="email"
            required
            placeholder="teammate@company.com"
            aria-label="Invite by email"
            data-testid="member-email"
          />
          <select
            className={styles.inviteRole}
            name="role"
            defaultValue="editor"
            aria-label="Role"
            data-testid="member-role"
          >
            <option value="viewer">{ROLE_LABEL.viewer}</option>
            <option value="editor">{ROLE_LABEL.editor}</option>
            <option value="owner">{ROLE_LABEL.owner}</option>
          </select>
          <Button type="submit" disabled={pending} data-testid="add-member">
            {pending ? 'Adding…' : 'Add'}
          </Button>
        </form>
      )}

      {error && (
        <p className={ui.error} role="alert" data-testid="member-error">
          {error}
        </p>
      )}

      <div className={styles.people}>
        {members.map((member) => (
          <div className={styles.row} key={member.id} data-testid={`share-member-${member.id}`}>
            <span
              className={styles.avatar}
              style={{ background: colorFor(member.id) }}
              aria-hidden="true"
            >
              {(member.name || member.email).slice(0, 1).toUpperCase()}
            </span>
            <span className={styles.text}>
              <span className={styles.name}>{member.name}</span>
              <span className={styles.email}>{member.email}</span>
            </span>
            {canManage ? (
              <select
                className={styles.inviteRole}
                value={member.role}
                aria-label={`Role for ${member.name}`}
                data-testid={`role-for-${member.id}`}
                disabled={pending}
                onChange={(event) =>
                  void post(
                    member.email,
                    event.target.value as Role,
                    event.target.value === 'editor'
                      ? `${member.name} can edit now`
                      : `${member.name} is now ${ROLE_LABEL[event.target.value as Role]}`,
                  )
                }
              >
                <option value="viewer">{ROLE_LABEL.viewer}</option>
                <option value="editor">{ROLE_LABEL.editor}</option>
                <option value="owner">{ROLE_LABEL.owner}</option>
              </select>
            ) : (
              <span className={styles.rowRole}>{ROLE_LABEL[member.role]}</span>
            )}
          </div>
        ))}
      </div>

      <p className={styles.footnote}>
        People need to have signed in once before you can add them. Role changes apply the next
        time they connect.
      </p>
    </Sheet>
  )
}
