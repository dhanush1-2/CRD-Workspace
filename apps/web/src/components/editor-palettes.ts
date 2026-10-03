/**
 * The two swatch palettes of the colour menus (handoff 12.5).
 *
 * The values are artwork, not UI chrome, so they are raw hex rather than tokens, the way
 * PALETTES in lib/splatter/geometry.ts is. They are also what gets written into a
 * document, which is a second reason to keep them literal: a stored colour must not
 * change if a token is ever retuned. The one exception is Violet, which the design names
 * as the accent itself and so follows it (editor-type.ts stores `var(--font)` the same way).
 */
export interface Swatch {
  /** Stable key for the test id: `tb-color-red`, `tb-highlight-yellow`. */
  id: string
  /** The accessible name and tooltip. */
  name: string
  /** What is painted on the swatch and on the trigger's bar, and what the document stores. */
  value: string
  /** Removes the colour instead of setting one: text "Default" and highlight "None". */
  clears?: true
}

export const TEXT_COLOURS: readonly Swatch[] = [
  // Default is the page's own text colour (--text). Choosing it removes the colour rather
  // than writing #1c1d1b onto the run, so default text stays default text.
  { id: 'default', name: 'Default', value: '#1c1d1b', clears: true },
  { id: 'grey', name: 'Grey', value: '#6c6f6a' },
  { id: 'violet', name: 'Violet', value: 'var(--accent)' },
  { id: 'red', name: 'Red', value: '#c4372b' },
  { id: 'orange', name: 'Orange', value: '#c9661a' },
  { id: 'green', name: 'Green', value: '#2f8a4f' },
  { id: 'blue', name: 'Blue', value: '#2f6fd0' },
  { id: 'pink', name: 'Pink', value: '#c2417f' },
]

export const HIGHLIGHT_COLOURS: readonly Swatch[] = [
  // None is painted as a white swatch with a red diagonal (a class, not this value).
  { id: 'none', name: 'None', value: 'transparent', clears: true },
  { id: 'yellow', name: 'Yellow', value: '#fde68a' },
  { id: 'green', name: 'Green', value: '#c9f0d3' },
  { id: 'blue', name: 'Blue', value: '#d3e4ff' },
  { id: 'pink', name: 'Pink', value: '#ffd6e8' },
  { id: 'violet', name: 'Violet', value: '#e4d8fb' },
  { id: 'orange', name: 'Orange', value: '#ffe0c2' },
  { id: 'grey', name: 'Grey', value: '#e6e6ea' },
]

/** What each trigger's bar shows before anything has been chosen (the design's defaults). */
export const DEFAULT_LAST_TEXT = '#1c1d1b'
export const DEFAULT_LAST_HIGHLIGHT = '#fde68a'

/**
 * The swatch that matches the colour at the selection. A run with no colour is the
 * palette's clearing swatch (Default, None); a colour outside the palette, from a paste
 * or another client, matches none and so marks nothing.
 */
export function selectedSwatch(palette: readonly Swatch[], current: string | null): Swatch | undefined {
  if (current === null) return palette.find((swatch) => swatch.clears)
  const wanted = current.trim().toLowerCase()
  return palette.find((swatch) => !swatch.clears && swatch.value.toLowerCase() === wanted)
}
