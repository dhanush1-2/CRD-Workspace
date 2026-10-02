import { describe, it, expect } from 'vitest'
import { createRandom } from '@/lib/splatter/random'

describe('createRandom', () => {
  it('is deterministic for a seed', () => {
    const a = createRandom(1234)
    const b = createRandom(1234)
    const first = [a.next(), a.next(), a.next()]
    const second = [b.next(), b.next(), b.next()]
    expect(first).toEqual(second)
  })

  it('differs across seeds', () => {
    expect(createRandom(1).next()).not.toBe(createRandom(2).next())
  })

  it('stays in [0,1) over many draws', () => {
    const r = createRandom(7)
    for (let i = 0; i < 10_000; i += 1) {
      const value = r.next()
      expect(value).toBeGreaterThanOrEqual(0)
      expect(value).toBeLessThan(1)
    }
  })

  it('range and int respect their bounds, and int is inclusive', () => {
    const r = createRandom(99)
    const seen = new Set<number>()
    for (let i = 0; i < 2_000; i += 1) {
      const value = r.range(5, 7)
      expect(value).toBeGreaterThanOrEqual(5)
      expect(value).toBeLessThan(7)
      seen.add(r.int(1, 3))
    }
    // int(1,3) must be able to produce 3, or every "0-3 drips" range in the
    // geometry silently loses its top value.
    expect([...seen].sort()).toEqual([1, 2, 3])
  })
})
