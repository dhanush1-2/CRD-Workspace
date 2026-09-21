import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { loadConfig } from '../src/config.js'

const ORIGINAL_SECRET = process.env.SYNC_JWT_SECRET
const ORIGINAL_PORT = process.env.SYNC_PORT

beforeEach(() => {
  delete process.env.SYNC_JWT_SECRET
  delete process.env.SYNC_PORT
})

afterEach(() => {
  if (ORIGINAL_SECRET === undefined) delete process.env.SYNC_JWT_SECRET
  else process.env.SYNC_JWT_SECRET = ORIGINAL_SECRET
  if (ORIGINAL_PORT === undefined) delete process.env.SYNC_PORT
  else process.env.SYNC_PORT = ORIGINAL_PORT
})

describe('loadConfig', () => {
  it('accepts a real, long-enough secret', () => {
    process.env.SYNC_JWT_SECRET = 'a-real-secret-that-is-long-enough!!'
    expect(loadConfig().jwtSecret).toBe('a-real-secret-that-is-long-enough!!')
  })

  it('throws when the secret is missing', () => {
    expect(() => loadConfig()).toThrow(/must be set/)
  })

  it('throws when the secret is too short', () => {
    process.env.SYNC_JWT_SECRET = 'short'
    expect(() => loadConfig()).toThrow(/must be set/)
  })

  it('throws when the secret is still the .env.example placeholder', () => {
    // The exact placeholder committed in .env.example. `cp .env.example .env` is
    // Task 2's own documented setup step, and this value is 38 characters — long
    // enough to sail past a bare length check.
    process.env.SYNC_JWT_SECRET = 'replace-me-with-a-different-32-bytes'
    expect(() => loadConfig()).toThrow(/placeholder/)
  })
})
