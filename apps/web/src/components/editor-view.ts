/**
 * The View tab's state, as plain values (handoff 12.4). Kept out of the components so the
 * limits can be read, and tested, without a browser.
 */

/** Zoom is a whole percentage, in steps of 10 from 70 to 150 (handoff 12.4). */
export const ZOOM_MIN = 70
export const ZOOM_MAX = 150
export const ZOOM_STEP = 10
export const ZOOM_DEFAULT = 100

/** The sheet's two widths (handoff 12.7: 780px and 1040px). The pixels live in the CSS. */
export type PageWidth = 'narrow' | 'wide'

/** One step up or down, held inside the range. A value already at a limit stays there. */
export function stepZoom(zoom: number, direction: 1 | -1): number {
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, zoom + direction * ZOOM_STEP))
}

/** What DocumentEditor holds and the View row reads and sets. */
export interface ViewState {
  zoom: number
  onZoom: (zoom: number) => void
  pageWidth: PageWidth
  onPageWidth: (width: PageWidth) => void
}
