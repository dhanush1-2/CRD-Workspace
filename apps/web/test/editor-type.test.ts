import { describe, it, expect } from 'vitest'
import { DEFAULT_FONT_SIZE, FONT_FAMILIES, FONT_SIZES } from '../src/components/editor-type.js'
import { getEditorSchema } from '../src/components/editor-schema.js'

describe('the curated type scale', () => {
  it('offers three families, System first', () => {
    expect(FONT_FAMILIES).toHaveLength(3)
    expect(FONT_FAMILIES[0]!.label).toBe('System')
    // Follows the design token rather than freezing today's stack into every
    // document that uses it.
    expect(FONT_FAMILIES[0]!.value).toBe('var(--font)')
  })

  it("offers the design's own size steps, with the body size among them", () => {
    expect([...FONT_SIZES]).toEqual([14, 16, 18, 21, 26, 32])
    expect(FONT_SIZES).toContain(DEFAULT_FONT_SIZE)
    expect(DEFAULT_FONT_SIZE).toBe(18)
  })

  it('has no duplicate labels or values', () => {
    expect(new Set(FONT_FAMILIES.map((f) => f.label)).size).toBe(FONT_FAMILIES.length)
    expect(new Set(FONT_FAMILIES.map((f) => f.value)).size).toBe(FONT_FAMILIES.length)
  })

  it('has the textStyle mark the family and size attributes hang off', () => {
    // FontFamily and FontSize are global attributes on textStyle, so without the
    // mark in the schema both controls would be silent no-ops.
    expect(getEditorSchema().marks.textStyle).toBeDefined()
  })
})
