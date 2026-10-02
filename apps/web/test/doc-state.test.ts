import { describe, it, expect } from 'vitest'
import { publishDocState, clearDocState, getDocState, subscribeDocState } from '@/lib/doc-state'

describe('doc state store', () => {
  it('notifies subscribers and returns a stable snapshot', () => {
    let calls = 0
    const stop = subscribeDocState(() => { calls += 1 })
    publishDocState({ documentId: 'a', status: 'connected', peers: [] })
    const first = getDocState()
    // A second identical publish must not notify: useSyncExternalStore re-renders
    // every subscriber on each notify, and the provider publishes on every
    // awareness tick.
    publishDocState({ documentId: 'a', status: 'connected', peers: [] })
    expect(calls).toBe(1)
    expect(getDocState()).toBe(first)
    stop()
  })

  it('a stale unmount does not clear a newer document', () => {
    publishDocState({ documentId: 'old', status: 'connected', peers: [] })
    publishDocState({ documentId: 'new', status: 'connected', peers: [] })
    clearDocState('old')
    expect(getDocState().documentId).toBe('new')
  })
})
