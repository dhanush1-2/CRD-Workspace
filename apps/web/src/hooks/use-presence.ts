'use client'

import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react'
import type { WebsocketProvider } from 'y-websocket'

export interface PresenceUser {
  clientId: number
  name: string
  color: string
  cardId: string | null
}

const EMPTY: PresenceUser[] = []

function read(provider: WebsocketProvider): PresenceUser[] {
  const out: PresenceUser[] = []
  for (const [clientId, state] of provider.awareness.getStates()) {
    if (clientId === provider.awareness.clientID) continue
    const user = (state as { user?: { name?: string; color?: string } }).user
    if (!user?.name) continue
    out.push({
      clientId,
      name: user.name,
      color: user.color ?? '#71717a',
      cardId: (state as { cardId?: string | null }).cardId ?? null,
    })
  }
  return out.sort((a, b) => a.clientId - b.clientId)
}

export function usePresence(provider: WebsocketProvider | null): PresenceUser[] {
  const version = useRef(0)
  const cache = useRef<{ version: number; value: PresenceUser[] } | null>(null)

  const subscribe = useCallback(
    (onChange: () => void) => {
      if (!provider) return () => {}
      const handler = () => {
        version.current += 1
        onChange()
      }
      provider.awareness.on('change', handler)
      return () => provider.awareness.off('change', handler)
    },
    [provider],
  )

  const getSnapshot = useCallback(() => {
    if (!provider) return EMPTY
    if (!cache.current || cache.current.version !== version.current) {
      cache.current = { version: version.current, value: read(provider) }
    }
    return cache.current.value
  }, [provider])

  return useSyncExternalStore(subscribe, getSnapshot, () => EMPTY)
}

export function useAnnouncePresence(
  provider: WebsocketProvider | null,
  user: { name: string; color: string },
): void {
  useEffect(() => {
    if (!provider) return
    provider.awareness.setLocalStateField('user', user)
    return () => provider.awareness.setLocalState(null)
  }, [provider, user.name, user.color])
}

export function setCardFocus(provider: WebsocketProvider | null, cardId: string | null): void {
  provider?.awareness.setLocalStateField('cardId', cardId)
}
