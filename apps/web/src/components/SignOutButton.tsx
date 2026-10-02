'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { Button } from './ui/Button'

export function SignOutButton() {
  const router = useRouter()
  const [pending, setPending] = useState(false)

  return (
    <Button
      variant="glass"
      data-testid="sign-out"
      disabled={pending}
      onClick={async () => {
        setPending(true)
        // POST /api/auth/logout replies 204 with an expiring cookie. refresh()
        // drops the server tree that was rendered for the old session before we
        // navigate, so no signed-in data stays on screen after sign-out.
        await fetch('/api/auth/logout', { method: 'POST' })
        router.refresh()
        router.push('/login')
      }}
    >
      Sign out
    </Button>
  )
}
