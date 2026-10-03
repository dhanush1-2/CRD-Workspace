import { useCallback, type KeyboardEvent } from 'react'

/**
 * The attribute that puts a control in the tool row's roving tabindex. ToolButton sets it
 * itself. A control that is not a ToolButton (a dropdown trigger built on its own button)
 * spreads `ROVING_ITEM` onto its focusable element to join.
 *
 * The escape hatch: anything inside a menu or popover must not carry it, or the menu's
 * own items become row stops (the row collects by subtree, wherever the DOM sits). A
 * ToolButton in that position takes `roving={false}`; a plain element simply does not
 * spread this.
 *
 * Use `aria-disabled`, never the `disabled` attribute, on a row item. The selector below
 * skips :disabled items and nothing observes attribute changes, so disabling the current
 * stop would leave the row with no Tab stop until some unrelated child mutation.
 */
export const ROVING_ITEM = { 'data-roving': '' } as const
const ITEM_SELECTOR = '[data-roving]:not(:disabled)'

function itemsOf(row: HTMLElement): HTMLElement[] {
  return Array.from(row.querySelectorAll<HTMLElement>(ITEM_SELECTOR))
}

/** Exactly one item is a Tab stop: the one already marked if it is still there, else the first. */
function normalise(row: HTMLElement, preferred?: HTMLElement) {
  const items = itemsOf(row)
  const stop =
    (preferred && items.includes(preferred) ? preferred : undefined) ??
    items.find((item) => item.tabIndex === 0) ??
    items[0]
  for (const item of items) item.tabIndex = item === stop ? 0 : -1
}

/**
 * A roving tabindex for the tool row, the pattern the tab strip beside it already uses:
 * the whole row is one Tab stop, the arrow keys move within it and Home/End jump to its
 * ends. Without it every control is a stop, and each task that adds controls (Style and
 * colour, Insert, View) lengthens the way from the page to the tab strip.
 *
 * Spread the result on the row element. Controls join by carrying `data-roving`
 * (see ROVING_ITEM); no per-control wiring beyond that.
 *
 * The tabindex is set on the DOM, not through props, so a control's own props never have
 * to know which item is current, and controls that mount later (a menu trigger that
 * appears once the editor does) are picked up by the observer.
 */
export function useRovingToolRow() {
  // A ref callback with a cleanup: runs on mount, and again on remount when the row's key
  // changes with the tab.
  const ref = useCallback((row: HTMLElement | null) => {
    if (!row) return
    normalise(row)
    const observer = new MutationObserver(() => normalise(row))
    observer.observe(row, { childList: true, subtree: true })
    // Focus by any route (arrow, Tab, a click that does take focus) makes that item the stop.
    const onFocusIn = (event: FocusEvent) => {
      const target = event.target
      if (target instanceof HTMLElement && target.matches(ITEM_SELECTOR)) normalise(row, target)
    }
    row.addEventListener('focusin', onFocusIn)
    return () => {
      observer.disconnect()
      row.removeEventListener('focusin', onFocusIn)
    }
  }, [])

  const onKeyDown = useCallback((event: KeyboardEvent<HTMLElement>) => {
    // A modified arrow or Home belongs to the browser or the page: Alt+Left is Back and
    // Ctrl+Home is the top of the page, and swallowing them while a tool has focus would
    // make those shortcuts quietly stop working there.
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
    const target = event.target
    // Only from an item: arrows inside a menu or a text field in the row belong to it.
    if (!(target instanceof HTMLElement) || !target.matches(ITEM_SELECTOR)) return
    const items = itemsOf(event.currentTarget)
    const index = items.indexOf(target)
    let next: number
    if (event.key === 'ArrowRight') next = (index + 1) % items.length
    else if (event.key === 'ArrowLeft') next = (index - 1 + items.length) % items.length
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = items.length - 1
    else return
    event.preventDefault()
    items[next]?.focus()
  }, [])

  return { ref, onKeyDown }
}
