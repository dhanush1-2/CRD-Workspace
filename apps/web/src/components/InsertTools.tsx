import type { ReactNode } from 'react'
import { useEditorState, type Editor } from '@tiptap/react'
import { ToolButton } from './ToolButton'
import { useMenuGroup } from './EditorMenu'
import { LinkMenu } from './EditorLinkPopover'
import { formatInsertDate } from './editor-insert'

/** What the Insert row shows of the selection: the three tools that are toggles. */
interface InsertFormat {
  link: boolean
  codeBlock: boolean
  blockquote: boolean
}

function readFormat(editor: Editor): InsertFormat {
  return {
    link: editor.isActive('link'),
    codeBlock: editor.isActive('codeBlock'),
    blockquote: editor.isActive('blockquote'),
  }
}

function Icon({ children }: { children: ReactNode }) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      {children}
    </svg>
  )
}

/** The table the Table tool makes (handoff 12.3). No header row: the design styles `td` only. */
const TABLE_ROWS = 3
const TABLE_COLS = 3

/**
 * The Insert tab's six tools (handoff 12.3), each a labelled button. Link opens the
 * popover of 12.6; the other five act on the editor directly.
 */
export function InsertTools({ editor }: { editor: Editor }) {
  const format = useEditorState({ editor, selector: ({ editor: current }) => readFormat(current) })
  // One slot, for the Link popover; it is what closes it on a click-away or on Esc.
  const menu = useMenuGroup()

  // No .focus() in these chains: the click never took focus from the editor.
  const run = () => editor.chain()

  return (
    <>
      <LinkMenu editor={editor} control={menu('insert-link')} active={format.link} />

      <ToolButton
        label="Table"
        text="Table"
        data-testid="tb-insert-table"
        onClick={() =>
          run()
            .insertTable({ rows: TABLE_ROWS, cols: TABLE_COLS, withHeaderRow: false })
            // The caret is in the first cell. An empty paragraph goes after the table, in
            // the same step, so there is always somewhere to write below it and undo
            // takes both away together.
            .command(({ tr, state }) => {
              const { $from } = tr.selection
              for (let depth = $from.depth; depth > 0; depth -= 1) {
                if ($from.node(depth).type.name !== 'table') continue
                const paragraph = state.schema.nodes.paragraph
                if (paragraph) tr.insert($from.after(depth), paragraph.create())
                break
              }
              return true
            })
            .run()
        }
      >
        <Icon>
          <rect x="2" y="3" width="12" height="10" rx="1.5" />
          <path d="M2 6.5h12M2 9.8h12M6 3v10M10 3v10" />
        </Icon>
      </ToolButton>

      <ToolButton
        label="Divider"
        text="Divider"
        data-testid="tb-insert-divider"
        onClick={() => run().setHorizontalRule().run()}
      >
        <Icon>
          <path d="M2 8h12" />
          <path d="M5 4.5h6M5 11.5h6" />
        </Icon>
      </ToolButton>

      <ToolButton
        label="Code block"
        text="Code block"
        active={format.codeBlock}
        data-testid="tb-insert-code"
        onClick={() => run().toggleCodeBlock().run()}
      >
        <Icon>
          <path d="m5.5 5-3 3 3 3M10.5 5l3 3-3 3" />
        </Icon>
      </ToolButton>

      <ToolButton
        label="Quote"
        text="Quote"
        active={format.blockquote}
        data-testid="tb-insert-quote"
        onClick={() => run().toggleBlockquote().run()}
      >
        <Icon>
          <path d="M3 5.5h3.5v3.5H4.5c0 1.2.6 1.8 2 2M9.5 5.5H13v3.5h-2c0 1.2.6 1.8 2 2" />
        </Icon>
      </ToolButton>

      <ToolButton
        label="Date"
        text="Date"
        data-testid="tb-insert-date"
        // A text node, not an HTML string: insertContent parses a string as markup.
        onClick={() => run().insertContent({ type: 'text', text: formatInsertDate(new Date()) }).run()}
      >
        <Icon>
          <rect x="2.5" y="3.5" width="11" height="10" rx="1.5" />
          <path d="M2.5 6.8h11M5.5 2v3M10.5 2v3" />
        </Icon>
      </ToolButton>
    </>
  )
}
