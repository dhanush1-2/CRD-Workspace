import { describe, it, expect } from 'vitest'
import * as Y from 'yjs'
import { EDITOR_FRAGMENT } from '../src/components/editor-fragment.js'

function sync(a: Y.Doc, b: Y.Doc): void {
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a, Y.encodeStateVector(b)))
  Y.applyUpdate(a, Y.encodeStateAsUpdate(b, Y.encodeStateVector(a)))
}

describe('editor binding', () => {
  it('uses a single agreed fragment name', () => {
    // Tiptap's Collaboration extension defaults to the 'default' fragment. Both the
    // editor and anything else reading the document must agree, or two clients edit
    // two different trees inside the same Y.Doc and silently never converge.
    expect(EDITOR_FRAGMENT).toBe('default')
  })

  it('converges concurrent edits to the editor fragment', () => {
    const a = new Y.Doc()
    const b = new Y.Doc()

    const fragmentA = a.getXmlFragment(EDITOR_FRAGMENT)
    const paragraph = new Y.XmlElement('paragraph')
    paragraph.insert(0, [new Y.XmlText('hello ')])
    fragmentA.insert(0, [paragraph])
    sync(a, b)

    const textA = (a.getXmlFragment(EDITOR_FRAGMENT).get(0) as Y.XmlElement).get(0) as Y.XmlText
    const textB = (b.getXmlFragment(EDITOR_FRAGMENT).get(0) as Y.XmlElement).get(0) as Y.XmlText

    textA.insert(textA.length, 'from a')
    textB.insert(0, 'from b ')
    sync(a, b)

    const rendered = (doc: Y.Doc) =>
      ((doc.getXmlFragment(EDITOR_FRAGMENT).get(0) as Y.XmlElement).get(0) as Y.XmlText).toString()

    expect(rendered(a)).toBe(rendered(b))
    expect(rendered(a)).toContain('from a')
    expect(rendered(a)).toContain('from b')
  })
})
