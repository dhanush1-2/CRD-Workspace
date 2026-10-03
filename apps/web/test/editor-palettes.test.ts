import { describe, it, expect } from 'vitest'
import {
  HIGHLIGHT_COLOURS,
  TEXT_COLOURS,
  selectedSwatch,
} from '../src/components/editor-palettes.js'

describe('the swatch palettes', () => {
  it('hold the design’s eight text colours and eight highlights, in order', () => {
    // Handoff 12.5, verbatim: these are what a document stores, so a typo here is a
    // colour nobody chose.
    expect(TEXT_COLOURS.map((s) => [s.name, s.value])).toEqual([
      ['Default', '#1c1d1b'],
      ['Grey', '#6c6f6a'],
      ['Violet', 'var(--accent)'],
      ['Red', '#c4372b'],
      ['Orange', '#c9661a'],
      ['Green', '#2f8a4f'],
      ['Blue', '#2f6fd0'],
      ['Pink', '#c2417f'],
    ])
    expect(HIGHLIGHT_COLOURS.map((s) => [s.name, s.clears ? null : s.value])).toEqual([
      ['None', null],
      ['Yellow', '#fde68a'],
      ['Green', '#c9f0d3'],
      ['Blue', '#d3e4ff'],
      ['Pink', '#ffd6e8'],
      ['Violet', '#e4d8fb'],
      ['Orange', '#ffe0c2'],
      ['Grey', '#e6e6ea'],
    ])
  })

  it('give each swatch its own id, and exactly one clears the colour', () => {
    for (const palette of [TEXT_COLOURS, HIGHLIGHT_COLOURS]) {
      expect(new Set(palette.map((s) => s.id)).size).toBe(palette.length)
      expect(palette.filter((s) => s.clears)).toHaveLength(1)
    }
  })
})

describe('selectedSwatch', () => {
  it('picks the clearing swatch for a run with no colour', () => {
    expect(selectedSwatch(TEXT_COLOURS, null)?.id).toBe('default')
    expect(selectedSwatch(HIGHLIGHT_COLOURS, null)?.id).toBe('none')
  })

  it('matches a stored colour to its swatch, ignoring case and padding', () => {
    expect(selectedSwatch(TEXT_COLOURS, '#C4372B')?.id).toBe('red')
    expect(selectedSwatch(HIGHLIGHT_COLOURS, ' #d3e4ff ')?.id).toBe('blue')
    expect(selectedSwatch(TEXT_COLOURS, 'var(--accent)')?.id).toBe('violet')
  })

  it('marks nothing for a colour outside the palette', () => {
    // A paste or another client can bring any colour. Claiming Default for it would be
    // wrong, and so would claiming the nearest swatch.
    expect(selectedSwatch(TEXT_COLOURS, 'rgb(1, 2, 3)')).toBeUndefined()
  })

  it('does not take the clearing swatch’s painted colour for a stored one', () => {
    // Default is painted #1c1d1b, but a run that really carries #1c1d1b is a coloured
    // run, not an uncoloured one.
    expect(selectedSwatch(TEXT_COLOURS, '#1c1d1b')).toBeUndefined()
  })
})
