import { describe, it, expect } from 'vitest'
import {
  hashPassword, verifyPassword, signSession, verifySession, SessionError,
  SESSION_COOKIE, SESSION_TTL_SECONDS, sessionCookie,
} from '../src/lib/session.js'

const SECRET = 'session-secret-long-enough-here!'

describe('password hashing', () => {
  it('accepts the correct password', async () => {
    const stored = await hashPassword('correct horse battery staple')
    await expect(verifyPassword('correct horse battery staple', stored)).resolves.toBe(true)
  })

  it('rejects the wrong password', async () => {
    const stored = await hashPassword('correct horse battery staple')
    await expect(verifyPassword('wrong', stored)).resolves.toBe(false)
  })

  it('produces a different hash for the same password each time', async () => {
    const a = await hashPassword('same')
    const b = await hashPassword('same')
    expect(a).not.toBe(b)
  })

  it('returns false rather than throwing on a malformed stored value', async () => {
    await expect(verifyPassword('x', 'garbage')).resolves.toBe(false)
  })
})

describe('session token', () => {
  it('round-trips a user id', async () => {
    const token = await signSession('usr_1', SECRET)
    await expect(verifySession(token, SECRET)).resolves.toBe('usr_1')
  })

  it('rejects a token signed with another secret', async () => {
    const token = await signSession('usr_1', SECRET)
    await expect(verifySession(token, 'a'.repeat(32))).rejects.toBeInstanceOf(SessionError)
  })

  it('rejects garbage', async () => {
    await expect(verifySession('nope', SECRET)).rejects.toBeInstanceOf(SessionError)
  })
})

describe('sessionCookie', () => {
  it('sets the security-relevant flags and max-age', () => {
    const cookie = sessionCookie('some-token-value')
    expect(cookie).toContain(`${SESSION_COOKIE}=some-token-value`)
    expect(cookie).toContain('HttpOnly')
    expect(cookie).toContain('SameSite=Lax')
    expect(cookie).toContain('Path=/')
    expect(cookie).toContain(`Max-Age=${SESSION_TTL_SECONDS}`)
  })
})
