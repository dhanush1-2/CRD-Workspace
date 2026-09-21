'use client'

import { useRouter } from 'next/navigation'
import { useState, type FormEvent } from 'react'
import { Button } from '@/components/ui/Button'
import { TextField } from '@/components/ui/TextField'
import styles from '../auth.module.css'

export function SignupForm({ next }: { next: string }) {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    // Read the form before any await: React clears event.currentTarget once the
    // handler yields, so reaching for it after the fetch would throw.
    const form = new FormData(event.currentTarget)
    setError(null)
    setPending(true)

    let response: Response
    try {
      response = await fetch('/api/auth/signup', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: form.get('name'),
          email: form.get('email'),
          password: form.get('password'),
        }),
      })
    } catch {
      // fetch rejects — rather than resolving with an error status — when the request
      // never reaches the server: offline, DNS failure, connection refused, aborted.
      // Without this the rejection escapes the async handler, pending stays true, and
      // the button sits disabled on "Creating account…" with nothing shown to the user.
      setError('Could not reach the server. Check your connection and try again.')
      setPending(false)
      return
    }

    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { error?: string } | null
      // 409 is the one case worth rewording: 'email already registered' is the
      // API's wording for a machine, and a person needs to know what to do next.
      setError(
        response.status === 409
          ? 'That email is already registered — sign in instead.'
          : (body?.error ?? 'Sign up failed'),
      )
      setPending(false)
      return
    }

    router.refresh()
    router.push(next)
  }

  return (
    <form className={styles.form} onSubmit={onSubmit}>
      <TextField label="Name" name="name" autoComplete="name" required maxLength={80} />
      <TextField label="Email" name="email" type="email" autoComplete="email" required />
      {/*
        No minLength here on purpose. The 12-character rule belongs to the server
        (POST /api/auth/signup validates z.string().min(12)); a browser-side
        minLength would block submission before the request is sent, leaving the
        server rule untested and unproven from the outside.
      */}
      <TextField
        label="Password"
        name="password"
        type="password"
        autoComplete="new-password"
        required
      />
      <p className={styles.hint}>At least 12 characters.</p>
      {error && (
        <p className={styles.error} data-testid="auth-error" role="alert">
          {error}
        </p>
      )}
      <Button type="submit" variant="primary" disabled={pending} data-testid="submit">
        {pending ? 'Creating account…' : 'Create account'}
      </Button>
    </form>
  )
}
