'use client'

import { useRouter } from 'next/navigation'
import { useState, type FormEvent } from 'react'
import { Button } from '@/components/ui/Button'
import { TextField } from '@/components/ui/TextField'
import styles from './workspace.module.css'
import ui from '@/components/ui/ui.module.css'

export function CreateDocumentForm({ workspaceId }: { workspaceId: string }) {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    // Read the form before any await: React clears event.currentTarget once the
    // handler yields, so reaching for it after the fetch would throw.
    const form = event.currentTarget
    const data = new FormData(form)
    const title = String(data.get('title') ?? '').trim()
    if (!title) return
    setError(null)
    setPending(true)

    let response: Response
    try {
      response = await fetch(`/api/workspaces/${workspaceId}/documents`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title, type: data.get('type') }),
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
      setError(
        response.status === 403
          ? 'You need the editor role to create documents here.'
          : (body?.error ?? 'Could not create that document'),
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
      <form className={styles.form} onSubmit={onSubmit}>
        <div className={styles.formField}>
          <TextField
            label="Title"
            name="title"
            placeholder="Q3 roadmap"
            maxLength={200}
            required
            data-testid="document-title"
          />
        </div>
        <select
          name="type"
          className={styles.select}
          defaultValue="doc"
          aria-label="Document type"
          data-testid="document-type"
        >
          <option value="doc">Document</option>
          <option value="board">Board</option>
        </select>
        <Button type="submit" disabled={pending} data-testid="create-document">
          {pending ? 'Creating…' : 'Create'}
        </Button>
      </form>
      {error && (
        <p className={ui.error} role="alert" data-testid="document-error">
          {error}
        </p>
      )}
    </>
  )
}
