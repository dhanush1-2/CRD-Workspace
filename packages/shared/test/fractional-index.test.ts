import { describe, it, expect } from 'vitest'
import { between, FractionalIndexError } from '../src/fractional-index.js'

describe('between', () => {
  it('generates a key when both bounds are open', () => {
    const key = between(null, null)
    expect(key.length).toBeGreaterThan(0)
  })

  it('appends after an existing key', () => {
    const first = between(null, null)
    const second = between(first, null)
    expect(second > first).toBe(true)
  })

  it('prepends before an existing key', () => {
    const first = between(null, null)
    const zeroth = between(null, first)
    expect(zeroth < first).toBe(true)
  })

  it('inserts strictly between two adjacent keys', () => {
    const a = between(null, null)
    const b = between(a, null)
    const mid = between(a, b)
    expect(a < mid).toBe(true)
    expect(mid < b).toBe(true)
  })

  it('never produces a key ending in the lowest digit', () => {
    // This invariant is what guarantees between(a, b) is always solvable:
    // a key ending in '0' has no room below its own last digit.
    let upper: string | null = between(null, null)
    for (let i = 0; i < 200; i += 1) {
      const key = between(null, upper)
      expect(key.endsWith('0')).toBe(false)
      upper = key
    }
  })

  it('survives 100 repeated midpoint insertions at the same position', () => {
    let a = between(null, null)
    const b = between(a, null)
    for (let i = 0; i < 100; i += 1) {
      const mid = between(a, b)
      expect(a < mid && mid < b).toBe(true)
      a = mid
    }
  })

  it('keeps a randomly built list sorted', () => {
    const keys: string[] = [between(null, null)]

    for (let i = 0; i < 500; i += 1) {
      const at = Math.floor(Math.random() * (keys.length + 1))
      const left = at === 0 ? null : keys[at - 1]!
      const right = at === keys.length ? null : keys[at]!
      const key = between(left, right)
      keys.splice(at, 0, key)
    }

    const sorted = [...keys].sort()
    expect(keys).toEqual(sorted)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('rejects bounds that are not in order', () => {
    const a = between(null, null)
    const b = between(a, null)
    expect(() => between(b, a)).toThrow(FractionalIndexError)
    expect(() => between(a, a)).toThrow(FractionalIndexError)
  })

  it('rejects a key containing a character outside the alphabet', () => {
    expect(() => between('!!', null)).toThrow(FractionalIndexError)
  })
})
