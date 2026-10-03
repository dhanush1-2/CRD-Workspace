/**
 * The only font families a document may use.
 *
 * Curated on purpose. The design specifies the document's type, and an open font
 * list lets a document stop looking like this product; three families cover prose,
 * a print feel and code, which is what a writing tool actually needs.
 *
 * System is stored as `var(--font)` rather than the expanded stack, so a document
 * written today follows the design if that token ever changes. Serif and Mono are
 * literal stacks because there is no token for either.
 */
export const FONT_FAMILIES = [
  { label: 'System', value: 'var(--font)' },
  { label: 'Serif', value: 'ui-serif, Georgia, Cambria, "Times New Roman", serif' },
  { label: 'Mono', value: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace' },
] as const

/**
 * The design's own type steps. No free-text size field: the same reasoning as
 * FONT_FAMILIES, and a 7px or 300px paragraph is not a feature.
 */
export const FONT_SIZES = [14, 16, 18, 21, 26, 32] as const

/** The document body's size, so the size control can show what plain text already is. */
export const DEFAULT_FONT_SIZE = 18
