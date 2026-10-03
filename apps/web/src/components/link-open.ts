import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'

/**
 * Cmd-click (macOS) or Ctrl-click opens a link in an editable document.
 *
 * Link's own openOnClick is off (editor-schema.ts): left on, a plain click opens the link
 * and the caret can never be put inside one to edit or remove it. Chrome does not follow
 * an anchor inside a contenteditable either, so with the option off an editor had no way
 * to follow a link at all. This is the word processors' answer: a plain click edits, a
 * modified click follows.
 *
 * Behaviour only, no nodes or marks, so it sits with Collaboration in DocumentEditor and
 * not in the schema's extension list. A viewer's document is not editable, the handler is
 * never reached, and the browser follows the anchor itself.
 */
export const LinkOpen = Extension.create({
  name: 'linkOpen',
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('linkOpen'),
        props: {
          handleClick: (view, _pos, event) => {
            if (event.button !== 0 || !(event.metaKey || event.ctrlKey)) return false
            if (!view.editable) return false
            const target = event.target
            if (!(target instanceof Element)) return false
            const anchor = target.closest('a')
            if (!anchor || !view.dom.contains(anchor)) return false
            const href = anchor.getAttribute('href')
            if (!href) return false
            // noopener: the page that opens is not given a handle on the document.
            window.open(href, '_blank', 'noopener,noreferrer')
            return true
          },
        },
      }),
    ]
  },
})
