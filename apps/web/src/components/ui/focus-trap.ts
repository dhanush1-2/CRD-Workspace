// Tab containment for modal dialogs, shared by Sheet and CommandPalette so the two
// cannot drift apart.

export const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/**
 * Call from a keydown handler. On Tab, keeps focus inside `container`: wraps from the
 * last control to the first (and back with Shift), and pulls focus in if it has
 * strayed outside, as after a click on the dialog's non-focusable padding, which
 * drops focus to <body>. A modal that lets Tab walk into the page behind it is a
 * modal only visually. Other keys are ignored.
 */
export function containTab(event: KeyboardEvent, container: HTMLElement | null): void {
  if (event.key !== 'Tab' || !container) return
  const items = [...container.querySelectorAll<HTMLElement>(FOCUSABLE)]
  if (items.length === 0) return
  const first = items[0]!
  const last = items[items.length - 1]!
  const active = document.activeElement
  if (!container.contains(active)) {
    event.preventDefault()
    ;(event.shiftKey ? last : first).focus()
  } else if (!event.shiftKey && active === last) {
    event.preventDefault()
    first.focus()
  } else if (event.shiftKey && active === first) {
    event.preventDefault()
    last.focus()
  }
}
