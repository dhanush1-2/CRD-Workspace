'use client'

import type { ReactNode } from 'react'
import { EditorContent, useEditor } from '@tiptap/react'
import Collaboration from '@tiptap/extension-collaboration'
import CollaborationCaret from '@tiptap/extension-collaboration-caret'
import type * as Y from 'yjs'
import type { WebsocketProvider } from 'y-websocket'
import { EditorToolbar } from './EditorToolbar'
import { EDITOR_FRAGMENT } from './editor-fragment'
import { editorExtensions } from './editor-schema'

interface DocumentEditorProps {
  /** Null until the session exists, which is one effect after the first render. */
  doc: Y.Doc | null
  provider: WebsocketProvider | null
  user: { name: string; color: string }
  readOnly?: boolean
  /** The sheet's own styles. They live with the page, which owns its width and margin. */
  sheetClassName?: string
  /** The document's title, rendered at the top of the sheet. */
  heading: ReactNode
}

/**
 * The document surface: a toolbar, and below it the sheet the text is typed on.
 *
 * This owns `useEditor` rather than a component beneath the sheet because the toolbar
 * is a separate floating panel above it (handoff 12.1) and has to read the same editor.
 * It replaced Editor.tsx, which had shrunk to a hook call and one element.
 *
 * It renders before the session exists, with a toolbar and no editor, so server HTML
 * and the first client render already have the toolbar's height. Mounting it only once
 * the session was ready made the sheet jump down by the toolbar's height on every load.
 */
export function DocumentEditor({
  doc,
  provider,
  user,
  readOnly = false,
  sheetClassName,
  heading,
}: DocumentEditorProps) {
  const collaborative = doc !== null && provider !== null

  const editor = useEditor(
    {
      // Next.js renders this on the server first; Tiptap must not render until hydration.
      immediatelyRender: false,
      // Not editable until it is bound: text typed into an editor with no Y.Doc behind
      // it would be thrown away when the binding arrives.
      editable: !readOnly && collaborative,
      extensions: [
        // The document's shape lives in one place; see editor-schema.ts, which also
        // explains why StarterKit's undo is off.
        ...editorExtensions,
        ...(collaborative
          ? [
              Collaboration.configure({ document: doc, field: EDITOR_FRAGMENT }),
              CollaborationCaret.configure({ provider, user }),
            ]
          : []),
      ],
    },
    [doc, provider],
  )

  return (
    <>
      <EditorToolbar editor={editor} readOnly={readOnly} />
      <div className={sheetClassName} data-testid="document-page">
        {heading}
        <EditorContent editor={editor} className="editor" />
      </div>
    </>
  )
}
