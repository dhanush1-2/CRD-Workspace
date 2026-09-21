import { describe, it, expect } from 'vitest'
import { safeNext } from '../src/lib/safe-next.js'

describe('safeNext', () => {
  it('passes through an ordinary in-app path', () => {
    expect(safeNext('/workspaces/abc123')).toBe('/workspaces/abc123')
  })

  it('keeps a query string on an in-app path', () => {
    expect(safeNext('/documents/abc?nobc=1')).toBe('/documents/abc?nobc=1')
  })

  it('falls back when there is no target', () => {
    expect(safeNext(undefined)).toBe('/')
    expect(safeNext(null)).toBe('/')
    expect(safeNext('')).toBe('/')
  })

  it('honours an explicit fallback', () => {
    expect(safeNext(undefined, '/login')).toBe('/login')
  })

  it('rejects an absolute URL to another origin', () => {
    expect(safeNext('https://evil.example/steal')).toBe('/')
  })

  it('rejects a protocol-relative URL, which the browser resolves off-origin', () => {
    // '//evil.example' starts with '/', so a naive startsWith('/') check lets it
    // through — and the browser then navigates to https://evil.example. This is
    // the open-redirect case the helper exists for.
    expect(safeNext('//evil.example/steal')).toBe('/')
  })

  it('rejects a backslash-escaped protocol-relative URL', () => {
    // Browsers normalise '\' to '/' in URL paths, so '/\evil.example' resolves the
    // same way '//evil.example' does.
    expect(safeNext('/\\evil.example/steal')).toBe('/')
  })

  it('rejects a scheme that is not http, such as javascript:', () => {
    expect(safeNext('javascript:alert(1)')).toBe('/')
  })
})
