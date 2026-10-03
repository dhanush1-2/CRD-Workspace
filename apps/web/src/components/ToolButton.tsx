import type { ButtonHTMLAttributes, MouseEvent, ReactNode } from 'react'
import styles from './editor-toolbar.module.css'

/**
 * Stops a mousedown from moving focus off the editor.
 *
 * A button takes focus on mousedown, which blurs the editor and, with it, the
 * selection every formatting command acts on: the click then applies bold to nothing.
 * Cancelling the default of mousedown (not click, which is too late) keeps focus where
 * it was. Keyboard users are unaffected: Tab still focuses a button and Enter and Space
 * still press it. Every control in the toolbar, tabs included, goes through this.
 */
export function keepEditorSelection(event: MouseEvent) {
  event.preventDefault()
}

interface ToolButtonProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'type' | 'title' | 'aria-label' | 'onMouseDown' | 'className'> {
  /** The accessible name. An icon-only button is otherwise unnamed. */
  label: string
  /** The tooltip, which carries the shortcut ("Bold (⌘B)"). Defaults to the label. */
  title?: string
  /** Set for toggles. Highlights the button and exposes aria-pressed. */
  active?: boolean
  /**
   * Visible text beside the icon, for the Insert tab's labelled buttons. Pass the same
   * string as `label`, so what is announced is what is read.
   */
  text?: string
  children?: ReactNode
}

/** The toolbar's one button (handoff 12.1). */
export function ToolButton({ label, title, active, text, children, ...rest }: ToolButtonProps) {
  const classes = [styles.tool, active ? styles.toolActive : '', text ? styles.toolLabelled : '']
  return (
    <button
      {...rest}
      type="button"
      className={classes.filter(Boolean).join(' ')}
      aria-label={label}
      title={title ?? label}
      aria-pressed={active}
      onMouseDown={keepEditorSelection}
    >
      {children}
      {text}
    </button>
  )
}

/** The 1x20px rule between groups (handoff 12.1). Decorative, so hidden from assistive tech. */
export function ToolSeparator() {
  return <span className={styles.separator} aria-hidden="true" />
}
