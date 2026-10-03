import { describe, it, expect } from 'vitest'
import { formatInsertDate, normaliseLinkUrl } from '../src/components/editor-insert.js'

describe('normaliseLinkUrl', () => {
  it('puts https:// on an address with no scheme', () => {
    expect(normaliseLinkUrl('example.com')).toBe('https://example.com')
    expect(normaliseLinkUrl('example.com/a?b=1#c')).toBe('https://example.com/a?b=1#c')
  })

  it('leaves an address that has a scheme alone', () => {
    expect(normaliseLinkUrl('http://example.com')).toBe('http://example.com')
    expect(normaliseLinkUrl('HTTPS://example.com')).toBe('HTTPS://example.com')
    expect(normaliseLinkUrl('mailto:a@b.co')).toBe('mailto:a@b.co')
    expect(normaliseLinkUrl('tel:+15555550100')).toBe('tel:+15555550100')
  })

  it('treats a host with a port as a host, not a scheme', () => {
    expect(normaliseLinkUrl('localhost:3000')).toBe('https://localhost:3000')
    expect(normaliseLinkUrl('example.com:8080/x')).toBe('https://example.com:8080/x')
  })

  it('gives a protocol-relative address its scheme', () => {
    expect(normaliseLinkUrl('//example.com/x')).toBe('https://example.com/x')
  })

  it('trims, and returns null for nothing', () => {
    expect(normaliseLinkUrl('  example.com  ')).toBe('https://example.com')
    expect(normaliseLinkUrl('')).toBeNull()
    expect(normaliseLinkUrl('   ')).toBeNull()
  })

  it('does not wave a javascript: URL through as if it had a scheme of its own', () => {
    // It is not left bare either: it gains https://, which makes it a (dead) address
    // rather than a script. Tiptap's validation is the second line.
    expect(normaliseLinkUrl('javascript:alert(1)')).toBe('https://javascript:alert(1)')
  })
})

describe('formatInsertDate', () => {
  it('is the short American form, without a leading zero', () => {
    expect(formatInsertDate(new Date(2026, 9, 3))).toBe('Oct 3, 2026')
    expect(formatInsertDate(new Date(2027, 0, 15))).toBe('Jan 15, 2027')
  })
})
