'use client'

import { useRouter } from 'next/navigation'
import { useState, type FormEvent } from 'react'
import { Button } from '@/components/ui/Button'
import { TextField } from '@/components/ui/TextField'
import styles from '../auth.module.css'

export function LoginForm({ next }: { next: string }) {
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

    const response = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: form.get('email'), password: form.get('password') }),
    })

    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { error?: string } | null
      // The API returns the same 'invalid credentials' for an unknown email and a
      // wrong password, on purpose — it must not be usable to discover which
      // addresses are registered. Show its message verbatim; do not "improve" it
      // into something more specific.
      setError(body?.error ?? 'Sign in failed')
      setPending(false)
      return
    }

    // The session cookie arrives on this response. refresh() re-renders the server
    // tree with it in hand before we navigate, so the destination never flashes
    // its signed-out state.
    router.refresh()
    router.push(next)
  }

  return (
    <form className={styles.form} onSubmit={onSubmit}>
      <TextField label="Email" name="email" type="email" autoComplete="email" required />
      <TextField
        label="Password"
        name="password"
        type="password"
        autoComplete="current-password"
        required
      />
      {error && (
        <p className={styles.error} data-testid="auth-error" role="alert">
          {error}
        </p>
      )}
      <Button type="submit" variant="primary" disabled={pending} data-testid="submit">
        {pending ? 'Signing in…' : 'Sign in'}
      </Button>
    </form>
  )
}
