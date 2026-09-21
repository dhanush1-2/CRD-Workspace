import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('../src/lib/auth-guard.js', () => {
  class HttpError extends Error {
    constructor(
      readonly status: number,
      message: string,
    ) {
      super(message)
      this.name = 'HttpError'
    }
  }
  return { HttpError, requireUser: vi.fn() }
})

const { HttpError, requireUser } = await import('../src/lib/auth-guard.js')
const { getCurrentUser } = await import('../src/lib/current-user.js')

const mockedRequireUser = vi.mocked(requireUser)

beforeEach(() => {
  mockedRequireUser.mockReset()
})

describe('getCurrentUser', () => {
  it('returns the user when one is signed in', async () => {
    const user = { id: 'u1', email: 'a@b.test', name: 'Ada' }
    mockedRequireUser.mockResolvedValue(user)
    await expect(getCurrentUser()).resolves.toEqual(user)
  })

  it('returns null for a 401, which is the only "not signed in" signal', async () => {
    mockedRequireUser.mockRejectedValue(new HttpError(401, 'not authenticated'))
    await expect(getCurrentUser()).resolves.toBeNull()
  })

  it('rethrows a non-401 HttpError instead of reporting "signed out"', async () => {
    // A blanket try/catch would turn this into null, and the caller would show a
    // login page for a server fault — hiding the outage behind a plausible screen.
    mockedRequireUser.mockRejectedValue(new HttpError(500, 'internal error'))
    await expect(getCurrentUser()).rejects.toThrow('internal error')
  })

  it('rethrows an ordinary error, such as the database being unreachable', async () => {
    mockedRequireUser.mockRejectedValue(new Error('connect ECONNREFUSED 127.0.0.1:5433'))
    await expect(getCurrentUser()).rejects.toThrow('ECONNREFUSED')
  })
})
