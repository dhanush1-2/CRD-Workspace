'use client'

import { useRouter } from 'next/navigation'
import { useState, type FormEvent } from 'react'
import type { Role } from '@crdt/shared/types'
import { Button } from '@/components/ui/Button'
import { TextField } from '@/components/ui/TextField'
import { colorFor } from '@/lib/color'
import styles from './workspace.module.css'
import ui from '@/components/ui/ui.module.css'

export type WorkspaceMemberView = { id: string; name: string; email: string; role: Role }

export function MembersPanel({
  workspaceId,
  members,
  canManage,
}: {
  workspaceId: string
  members: WorkspaceMemberView[]
  canManage: boolean
}) {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    // Read the form before any await: React clears event.currentTarget once the
    // handler yields, so reaching for it after the fetch would throw.
    const form = event.currentTarget
    const data = new FormData(form)
    const email = String(data.get('email') ?? '').trim()
    if (!email) return
    setError(null)
    setPending(true)

    let response: Response
    try {
      response = await fetch(`/api/workspaces/${workspaceId}/members`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, role: data.get('role') }),
      })
    } catch {
      // fetch rejects — rather than resolving with an error status — when the request
      // never reaches the server: offline, DNS failure, connection refused, aborted.
      // Without this the rejection escapes the async handler, pending stays true, and
      // the button sits disabled forever with nothing shown to the user.
      setError('Could not reach the server. Check your connection and try again.')
      setPending(false)
      return
    }

    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { error?: string } | null
      // 404 here means "no user with that email" — the route looks the invitee up
      // before touching the workspace. Rendering its literal 'not found' would read
      // as a missing page, so it gets translated. 403 means canManage (fixed at
      // server-render time, and this panel stays mounted across router.refresh())
      // no longer matches reality — the caller was demoted in another session
      // since the page loaded. 400 is the last-owner guard, whose own message is
      // already clear enough to show as-is.
      setError(
        response.status === 404
          ? `No account is registered to ${email}. They need to sign in once with GitHub or Google first.`
          : response.status === 403
            ? 'Your role in this workspace changed. Reload the page.'
            : (body?.error ?? 'Could not update that member'),
      )
      setPending(false)
      return
    }

    setPending(false)
    form.reset()
    router.refresh()
  }

  return (
    <>
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
            <span className={styles.memberRole}>{member.role}</span>
          </div>
        ))}
      </div>

      {canManage && (
        <form className={styles.memberForm} onSubmit={onSubmit}>
          <div className={styles.memberField}>
            <TextField
              label="Invite by email"
              name="email"
              type="email"
              placeholder="teammate@company.com"
              required
              data-testid="member-email"
            />
          </div>
          <select
            name="role"
            className={styles.select}
            defaultValue="editor"
            aria-label="Role"
            data-testid="member-role"
          >
            <option value="viewer">Viewer</option>
            <option value="editor">Editor</option>
            <option value="owner">Owner</option>
          </select>
          <Button type="submit" disabled={pending} data-testid="add-member">
            {pending ? 'Adding…' : 'Add'}
          </Button>
        </form>
      )}

      {error && (
        <p className={`${ui.error} ${styles.memberError}`} role="alert" data-testid="member-error">
          {error}
        </p>
      )}
    </>
  )
}
