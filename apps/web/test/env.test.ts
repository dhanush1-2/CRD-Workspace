import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { env } from '../src/lib/env.js'

const ORIGINAL_SESSION_SECRET = process.env.SESSION_SECRET
const ORIGINAL_SYNC_JWT_SECRET = process.env.SYNC_JWT_SECRET

function restore(name: string, original: string | undefined) {
  if (original === undefined) delete process.env[name]
  else process.env[name] = original
}

beforeEach(() => {
  delete process.env.SESSION_SECRET
  delete process.env.SYNC_JWT_SECRET
})

afterEach(() => {
  restore('SESSION_SECRET', ORIGINAL_SESSION_SECRET)
  restore('SYNC_JWT_SECRET', ORIGINAL_SYNC_JWT_SECRET)
})

describe('env.sessionSecret', () => {
  it('accepts a real, long-enough secret', () => {
    process.env.SESSION_SECRET = 'a-real-secret-that-is-long-enough!!'
    expect(env.sessionSecret).toBe('a-real-secret-that-is-long-enough!!')
  })

  it('throws when missing', () => {
    expect(() => env.sessionSecret).toThrow(/must be set/)
  })

  it('throws when too short', () => {
    process.env.SESSION_SECRET = 'short'
    expect(() => env.sessionSecret).toThrow(/must be set/)
  })

  it('throws when still the .env.example placeholder', () => {
    // The exact placeholder committed in .env.example. `cp .env.example .env` is
    // Task 2's own documented setup step, and this value is 35 characters — long
    // enough to sail past a bare length check.
    process.env.SESSION_SECRET = 'replace-me-with-32-bytes-of-random'
    expect(() => env.sessionSecret).toThrow(/placeholder/)
  })
})

describe('env.syncJwtSecret', () => {
  it('accepts a real, long-enough secret', () => {
    process.env.SYNC_JWT_SECRET = 'a-real-secret-that-is-long-enough!!'
    expect(env.syncJwtSecret).toBe('a-real-secret-that-is-long-enough!!')
  })

  it('throws when still the .env.example placeholder', () => {
    process.env.SYNC_JWT_SECRET = 'replace-me-with-a-different-32-bytes'
    expect(() => env.syncJwtSecret).toThrow(/placeholder/)
  })
})

describe('env.appUrl', () => {
  const ORIGINAL_APP_URL = process.env.APP_URL

  afterEach(() => {
    restore('APP_URL', ORIGINAL_APP_URL)
  })

  it('returns the origin, dropping any trailing slash or path', () => {
    process.env.APP_URL = 'https://crdt-web.onrender.com/'
    expect(env.appUrl).toBe('https://crdt-web.onrender.com')
    process.env.APP_URL = 'https://crdt-web.onrender.com/some/path?x=1'
    expect(env.appUrl).toBe('https://crdt-web.onrender.com')
  })

  it('accepts http for local development', () => {
    process.env.APP_URL = 'http://localhost:3000'
    expect(env.appUrl).toBe('http://localhost:3000')
  })

  it('throws when missing or blank', () => {
    delete process.env.APP_URL
    expect(() => env.appUrl).toThrow(/APP_URL must be set/)
    process.env.APP_URL = '   '
    expect(() => env.appUrl).toThrow(/APP_URL must be set/)
  })

  it('throws on something that is not a URL', () => {
    process.env.APP_URL = 'crdt-web.onrender.com'
    expect(() => env.appUrl).toThrow(/not a valid URL/)
  })

  it('throws on a non-http scheme', () => {
    process.env.APP_URL = 'ftp://example.com'
    expect(() => env.appUrl).toThrow(/http or https/)
  })
})
