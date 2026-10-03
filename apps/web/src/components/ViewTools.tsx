import { ROVING_ITEM } from './useRovingToolRow'
import { ToolButton, ToolSeparator, keepEditorSelection } from './ToolButton'
import {
  stepZoom,
  ZOOM_DEFAULT,
  ZOOM_MAX,
  ZOOM_MIN,
  type PageWidth,
  type ViewState,
} from './editor-view'
import styles from './editor-toolbar.module.css'

const WIDTHS: { id: PageWidth; label: string }[] = [
  { id: 'narrow', label: 'Narrow' },
  { id: 'wide', label: 'Wide' },
]

/**
 * The View tab (handoff 12.4): zoom, and the sheet's width. It takes no editor, on
 * purpose. View is the one tab a viewer is given, so nothing here may depend on being
 * able to edit; both controls act on the page, not on the document.
 */
export function ViewTools({ zoom, onZoom, pageWidth, onPageWidth }: ViewState) {
  // aria-disabled, not disabled: the roving row skips :disabled items and does not watch
  // attributes (see ToolButton), so a disabled "+" at 150% that held the row's Tab stop
  // would leave the row with none.
  const atMin = zoom <= ZOOM_MIN
  const atMax = zoom >= ZOOM_MAX

  return (
    <>
      <span className={styles.viewLabel}>Zoom</span>
      <ToolButton
        label="Zoom out"
        aria-disabled={atMin}
        data-testid="tb-view-zoom-out"
        onClick={() => onZoom(stepZoom(zoom, -1))}
      >
        <span className={styles.zoomGlyph}>−</span>
      </ToolButton>
      <button
        type="button"
        // The 58px field-style button of the design; the Style trigger's look at its own width.
        className={`${styles.tool} ${styles.toolField} ${styles.zoomValue}`}
        aria-label={`Zoom ${zoom}%. Reset to ${ZOOM_DEFAULT}%`}
        title="Reset zoom"
        data-testid="tb-view-zoom-value"
        {...ROVING_ITEM}
        onMouseDown={keepEditorSelection}
        onClick={() => onZoom(ZOOM_DEFAULT)}
      >
        {zoom}%
      </button>
      <ToolButton
        label="Zoom in"
        aria-disabled={atMax}
        data-testid="tb-view-zoom-in"
        onClick={() => onZoom(stepZoom(zoom, 1))}
      >
        <span className={styles.zoomGlyph}>+</span>
      </ToolButton>

      <ToolSeparator />

      <span className={styles.viewLabel}>Page width</span>
      <div className={styles.segmented} role="group" aria-label="Page width">
        {WIDTHS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            className={`${styles.segment} ${pageWidth === entry.id ? styles.segmentOn : ''}`}
            aria-pressed={pageWidth === entry.id}
            data-testid={`tb-view-width-${entry.id}`}
            {...ROVING_ITEM}
            onMouseDown={keepEditorSelection}
            onClick={() => onPageWidth(entry.id)}
          >
            {entry.label}
          </button>
        ))}
      </div>
    </>
  )
}
