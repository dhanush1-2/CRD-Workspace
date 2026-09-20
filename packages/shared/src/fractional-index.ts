/**
 * Fractional indexing over a base-62 alphabet chosen so that plain string
 * comparison matches digit order: '0' < '9' < 'A' < 'Z' < 'a' < 'z' in ASCII.
 *
 * The point of fractional indices in a CRDT board: inserting between two cards
 * touches only the inserted card. There is no renumbering, so no write to a
 * neighbour that could conflict with a concurrent edit to that neighbour.
 */
const DIGITS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'
const BASE = DIGITS.length

export class FractionalIndexError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'FractionalIndexError'
  }
}

function assertValid(key: string | null, label: string): void {
  if (key === null) return
  if (key.length === 0) throw new FractionalIndexError(`${label} must not be empty`)
  for (const char of key) {
    if (!DIGITS.includes(char)) {
      throw new FractionalIndexError(`${label} contains an invalid character: ${char}`)
    }
  }
  if (key.endsWith(DIGITS[0]!)) {
    throw new FractionalIndexError(
      `${label} ends in the lowest digit, which has no room below it: ${key}`,
    )
  }
}

/** The digit at position `i`, or `fallback` when the key does not reach that far. */
function digitAt(key: string | null, i: number, fallback: number): number {
  if (key === null || i >= key.length) return fallback
  return DIGITS.indexOf(key[i]!)
}

/**
 * Return a key strictly between `a` and `b`. `null` means unbounded on that side.
 *
 * The result never ends in the lowest digit, because the final digit is always
 * chosen strictly above the lower bound's digit. That invariant is what keeps this
 * function total: a key ending in '0' would have no room below its own last digit.
 */
export function between(a: string | null, b: string | null): string {
  assertValid(a, 'lower bound')
  assertValid(b, 'upper bound')

  if (a !== null && b !== null && a >= b) {
    throw new FractionalIndexError(`bounds out of order: ${a} >= ${b}`)
  }

  let result = ''
  for (let i = 0; ; i += 1) {
    const lo = digitAt(a, i, 0)
    // A missing digit on the right behaves as "past the last digit", so an open
    // upper bound gets the whole remaining range.
    const hi = digitAt(b, i, BASE)

    if (hi - lo > 1) {
      return result + DIGITS[lo + Math.floor((hi - lo) / 2)]!
    }

    // No room at this position. Adopt the lower bound's digit and descend.
    result += DIGITS[lo]!
  }
}
