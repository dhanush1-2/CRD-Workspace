import { describe, it, expect } from 'vitest'
import { editorExtensions, getEditorSchema } from '../src/components/editor-schema.js'

describe('the editor schema', () => {
  it('carries every mark and node the toolbar can produce', () => {
    const schema = getEditorSchema()
    // If any of these is missing, the matching toolbar control is a no-op, and a
    // document written elsewhere with that mark loses it on read. `textStyle` is
    // asserted separately, in the test that adds it.
    for (const mark of ['bold', 'italic', 'underline', 'strike', 'code', 'link']) {
      expect(schema.marks[mark], mark).toBeDefined()
    }
    for (const node of [
      'paragraph',
      'heading',
      'bulletList',
      'orderedList',
      'listItem',
      'blockquote',
      'codeBlock',
      'horizontalRule',
    ]) {
      expect(schema.nodes[node], node).toBeDefined()
    }
  })

  it('is memoised, so repeated reads are the same object', () => {
    expect(getEditorSchema()).toBe(getEditorSchema())
  })

  it('does not include the collaboration extensions', () => {
    // They add behaviour, not shape, and they need a live Y.Doc and provider, which
    // reading a document out of history does not have.
    const names = editorExtensions.map((extension) => extension.name)
    expect(names).not.toContain('collaboration')
    expect(names).not.toContain('collaborationCaret')
  })
})
