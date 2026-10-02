import { describe, it, expect } from 'vitest'
import { formatCount, formatRelativeTime } from '../src/lib/format.js'

describe('formatCount', () => {
  it('uses the singular for exactly one and the plural otherwise, including zero', () => {
    expect(formatCount(1, 'document')).toBe('1 document')
    expect(formatCount(0, 'document')).toBe('0 documents')
    expect(formatCount(2, 'document')).toBe('2 documents')
  })

  it('takes an irregular plural', () => {
    expect(formatCount(1, 'person', 'people')).toBe('1 person')
    expect(formatCount(3, 'person', 'people')).toBe('3 people')
  })
})

describe('formatRelativeTime', () => {
  const now = new Date('2026-10-01T12:00:00Z')
  const ago = (ms: number) => new Date(now.getTime() - ms)
  const MIN = 60_000
  const HOUR = 60 * MIN
  const DAY = 24 * HOUR

  it('says "just now" under a minute, and for a timestamp slightly in the future', () => {
    expect(formatRelativeTime(ago(0), now)).toBe('just now')
    expect(formatRelativeTime(ago(59_999), now)).toBe('just now')
    expect(formatRelativeTime(ago(-5_000), now)).toBe('just now')
  })

  it('counts minutes, singular at exactly one', () => {
    expect(formatRelativeTime(ago(MIN), now)).toBe('1 minute ago')
    expect(formatRelativeTime(ago(2 * MIN + 30_000), now)).toBe('2 minutes ago')
    expect(formatRelativeTime(ago(HOUR - 1), now)).toBe('59 minutes ago')
  })

  it('counts hours, singular at exactly one', () => {
    expect(formatRelativeTime(ago(HOUR), now)).toBe('1 hour ago')
    expect(formatRelativeTime(ago(5 * HOUR), now)).toBe('5 hours ago')
    expect(formatRelativeTime(ago(DAY - 1), now)).toBe('23 hours ago')
  })

  it('says "yesterday" from 24 to 47 hours', () => {
    expect(formatRelativeTime(ago(DAY), now)).toBe('yesterday')
    expect(formatRelativeTime(ago(2 * DAY - 1), now)).toBe('yesterday')
  })

  it('counts several days up to a week', () => {
    expect(formatRelativeTime(ago(2 * DAY), now)).toBe('2 days ago')
    expect(formatRelativeTime(ago(6 * DAY + 23 * HOUR), now)).toBe('6 days ago')
  })

  it('falls back to a short date from a week on, with the year only when it differs', () => {
    // Built in local time, because the formatter reads local calendar fields.
    const localNow = new Date(2026, 9, 1, 12)
    expect(formatRelativeTime(new Date(2026, 8, 20, 12), localNow)).toBe('Sep 20')
    expect(formatRelativeTime(new Date(2025, 11, 30, 12), localNow)).toBe('Dec 30, 2025')
  })
})
