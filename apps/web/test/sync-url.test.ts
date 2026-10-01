import { describe, it, expect } from 'vitest'
import { syncHealthUrl } from '../src/lib/sync-url.js'

describe('syncHealthUrl', () => {
  it('maps wss to https', () => {
    expect(syncHealthUrl('wss://crdt-sync.onrender.com')).toBe('https://crdt-sync.onrender.com/healthz')
  })

  it('maps ws to http, keeping the port', () => {
    expect(syncHealthUrl('ws://localhost:1234')).toBe('http://localhost:1234/healthz')
  })

  it('replaces any path, query or fragment', () => {
    expect(syncHealthUrl('wss://sync.example.com/some/room?token=abc#x')).toBe(
      'https://sync.example.com/healthz',
    )
  })

  it('returns null for anything that is not a WebSocket URL', () => {
    expect(syncHealthUrl('')).toBeNull()
    expect(syncHealthUrl('not a url')).toBeNull()
    expect(syncHealthUrl('https://sync.example.com')).toBeNull()
  })
})
