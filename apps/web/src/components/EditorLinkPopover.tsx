'use client'

import { useEffect, useRef, useState, type FormEvent } from 'react'
import type { ChainedCommands } from '@tiptap/core'
import type { Editor } from '@tiptap/react'
import {
  absolutePositionToRelativePosition,
  relativePositionToAbsolutePosition,
  ySyncPluginKey,
} from '@tiptap/y-tiptap'
import { EditorMenu, type MenuControl } from './EditorMenu'
import { keepEditorSelection } from './ToolButton'
import { normaliseLinkUrl } from './editor-insert'
import styles from './editor-toolbar.module.css'

/**
 * The Link popover (handoff 12.6), built on the toolbar's shared menu shell.
 *
 * The trap in it: the field takes focus, so the editor loses its DOM selection, and a
 * naive Add then links a collapsed cursor, which is nothing. So the editor's selection is
 * saved when the popover opens and put back, with focus, before anything is applied, and
 * again if the popover is dismissed.
 *
 * It is kept as a pair of Yjs relative positions as well as the plain offsets, because
 * the document is shared: a peer can type before the selected words while the popover is
 * open. The sync plugin applies a remote change by replacing the document's content, so
 * ProseMirror's own position mapping cannot carry an offset across it; a relative
 * position is anchored to the characters themselves and resolves to wherever they are.
 *
 * One edge is left as it falls: a selection that begins at the very start of a block
 * anchors to the block's start, so text a peer types exactly there lands inside it.
 */

interface Range {
  from: number
  to: number
}

/** A selection as saved: the offsets, and the same two points anchored in the Y.Doc. */
interface SavedRange extends Range {
  anchored?: { from: unknown; to: unknown }
}

function saveRange(editor: Editor): SavedRange {
  const { from, to } = editor.state.selection
  const sync = ySyncPluginKey.getState(editor.state)
  // No sync plugin (an editor that is not bound to a document) leaves the plain offsets.
  if (!sync?.binding) return { from, to }
  const { type, binding } = sync
  return {
    from,
    to,
    anchored: {
      from: absolutePositionToRelativePosition(from, type, binding.mapping),
      to: absolutePositionToRelativePosition(to, type, binding.mapping),
    },
  }
}

/** Where the saved selection is now, after whatever has happened to the document since. */
function resolveRange(editor: Editor, saved: SavedRange): Range {
  const sync = ySyncPluginKey.getState(editor.state)
  if (!saved.anchored || !sync?.binding) return saved
  const { doc, type, binding } = sync
  const from = relativePositionToAbsolutePosition(doc, type, saved.anchored.from, binding.mapping)
  const to = relativePositionToAbsolutePosition(doc, type, saved.anchored.to, binding.mapping)
  // A point whose text is gone resolves to nothing; the offsets are the best that is left.
  if (from === null || to === null) return saved
  return { from, to: Math.max(from, to) }
}

/** Whether a link mark covers the range, or the caret when it is collapsed. */
function linkAt(editor: Editor, { from, to }: Range): boolean {
  const type = editor.schema.marks.link
  if (!type) return false
  const { doc } = editor.state
  const max = doc.content.size
  const start = Math.min(from, max)
  if (from === to) return Boolean(type.isInSet(doc.resolve(start).marks()))
  return doc.rangeHasMark(start, Math.min(to, max), type)
}

