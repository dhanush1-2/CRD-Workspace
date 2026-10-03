import StarterKit from '@tiptap/starter-kit'
import { Color, FontFamily, FontSize, TextStyle } from '@tiptap/extension-text-style'
import Highlight from '@tiptap/extension-highlight'
import TextAlign from '@tiptap/extension-text-align'
import { getSchema } from '@tiptap/core'
import type { Schema } from '@tiptap/pm/model'

/**
 * The extensions that define the document's shape.
 *
 * Collaboration and CollaborationCaret are deliberately absent: they add behaviour,
 * not nodes or marks, and they need a live Y.Doc and a provider. The schema is what
 * reading a document requires, and reading one back from history has neither.
 *
 * Yjs owns undo history, so StarterKit's own is off — the Collaboration extension
 * ships yUndoPlugin and that is what Cmd-Z drives. With both on, one person's undo
 * could reach another person's edits.
 *
 * This list is the single definition of what a document may contain, and the editor
 * and getEditorSchema below must read the same one. A mark that is present in a
 * document but absent from the schema used to read it is dropped silently, with no
 * error anywhere.
 */
export const editorExtensions = [
  StarterKit.configure({ undoRedo: false }),
  // TextStyle is the mark; FontFamily and FontSize are global attributes written
  // onto it, so it has to come with them or both are silent no-ops. The values they
  // may take are curated — see editor-type.ts.
  TextStyle,
  FontFamily,
  FontSize,
  // Text colour: a global attribute on the same textStyle mark, so it needs TextStyle
  // above and travels in the document like the two before it. Highlight is its own mark
  // (<mark>), multicolor so each run keeps the colour it was given.
  Color,
  Highlight.configure({ multicolor: true }),
  // A global attribute on these two block types. defaultAlignment stays null, so a
  // paragraph nobody aligned carries no attribute at all, in the Y.Doc or in the HTML.
  // The toolbar reads "no attribute" as left; see HomeTools.
  TextAlign.configure({ types: ['heading', 'paragraph'] }),
]

let schema: Schema | null = null

/** Memoised: building a schema is not free and it never changes at runtime. */
export function getEditorSchema(): Schema {
  schema ??= getSchema(editorExtensions)
  return schema
}
