'use client'

import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'
import type { Editor } from '@tiptap/react'
import { HomeTools } from './HomeTools'
import { keepEditorSelection } from './ToolButton'
import { useRovingToolRow } from './useRovingToolRow'
import styles from './editor-toolbar.module.css'

export type ToolbarTab = 'home' | 'insert' | 'view'

const TABS: { id: ToolbarTab; label: string }[] = [
  { id: 'home', label: 'Home' },
  { id: 'insert', label: 'Insert' },
  { id: 'view', label: 'View' },
]

/** The design's debounce for the live count: "about 150ms". */
const WORD_COUNT_DEBOUNCE_MS = 150

/**
 * Whitespace-separated tokens. Blocks are joined with a space: doc.textContent, which
 * the design names, concatenates paragraphs with nothing between them, so "one" and
 * "two" in separate paragraphs would count as the single word "onetwo".
 */
function countWords(editor: Editor): number {
  const { doc } = editor.state
  const text = doc.textBetween(0, doc.content.size, ' ', ' ').trim()
  return text === '' ? 0 : text.split(/\s+/).length
}

function useWordCount(editor: Editor | null): number {
  const [count, setCount] = useState(0)

  useEffect(() => {
    if (!editor) {
      setCount(0)
      return
    }
    let timer: ReturnType<typeof setTimeout> | undefined
    const read = () => setCount(countWords(editor))
    // The editor may already hold content by the time this subscribes.
    read()
    const onTransaction = ({ transaction }: { transaction: { docChanged: boolean } }) => {
      if (!transaction.docChanged) return
      clearTimeout(timer)
      timer = setTimeout(read, WORD_COUNT_DEBOUNCE_MS)
    }
    // 'transaction', not 'update': a peer's edit arrives as a transaction too, and the
    // count is of the shared document, not of what this person typed.
    editor.on('transaction', onTransaction)
    return () => {
      clearTimeout(timer)
      editor.off('transaction', onTransaction)
    }
  }, [editor])

  return count
}

interface EditorToolbarProps {
  /** Null until Tiptap has mounted, which is after hydration. */
  editor: Editor | null
  readOnly: boolean
}

/**
 * The Word-style ribbon (handoff 12.1): a floating glass panel above the page, not part
 * of it. Row 1 holds the tabs, a "View only" chip for viewers and the word count; row 2
 * holds the active tab's tools, added group by group.
 */
export function EditorToolbar({ editor, readOnly }: EditorToolbarProps) {
  const ids = useId()
  // The tab is local state; nothing outside the toolbar needs to know which is open.
  const [tab, setTab] = useState<ToolbarTab>('home')
  const tabRefs = useRef(new Map<ToolbarTab, HTMLButtonElement>())
  const words = useWordCount(editor)
  const roving = useRovingToolRow()

  // A viewer cannot edit, so Home and Insert are not disabled, they are absent. Derived
  // rather than stored so a role change cannot leave the open tab pointing at one.
  const visible = readOnly ? TABS.filter((entry) => entry.id === 'view') : TABS
  const current = visible.some((entry) => entry.id === tab) ? tab : readOnly ? 'view' : 'home'

  function select(next: ToolbarTab) {
    setTab(next)
    tabRefs.current.get(next)?.focus()
  }

  // The tablist pattern: arrows move between tabs and Home/End jump, so a keyboard user
  // is one Tab stop from the whole strip rather than three.
  function onKeyDown(event: KeyboardEvent) {
    const index = visible.findIndex((entry) => entry.id === current)
    let next: number
    if (event.key === 'ArrowRight') next = (index + 1) % visible.length
    else if (event.key === 'ArrowLeft') next = (index - 1 + visible.length) % visible.length
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = visible.length - 1
    else return
    event.preventDefault()
    const target = visible[next]
    if (target) select(target.id)
  }

  return (
    <section className={styles.root} aria-label="Document toolbar" data-testid="tb-root">
      <div className={styles.panel}>
        <div className={styles.tabsRow}>
          <div
            className={styles.tabs}
            role="tablist"
            aria-label="Toolbar sections"
            onKeyDown={onKeyDown}
          >
            {visible.map((entry) => (
              <button
                key={entry.id}
                ref={(node) => {
                  if (node) tabRefs.current.set(entry.id, node)
                  else tabRefs.current.delete(entry.id)
                }}
                type="button"
                role="tab"
                id={`${ids}-tab-${entry.id}`}
                aria-selected={entry.id === current}
                aria-controls={`${ids}-row-${entry.id}`}
                tabIndex={entry.id === current ? 0 : -1}
                className={`${styles.tab} ${entry.id === current ? styles.tabActive : ''}`}
                data-testid={`tb-tab-${entry.id}`}
                // Switching tabs must not take focus out of the editor either: the tool
                // the user is heading for acts on the selection they already have.
                onMouseDown={keepEditorSelection}
                onClick={() => setTab(entry.id)}
              >
                {entry.label}
              </button>
            ))}
          </div>
          {readOnly && (
            <span className={styles.viewOnly} data-testid="tb-viewonly">
              View only
            </span>
          )}
          <span className={styles.wordCount} data-testid="tb-wordcount">
            {words} {words === 1 ? 'word' : 'words'}
          </span>
        </div>
        <div className={styles.divider} />
        {/* Keyed by tab so the row remounts and its entrance fade replays on a switch. */}
        <div
          key={current}
          className={styles.toolsRow}
          role="tabpanel"
          id={`${ids}-row-${current}`}
          aria-labelledby={`${ids}-tab-${current}`}
          data-testid={`tb-row-${current}`}
          // One Tab stop for the row, arrows within it.
          ref={roving.ref}
          onKeyDown={roving.onKeyDown}
        >
          {/* No editor yet means no controls: a button that cannot act is worse than none. */}
          {current === 'home' && editor && <HomeTools editor={editor} />}
        </div>
      </div>
    </section>
  )
}
