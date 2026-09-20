import { describe, it, expect, vi, afterEach } from 'vitest'
import { signDocToken, verifyDocToken, DocTokenError } from '../src/doc-token.js'
import type { DocTokenClaims } from '../src/doc-token.js'

const SECRET = 'a'.repeat(32)
const OTHER_SECRET = 'b'.repeat(32)

const claims: DocTokenClaims = {
  sub: 'usr_1',
  docId: 'doc_1',
  role: 'editor',
  name: 'Dhanush',
  color: '#e11d48',
}

afterEach(() => { vi.useRealTimers() })

describe('doc token', () => {
  it('round-trips claims', async () => {
    const token = await signDocToken(claims, SECRET)
    await expect(verifyDocToken(token, SECRET)).resolves.toEqual(claims)
  })

  it('rejects a token signed with a different secret', async () => {
    const token = await signDocToken(claims, SECRET)
    await expect(verifyDocToken(token, OTHER_SECRET)).rejects.toBeInstanceOf(DocTokenError)
  })

  it('rejects an expired token', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
    const token = await signDocToken(claims, SECRET, 900)

    vi.setSystemTime(new Date('2026-01-01T00:15:01Z'))
    await expect(verifyDocToken(token, SECRET)).rejects.toBeInstanceOf(DocTokenError)
  })

  it('rejects garbage', async () => {
    await expect(verifyDocToken('not-a-jwt', SECRET)).rejects.toBeInstanceOf(DocTokenError)
  })

  it('rejects a token missing a required claim', async () => {
    const token = await signDocToken({ ...claims, docId: '' }, SECRET)
    await expect(verifyDocToken(token, SECRET)).rejects.toBeInstanceOf(DocTokenError)
  })

  it('rejects an unknown role', async () => {
    const token = await signDocToken(
      { ...claims, role: 'admin' as unknown as DocTokenClaims['role'] },
      SECRET,
    )
    await expect(verifyDocToken(token, SECRET)).rejects.toBeInstanceOf(DocTokenError)
  })
})
