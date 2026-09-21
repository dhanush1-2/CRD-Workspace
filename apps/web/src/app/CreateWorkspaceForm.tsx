'use client'

import { useRouter } from 'next/navigation'
import { useState, type FormEvent } from 'react'
import { Button } from '@/components/ui/Button'
import { TextField } from '@/components/ui/TextField'
import ui from '@/components/ui/ui.module.css'
import styles from './dashboard.module.css'

export function CreateWorkspaceForm() {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    // Read the form before any await: React clears event.currentTarget once the
    // handler yields, so reaching for it after the fetch would throw.
    const form = event.currentTarget
    const name = String(new FormData(form).get('name') ?? '').trim()
    if (!name) return
    setError(null)
    setPending(true)

    let response: Response
    try {
      response = await fetch('/api/workspaces', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name }),
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
      setError(body?.error ?? 'Could not create that workspace')
      setPending(false)
      return
    }

    setPending(false)
    form.reset()
    // The list is server-rendered, so refresh() is what makes the new workspace
    // appear — there is no client-side copy of it to update.
    router.refresh()
  }

  return (
    <>
      <form className={styles.inlineForm} onSubmit={onSubmit}>
        <div className={styles.inlineFormField}>
          <TextField
            label="New workspace"
            name="name"
            placeholder="Design team"
            maxLength={120}
            required
            data-testid="workspace-name"
          />
        </div>
        <Button type="submit" disabled={pending} data-testid="create-workspace">
          {pending ? 'Creating…' : 'Create'}
        </Button>
      </form>
      {error && (
        <p className={ui.error} role="alert" data-testid="workspace-error">
          {error}
        </p>
      )}
    </>
  )
}
