import { describe, it, expect } from 'vitest'
import { prosemirrorJSONToYDoc, yDocToProsemirrorJSON } from '@tiptap/y-tiptap'
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

  it('carries text colour on textStyle and highlight as its own mark', () => {
    const { marks } = getEditorSchema()
    // Both are what the colour and highlight menus write. Missing, the menu is a no-op
    // and a coloured document read back from history loses its colour in silence.
    expect(marks.textStyle?.spec.attrs, 'textStyle').toHaveProperty('color')
    expect(marks.highlight, 'highlight').toBeDefined()
    // multicolor: the mark carries the colour it was given rather than one fixed yellow.
    expect(marks.highlight?.spec.attrs, 'highlight').toHaveProperty('color')
  })

  it('lets paragraphs and headings be aligned, with no alignment as the default', () => {
    const { nodes } = getEditorSchema()
    for (const name of ['paragraph', 'heading']) {
      const type = nodes[name]!
      expect(type.create().attrs, name).toHaveProperty('textAlign', null)
      const centred = JSON.stringify(type.spec.toDOM!(type.create({ textAlign: 'center' })))
      expect(centred, name).toContain('text-align: center')
      // An unaligned block must serialise with no style at all: a default of 'left' would
      // write the attribute into every block of every document.
      const plain = JSON.stringify(type.spec.toDOM!(type.create()))
      expect(plain, name).not.toContain('text-align')
    }
  })

  it('carries the table, and a table survives the trip into a Y.Doc and back', () => {
    const schema = getEditorSchema()
    for (const node of ['table', 'tableRow', 'tableCell', 'tableHeader']) {
      expect(schema.nodes[node], node).toBeDefined()
    }
    const cell = (text: string) => ({
      type: 'tableCell',
      attrs: { colspan: 1, rowspan: 1, colwidth: null },
      content: [{ type: 'paragraph', content: text ? [{ type: 'text', text }] : undefined }],
    })
    const row = (...texts: string[]) => ({ type: 'tableRow', content: texts.map(cell) })
    const json = {
      type: 'doc',
      content: [
        { type: 'table', content: [row('a', 'b', ''), row('', 'c', 'd'), row('e', '', 'f')] },
        { type: 'paragraph' },
      ],
    }
    // The CRDT is how a table reaches a second browser: if the schema cannot carry a node
    // through the Y.Doc, it does not sync, and that is worse than having no table at all.
    const ydoc = prosemirrorJSONToYDoc(schema, json, 'default')
    const back = yDocToProsemirrorJSON(ydoc, 'default')
    expect(schema.nodeFromJSON(back).eq(schema.nodeFromJSON(json))).toBe(true)
    // Not a vacuous pass: the table is really there on the far side.
    expect(JSON.stringify(back)).toContain('"tableRow"')
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
