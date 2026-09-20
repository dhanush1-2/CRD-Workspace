'use client'

import { useEffect, useState } from 'react'
import { createDocSession, type DocSession, type DocStatus } from '@/lib/doc-session'

const SYNC_URL = process.env.NEXT_PUBLIC_SYNC_URL ?? 'ws://localhost:1234'

async function fetchToken(documentId: string): Promise<string> {
  const response = await fetch(`/api/documents/${documentId}/token`, { method: 'POST' })
  if (!response.ok) throw new Error(`token request failed: ${response.status}`)
  const body = (await response.json()) as { token: string }
  return body.token
}

export function useCollaborativeDoc(documentId: string) {
  const [session, setSession] = useState<DocSession | null>(null)
  const [status, setStatus] = useState<DocStatus>('connecting')

  useEffect(() => {
    const created = createDocSession({
      documentId,
      syncUrl: SYNC_URL,
      fetchToken: () => fetchToken(documentId),
      // Deliberately left on in the browser: cross-tab sync is a real feature for
      // users. Tests pass disableBc through createDocSession directly.
      disableBc: false,
    })
    const unsubscribe = created.onStatus(setStatus)
    setSession(created)

    return () => {
      unsubscribe()
      created.destroy()
      setSession(null)
    }
  }, [documentId])

  return { doc: session?.doc ?? null, provider: session?.provider ?? null, status }
}
