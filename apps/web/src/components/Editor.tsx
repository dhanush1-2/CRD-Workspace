'use client'

import { EditorContent, useEditor } from '@tiptap/react'
import Collaboration from '@tiptap/extension-collaboration'
import CollaborationCaret from '@tiptap/extension-collaboration-caret'
import type * as Y from 'yjs'
import type { WebsocketProvider } from 'y-websocket'
import { EDITOR_FRAGMENT } from './editor-fragment'
import { editorExtensions } from './editor-schema'

interface EditorProps {
  doc: Y.Doc
  provider: WebsocketProvider
  user: { name: string; color: string }
  readOnly?: boolean
}

export function Editor({ doc, provider, user, readOnly = false }: EditorProps) {
  const editor = useEditor({
    // Next.js renders this on the server first; Tiptap must not render until hydration.
    immediatelyRender: false,
    editable: !readOnly,
    extensions: [
      // The document's shape lives in one place; see editor-schema.ts, which also
      // explains why StarterKit's undo is off.
      ...editorExtensions,
      Collaboration.configure({ document: doc, field: EDITOR_FRAGMENT }),
      CollaborationCaret.configure({ provider, user }),
    ],
  })

  return <EditorContent editor={editor} className="editor" />
}
