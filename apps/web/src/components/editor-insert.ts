/**
 * The pure parts of the Insert tab: what the Link popover does to what was typed, and
 * what the Date tool writes. Kept out of the components so they can be read, and tested,
 * without a browser.
 */

/**
 * A URL as the Link popover applies it (handoff 12.6: "URLs without a scheme get
 * https://"). Returns null for an empty field, which applies nothing.
 *
 * A scheme here is `name://` or one of the two address schemes that have no slashes,
 * `mailto:` and `tel:`. "example.com:8080" and "localhost:3000" have a colon but are
 * hosts with a port, not schemes, so they get https:// like any other bare address.
 * Anything else with a scheme (javascript: included) is left to Tiptap's own link
 * validation, which refuses it, rather than being decided here.
 */
export function normaliseLinkUrl(input: string): string | null {
  const url = input.trim()
  if (url === '') return null
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(url) || /^(mailto|tel):/i.test(url)) return url
  // A protocol-relative address keeps its host and takes the scheme.
  if (url.startsWith('//')) return `https:${url}`
  return `https://${url}`
}

/** Today's date as the Date tool writes it (handoff 12.3): "Oct 3, 2026". */
export function formatInsertDate(date: Date): string {
  // en-US pinned: the design's format is the American short form whatever the browser's locale.
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}