export function LinkMenu({
  editor,
  control,
  active,
}: {
  editor: Editor
  control: MenuControl
  /** Whether the selection is in a link, for the trigger's pressed state. */
  active: boolean
}) {
  // The selection as it was when the popover opened.
  const saved = useRef<SavedRange>({ from: 0, to: 0 })
  const [opened, setOpened] = useState({ href: '', canRemove: false })

  /** The saved selection put back, editor focused. Everything that applies or dismisses goes through this. */
  function restore(): { chain: ChainedCommands; range: Range } {
    const range = resolveRange(editor, saved.current)
    return { chain: editor.chain().focus().setTextSelection(range), range }
  }

  function onOpen(viaKeyboard: boolean) {
    saved.current = saveRange(editor)
    setOpened({
      href: (editor.getAttributes('link').href as string | undefined) ?? '',
      canRemove: linkAt(editor, saved.current),
    })
    control.onOpen(viaKeyboard)
  }

  /**
   * True when applied. False leaves the popover open, so an address Tiptap's link
   * validation refuses (a scheme it does not know, say) can be fixed.
   */
  function apply(raw: string): boolean {
    const href = normaliseLinkUrl(raw)
    if (!href) return false
    const range = resolveRange(editor, saved.current)
    const ranged = range.from !== range.to
    const inLink = !ranged && linkAt(editor, range)

    /** What the address does to the selection, written once for the check and the real run. */
    const link = (chain: ChainedCommands) => {
      if (ranged) return chain.setLink({ href })
      // A caret inside a link edits that link, the whole of it.
      if (inLink) return chain.extendMarkRange('link').setLink({ href })
      // A caret on nothing has no text to link. The address becomes the text, as a word
      // processor does, rather than silently linking an empty range.
      return chain.insertContent({
        type: 'text',
        text: href,
        marks: [{ type: 'link', attrs: { href } }],
      })
    }

    // A dry run first: restoring focus is not undone by a refusal, and the popover is
    // about to hand focus back to the editor.
    if (!link(editor.can().chain().setTextSelection(range)).run()) return false
    link(editor.chain().focus().setTextSelection(range)).run()
    control.onClose()
    return true
  }

  function remove() {
    // The whole link wherever the selection touches it, not only the selected part.
    restore().chain.extendMarkRange('link').unsetLink().run()
    control.onClose()
  }

  return (
    <EditorMenu
      name="insert-link"
      control={{ ...control, onOpen }}
      variant="popover"
      label="Link"
      title="Link"
      menuLabel="Link"
      text="Link"
      // Esc, or the trigger pressed again: back to the editor with the selection the
      // person had, not to the trigger.
      restoreTo={() => void restore().chain.run()}
      trigger={
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <path d="M6.5 9.5a2.5 2.5 0 0 0 3.5 0l2.5-2.5a2.5 2.5 0 0 0-3.5-3.5l-.7.7" />
          <path d="M9.5 6.5a2.5 2.5 0 0 0-3.5 0L3.5 9a2.5 2.5 0 0 0 3.5 3.5l.7-.7" />
        </svg>
      }
      active={active}
    >
      <LinkForm initialHref={opened.href} canRemove={opened.canRemove} onApply={apply} onRemove={remove} />
    </EditorMenu>
  )
}

function LinkForm({
  initialHref,
  canRemove,
  onApply,
  onRemove,
}: {
  initialHref: string
  canRemove: boolean
  onApply: (value: string) => boolean
  onRemove: () => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [value, setValue] = useState(initialHref)
  const [refused, setRefused] = useState(false)

  // "Opens focused" (12.6), by mouse or keyboard. The selection was saved before this
  // mounted; taking focus is what loses it from the page.
  useEffect(() => {
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [])

  function onSubmit(event: FormEvent) {
    event.preventDefault()
    setRefused(!onApply(value) && value.trim() !== '')
  }

  return (
    <form
      className={styles.linkForm}
      onSubmit={onSubmit}
      // Everything in the popover but the field keeps focus where it is: a press on its
      // padding would otherwise blur the field to the body, and Esc would find nothing
      // inside the popover to hand back.
      onMouseDown={(event) => {
        if (event.target !== inputRef.current) event.preventDefault()
      }}
    >
      <input
        ref={inputRef}
        type="text"
        inputMode="url"
        autoComplete="off"
        spellCheck={false}
        className={styles.linkInput}
        placeholder="Paste a link"
        aria-label="Link address"
        aria-invalid={refused || undefined}
        value={value}
        data-testid="tb-insert-link-input"
        onChange={(event) => {
          setValue(event.target.value)
          setRefused(false)
        }}
      />
      <button type="submit" className={styles.linkAdd} data-testid="tb-insert-link-apply">
        Add
      </button>
      <button
        type="button"
        className={styles.linkRemove}
        // aria-disabled, not disabled: it stays focusable and in the Tab order.
        aria-disabled={!canRemove}
        data-testid="tb-insert-link-remove"
        onMouseDown={keepEditorSelection}
        onClick={() => {
          if (canRemove) onRemove()
        }}
      >
        Remove
      </button>
    </form>
  )
}
