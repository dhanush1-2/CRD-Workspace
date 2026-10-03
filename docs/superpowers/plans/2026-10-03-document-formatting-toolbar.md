# Document Formatting Toolbar Implementation Plan

> **SUPERSEDED.** This plan is not a record of what was built. Section 12 of the design replaced its font family and size controls, its "viewers get no toolbar" rule, its fixed bar inside the sheet, its native `<select>` menus and its "no colour, highlight or alignment" constraint. The record of what shipped, and of where it deviates from the design, is the document-formatting-toolbar section of `docs/design/glass-handoff.md`. Read that, not this.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the document page a formatting toolbar — bold through to links — and curated control over font family and size, without letting a document stop looking like the product.

**Architecture:** Most of this already exists. StarterKit puts bold, italic, underline, strike, inline code, headings, both list kinds, blockquote, code block, horizontal rule and link in the schema today; there is simply no UI, so they are reachable only by keyboard. The new capability is font family and size, which needs `@tiptap/extension-text-style`. One shared extension list becomes the single definition of the document's shape, consumed by the editor and by the history plan's restore primitive — a schema that disagrees with the one a document was written under silently drops marks.

**Tech Stack:** Tiptap 3.31.3 (`@tiptap/react`, StarterKit, Collaboration, CollaborationCaret), `@tiptap/extension-text-style` (new), Yjs 13.6, CSS Modules, Playwright.

**Spec:** `docs/design/glass-handoff.md` **§12**, which specifies the toolbar completely — container, tabs, every control, the dropdown shell, the link popover and the page. **Read §12 before any task here.** This plan deliberately does not restate its values: the handoff is in the repository, it is the authority, and a transcription of it in a second file is a second thing to keep right. Each task names the section it implements and adds only what §12 does not say — file paths, test cases, traps and decisions.

## Global Constraints

- **No Prisma schema changes, no sync-server changes, no new API routes.** Marks are CRDT state.
- **The curated type scale is a hard boundary.** Three font families and six sizes, all from the design's own values. No free-text size input, no long font list. A document must still look like this product.
- Every colour, radius, duration and easing from a token where one exists. Raw values only where the design gives that literal, with a comment.
- Pair every `backdrop-filter` with `-webkit-backdrop-filter`. Every animation and transition inside `@media (prefers-reduced-motion: no-preference)`.
- `apps/web/test/css-tokens.test.ts` must keep passing.
- **Viewers get no toolbar at all** — not a disabled one. The board already hides every mutation control from a viewer, and the sync server rejects a viewer's update frames per-frame regardless.
- **One extension list.** `Editor.tsx` and `getEditorSchema()` must not be able to drift. A mark present in a document but absent from the schema used to read it is dropped without an error.
- Every test proven to discriminate. **Commit before mutating.**
- Full gate per task: `pnpm typecheck`, `pnpm --filter @crdt/web build`, `pnpm test`, `pnpm --filter @crdt/web exec playwright test`. **Record the baseline first.** At the time of writing: Vitest 254, Playwright 73, typecheck and build clean.
- Postgres on 5433 is shared across checkouts: never start, stop or restart it. Never touch `.env`, `docker-compose.yml` or `docker-compose.override.yml`. Never run any `fly` command. Never use bare `git stash` / `git stash pop`.

## Decisions by the design owner, 2026-10-03

- **A fixed bar inside the glass sheet**, between the title and the body. Not sticky, and not a selection bubble: the formatting that already exists is undiscoverable, and a bar is what fixes that.
- **Curated families and sizes.** Three families, and the design's own size steps.
- **All four control groups:** core text; font family and size; headings and lists; link, quote, code and divider.

## Decisions made while writing this plan

Mine, where the owner's answers did not reach.

- **Family values are three fixed CSS stacks**, and System is stored as `var(--font)` rather than the expanded stack, so a document written today follows the design's font if that token ever changes. Serif and Mono are literal stacks, because there is no token for them.
- **Sizes are 14 / 16 / 18 / 21 / 26 / 32px** — the design's own type steps, with 18 as the document body default. No arbitrary value.
- **The toolbar lives in `DocumentEditor.tsx`, which owns `useEditor`.** This plan first said it would live inside `Editor.tsx` and that lifting the editor out was not worth it. Task 3 reversed that: the owner's design puts the toolbar in its own panel above the sheet, so it can no longer sit inside a wrapper `DocumentClient` renders, and `Editor.tsx` was absorbed into `DocumentEditor.tsx` and deleted. `DocumentEditor` renders the toolbar, the sheet and the editor, and `DocumentClient` hands it the sheet's class and the title. It also accepts a null `doc` and `provider`, so the toolbar renders from the server before the editor is bound. (Superseded decision, kept for the record.)
- **Native `<select>` for the three dropdowns**, matching the share sheet's role select. A custom listbox is more design-controllable and is three more keyboard implementations to get right.
- **No colour, highlight or alignment**, because the owner did not pick them. They are a later addition to the same bar.

---

### Task 1: One definition of the document's shape

Before any marks are added, the extension list needs a single home. Today `Editor.tsx` holds it inline, and the history backend plan separately plans to extract it — whichever lands second would be working from a list the other had already changed.

**Files:**
- Create: `apps/web/src/components/editor-schema.ts`
- Modify: `apps/web/src/components/Editor.tsx`
- Test: `apps/web/test/editor-schema.test.ts`

**Interfaces:**
- Consumes: `StarterKit`, `getSchema` from `@tiptap/core`.
- Produces:
  - `editorExtensions` — the extensions that define the document's shape (no Collaboration, no CollaborationCaret)
  - `getEditorSchema(): Schema` — memoised

**This supersedes Task 5 Step 6 of `2026-10-03-history-and-authorship-backend.md`**, which planned to create the same module. That plan should consume this one instead; Task 6 here records it.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import { getEditorSchema } from '../src/components/editor-schema.js'

describe('the editor schema', () => {
  it('carries every mark and node the toolbar can produce', () => {
    const schema = getEditorSchema()
    // If any of these is missing, the matching toolbar button would be a no-op and
    // a document written elsewhere with that mark would lose it on read.
    for (const mark of ['bold', 'italic', 'underline', 'strike', 'code', 'link', 'textStyle']) {
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
    // They add behaviour, not shape, and they need a live Y.Doc and provider. The
    // restore primitive builds this schema with neither.
    const names = editorExtensions.map((extension) => extension.name)
    expect(names).not.toContain('collaboration')
    expect(names).not.toContain('collaborationCaret')
  })
})
```

The `textStyle` expectation fails until Task 2 adds the dependency. **Write it now and let it fail**, then make it pass in Task 2 — it is the assertion that ties the schema to the toolbar's reach. Say in the report that Task 1 lands with one known-failing expectation and Task 2 closes it, or split the mark list so Task 1 is green; either is fine, but choose deliberately and say which.

- [ ] **Step 2: Write the module**

```ts
import StarterKit from '@tiptap/starter-kit'
import { getSchema } from '@tiptap/core'
import type { Schema } from '@tiptap/pm/model'

/**
 * The extensions that define the document's shape.
 *
 * Collaboration and CollaborationCaret are deliberately absent: they add behaviour,
 * not nodes or marks, and they need a live Y.Doc and provider. The schema is what
 * reading a document requires, and the restore primitive has neither.
 *
 * Yjs owns undo history, so StarterKit's own is off — the Collaboration extension
 * ships yUndoPlugin and that is what Cmd-Z drives. Leaving both on would let one
 * person's undo reach another person's edits.
 *
 * This list is the single definition of what a document can contain. The editor and
 * getEditorSchema below must read the same one: a mark present in a document but
 * absent from the schema used to read it is dropped silently, with no error.
 */
export const editorExtensions = [StarterKit.configure({ undoRedo: false })]

let schema: Schema | null = null

/** Memoised: building a schema is not free and it never changes at runtime. */
export function getEditorSchema(): Schema {
  schema ??= getSchema(editorExtensions)
  return schema
}
```

`Editor.tsx` spreads `editorExtensions` in place of its inline `StarterKit.configure(...)`, keeping `Collaboration` and `CollaborationCaret` after it, and the `undoRedo` comment moves here with the configuration.

- [ ] **Step 3: Run, prove it discriminates, commit**

Run the new test and the full gate. Then remove `undoRedo: false` and confirm nothing fails — it will not, because no test covers it; note that in the report rather than adding one, since the real guard is the comment and a test for "two history plugins fight" is a day's work.

```bash
git add apps/web
git commit -m "refactor(editor): one definition of the document's shape"
```

---

### Task 2: Font family and size, curated

**Files:**
- Modify: `apps/web/package.json`
- Create: `apps/web/src/components/editor-type.ts`
- Modify: `apps/web/src/components/editor-schema.ts`
- Modify: `apps/web/src/app/globals.css`
- Test: `apps/web/test/editor-schema.test.ts`, `apps/web/test/editor-type.test.ts`

**Interfaces:**
- Consumes: `editorExtensions` (Task 1).
- Produces:
  - `FONT_FAMILIES: readonly { label: string; value: string }[]`
  - `FONT_SIZES: readonly number[]`
  - `DEFAULT_FONT_SIZE = 18`

- [ ] **Step 1: Install and find out what it exports**

```bash
pnpm --filter @crdt/web add @tiptap/extension-text-style@3.31.3
```

Pin the exact version with no `^`, as every other dependency there is. Then **read what it actually exports** before writing against it:

```bash
grep -oE "^(export )?(declare )?(const|class|function) [A-Za-z]+" apps/web/node_modules/@tiptap/extension-text-style/dist/index.d.ts | sort -u
```

Tiptap 3 is expected to export `TextStyle`, `FontFamily`, `FontSize` and a `TextStyleKit`. **Report what you find.** If `FontSize` is absent, write a small mark extension instead — `addGlobalAttributes` on `textStyle` with a `fontSize` attribute rendering `style="font-size: …"` plus `setFontSize` / `unsetFontSize` commands — and say that is what you did and why.

- [ ] **Step 2: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import { DEFAULT_FONT_SIZE, FONT_FAMILIES, FONT_SIZES } from '../src/components/editor-type.js'

describe('the curated type scale', () => {
  it('offers three families, System first', () => {
    expect(FONT_FAMILIES).toHaveLength(3)
    expect(FONT_FAMILIES[0]!.label).toBe('System')
    // System follows the design token rather than freezing today's stack into every
    // document that uses it.
    expect(FONT_FAMILIES[0]!.value).toBe('var(--font)')
  })

  it('offers the design\'s own size steps, with the body size among them', () => {
    expect([...FONT_SIZES]).toEqual([14, 16, 18, 21, 26, 32])
    expect(FONT_SIZES).toContain(DEFAULT_FONT_SIZE)
    expect(DEFAULT_FONT_SIZE).toBe(18)
  })

  it('has no duplicate labels or values', () => {
    expect(new Set(FONT_FAMILIES.map((f) => f.label)).size).toBe(FONT_FAMILIES.length)
    expect(new Set(FONT_FAMILIES.map((f) => f.value)).size).toBe(FONT_FAMILIES.length)
  })
})
```

- [ ] **Step 3: Write the module and extend the schema**

`editor-type.ts`:

```ts
/**
 * The only families a document may use. Curated on purpose: the design specifies the
 * document's type, and an open font list lets a document stop looking like this
 * product. Three is enough to cover prose, print-feel and code.
 *
 * System is stored as `var(--font)`, not the expanded stack, so a document written
 * today follows the design if that token ever changes. Serif and Mono are literal
 * stacks because there is no token for either.
 */
export const FONT_FAMILIES = [
  { label: 'System', value: 'var(--font)' },
  { label: 'Serif', value: 'ui-serif, Georgia, Cambria, "Times New Roman", serif' },
  { label: 'Mono', value: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace' },
] as const

/** The design's type steps. No free-text size: see FONT_FAMILIES for why. */
export const FONT_SIZES = [14, 16, 18, 21, 26, 32] as const

/** The document body's size, so the size control can show what plain text is. */
export const DEFAULT_FONT_SIZE = 18
```

Add `TextStyle`, `FontFamily` and `FontSize` to `editorExtensions`, with a comment that `TextStyle` is the mark the other two write attributes onto and must come with them.

- [ ] **Step 4: Make the marks render**

`FontFamily` writes `style="font-family: …"` and `FontSize` writes `style="font-size: …"` on a span, so no CSS is needed for them to work. But check two things in a browser and report both:

1. **`font-family: var(--font)` inline.** Custom properties resolve in inline styles, so this should work; confirm it computes to the system stack rather than being dropped.
2. **Size inside a heading.** `.editor .ProseMirror h1` is 32px; a 14px span inside it must win. It should — a span's inline style beats an ancestor's rule — but line-height is inherited from the heading and a small span in a 32px heading will sit on a 32px line. Note what it looks like; if it is ugly, add `line-height: 1.3` to the size mark's rendered style and say so.

- [ ] **Step 5: Run, prove it discriminates, commit**

Remove `TextStyle` from the list and confirm the schema test's `textStyle` expectation fails — that is the assertion tying the dependency to the schema.

```bash
git add apps/web
git commit -m "feat(editor): curated font families and the design's size scale"
```

---

### Task 3: Lift the editor, and build the toolbar shell

**Implements:** §12.1 (container, tab rows, tool button), §18 (viewer and preview rules).

**Files:**
- Create: `apps/web/src/components/DocumentEditor.tsx` (owns `useEditor`, renders toolbar + content)
- Create: `apps/web/src/components/EditorToolbar.tsx`
- Create: `apps/web/src/components/editor-toolbar.module.css`
- Modify: `apps/web/src/components/Editor.tsx` (becomes the content surface only, or is absorbed — decide and say which)
- Modify: `apps/web/src/app/documents/[id]/DocumentClient.tsx`
- Test: `apps/web/e2e/editor-toolbar.spec.ts`

**Interfaces:**
- Produces: `<DocumentEditor doc provider user readOnly />`, `<EditorToolbar editor readOnly />`
- The toolbar's active tab is local state: `'home' | 'insert' | 'view'`.

**The refactor is the point of this task.** §12.1 puts the toolbar above the page as a
separate panel, so it cannot live inside the component that renders the page. `useEditor`
moves up into `DocumentEditor`, which renders the toolbar and then the sheet.

- [ ] **Step 1: Write the failing test**

Cover, in `editor-toolbar.spec.ts`:

```
1. an editor sees the toolbar above the document sheet (compare bounding boxes)
2. it has the three tabs, Home active by default
3. clicking Insert shows the Insert row; clicking View shows the View row
4. the word count matches the document's words and updates as you type
5. a viewer sees the View tab only, plus a "View only" chip, and no Home or Insert
6. a board shows no toolbar at all
7. keyboard: the tabs are reachable and operable
```

Case 4 needs a debounce-tolerant assertion — `expect.poll`, not an immediate read.

- [ ] **Step 2: Build the shell**

Follow §12.1 for every value. Two things it does not say:

- **`position: sticky; top: 80px` assumes the unshrunk nav.** Our nav condenses on
  scroll (56→46px) — check what the toolbar does when it does, and report. Leave 80px
  unless it visibly collides.
- **The tool button's `preventDefault()` on mousedown is not optional.** §12.1 calls it
  out: without it, clicking a button blurs the editor and the selection is lost, so
  every command then applies to nothing. This is the single most likely way for this
  task to look finished and be broken.

- [ ] **Step 3: Prove it discriminates, gate, commit**

Remove the mousedown `preventDefault` and confirm a formatting case fails once Task 4
exists; until then, assert the selection survives a tab click. Report which.

```bash
git commit -m "feat(editor): the toolbar shell, above the page"
```

---

### Task 4: Home tab — the controls that need no menu

**Implements:** §12.2, every row except the Colour group.

**Files:**
- Modify: `EditorToolbar.tsx`, `editor-toolbar.module.css`
- Modify: `apps/web/src/components/editor-schema.ts` (TextAlign)
- Modify: `apps/web/package.json` (`@tiptap/extension-text-align`)
- Test: `apps/web/e2e/editor-toolbar.spec.ts`

**New dependency:** `@tiptap/extension-text-align`, pinned exactly. Underline, strike,
lists, blockquote and code block are already in the schema from Task 1.

- [ ] **Step 1: Write the failing test**

```
1. Bold wraps the selection in <strong>; clicking again unwraps
2. the button reflects the caret: unpressed in plain text, pressed inside bold
3. Italic, Underline, Strikethrough likewise
4. bullet and numbered lists wrap the line
5. each alignment sets the paragraph's alignment and marks itself active
6. Clear formatting removes marks and returns the block to a paragraph
7. Undo and Redo move through collaborative history (y-prosemirror's manager)
8. formatting made in one browser appears in the other   <-- the one that matters
```

Case 8 is why this is e2e. Two contexts with `?nobc=1`, as `collaboration.spec.ts` does.

- [ ] **Step 2: Build it**

§12.2 gives the order, tooltips and commands; §12.1 gives the button and separator
styling. Active state is `--accent-soft` with `--accent`, both of which now exist.

**Re-read the format on selection change.** §12.2 says so explicitly. `useEditorState`
from `@tiptap/react` with a selector returning exactly the flags the bar shows —
verify its signature against the installed types and report it.

- [ ] **Step 3: Prove it discriminates, gate, commit**

Break the round trip deliberately (apply a mark to a throwaway state rather than
through `editor.chain()`) and confirm case 8 fails.

```bash
git commit -m "feat(editor): the Home tab's direct controls"
```

---

### Task 5: The dropdown shell, the Style menu, and colour

**Implements:** §12.5 in full, and the Colour group of §12.2.

**Files:**
- Create: `apps/web/src/components/EditorMenu.tsx` (the shared shell)
- Modify: `EditorToolbar.tsx`, `editor-toolbar.module.css`
- Modify: `editor-schema.ts` (Highlight)
- Modify: `apps/web/package.json` (`@tiptap/extension-highlight`)
- Test: `apps/web/e2e/editor-toolbar.spec.ts`

**New dependency:** `@tiptap/extension-highlight`, pinned. Text colour is `Color` from
`@tiptap/extension-text-style`, already installed in Task 2.

**One shell, three menus.** §12.5 gives one container spec and three contents (style,
colour, highlight). Build the shell once and pass it contents, or the three will drift.

- [ ] **Step 1: Write the failing test**

```
 1. the Style trigger shows the current block's name and changes with the caret
 2. choosing Title/Heading/Subheading/Normal/Quote/Code sets that block type
 3. each row previews in its own style and shows its shortcut
 4. the colour menu applies a colour to the selection and marks the swatch selected
 5. the highlight menu likewise; "None" removes it
 6. the A and marker buttons show a bar in the last colour used
 7. a menu closes on Esc, on an outside click and on choosing an item
 8. opening one menu closes any other
 9. focus returns to the trigger on Esc
10. the selection survives opening and using a menu
```

Case 10 is the mousedown trap from Task 3, in the place it bites hardest.

- [ ] **Step 2: Build it**

§12.5 gives every value. Keyboard: arrow keys within a menu, Enter to choose, Esc to
close — the ARIA listbox pattern for the style menu, a grid for the swatches.

- [ ] **Step 3: Prove it discriminates, gate, commit**

```bash
git commit -m "feat(editor): the dropdown shell, style menu, colour and highlight"
```

---

### Task 6: Insert tab

**Implements:** §12.3 and §12.6.

**Files:**
- Create: `apps/web/src/components/EditorLinkPopover.tsx`
- Modify: `EditorToolbar.tsx`, `editor-toolbar.module.css`, `editor-schema.ts`, `package.json`
- Test: `apps/web/e2e/editor-toolbar.spec.ts`

**New dependency:** `@tiptap/extension-table` (with its row/cell/header extensions),
pinned. **Isolated here on purpose:** it brings node views and the largest surface of
anything in this plan. If it fights the collaborative schema, drop Table, ship the other
five Insert tools, and report — do not let one tool hold the tab hostage.

- [ ] **Step 1: Write the failing test**

```
1. Link opens the popover focused; Enter applies; the selection becomes an <a>
2. a URL without a scheme gets https://
3. Esc closes the popover and restores the selection
4. Remove strips the link
5. Divider, Code block and Quote each insert or toggle correctly
6. Date inserts today's date in the handoff's format
7. Table inserts a 3x3 with an empty paragraph after it, and it survives a round trip
   to a second browser
```

§12.6 is explicit that the selection is saved when the popover opens and restored
before applying. A popover that applies to a collapsed selection is the failure here.

- [ ] **Step 2: Build it, prove it, gate, commit**

```bash
git commit -m "feat(editor): the Insert tab"
```

---

### Task 7: View tab

**Implements:** §12.4, plus the page's two widths from §12.7.

**Files:**
- Modify: `EditorToolbar.tsx`, `editor-toolbar.module.css`, `DocumentEditor.tsx`
- Modify: `apps/web/src/app/documents/[id]/document.module.css`
- Test: `apps/web/e2e/editor-toolbar.spec.ts`

- [ ] **Step 1: Write the failing test**

```
1. zoom starts at 100%; + and - step by 10%; clicking the value resets to 100%
2. zoom clamps at 70% and 150%
3. Narrow and Wide change the sheet's max-width to 780 and 1040
4. the width change animates rather than jumping
5. a viewer can use both: View is the tab they get, and it must do something
```

**Check remote cursors under zoom.** §12.4 claims they stay correct. CSS `zoom` and
ProseMirror coordinate maths disagree in some browsers. Verify with two browsers and
**report what you see** — if they drift, say so rather than quietly shipping it.

- [ ] **Step 2: Build it, prove it, gate, commit**

```bash
git commit -m "feat(editor): the View tab"
```

---

### Task 8: Element styles, and look at the whole thing

**Implements:** §12.7's element table.

**Files:**
- Modify: `apps/web/src/app/globals.css`
- Modify: `docs/design/glass-handoff.md`
- Modify: `docs/superpowers/plans/2026-10-03-history-and-authorship-backend.md`

- [ ] **Step 1: The element styles**

§12.7 gives h1/h2/h3, p, blockquote, pre, lists, hr, table, td and a. Our `globals.css`
already styles some under `.editor .ProseMirror`. Reconcile them against the table and
report every value that differed.

**Note the conflict:** §12.7 says the body is 17px. Ours is 18px, by a later decision
recorded in the handoff's Precedence section. **Keep 18.**

- [ ] **Step 2: Look at it**

Two browsers, a document with every element in it. Answer: does the page still read as
the design's? Does the toolbar dominate? At 760px and 1000px, does the bar wrap? Do
remote cursors still land correctly with formatting applied?

- [ ] **Step 3: Record it**

In the handoff's build record: what was built, every deviation, and anything §12 asked
for that was not built, with the reason. In the history backend plan, Task 5 Step 6 now
consumes `editor-schema.ts` rather than creating it — and that plan gains a constraint:
**a document can only be restored by a schema that includes every mark it carries**, so
the toolbar's marks and `restoreEditor` must never drift.

- [ ] **Step 4: Commit**

```bash
git commit -m "docs: record the document toolbar as built"
```

---

## Self-Review

**1. Spec coverage.** §12.1 (Task 3), §12.2 (Tasks 4–5), §12.3 and §12.6 (Task 6),
§12.4 (Task 7), §12.5 (Task 5), §12.7 (Task 8), §18's viewer and preview rules (Task 3).
Tasks 1 and 2 are done and are the schema both the toolbar and the history plan's
restore need.

Deliberately **not** here: the history preview's "toolbar hidden" state beyond rendering
nothing when read-only, since the preview itself belongs to the history panel plan.

**2. Placeholder scan.** This plan points at §12 instead of restating it, on purpose:
the handoff is in the repository and is the authority, and a copy is a second thing to
keep right. Four places require finding out and reporting rather than assuming: the
sticky offset under a condensed nav (Task 3), `useEditorState`'s signature (Task 4),
whether Table fights the collaborative schema (Task 6), and whether remote cursors
survive CSS zoom (Task 7). Each says what to do with either answer.

**3. Type consistency.** `editorExtensions` and `getEditorSchema()` from Task 1 are
extended in Tasks 4, 5 and 6 and consumed unchanged by `restoreEditor`. `EditorToolbar`
takes `editor` and `readOnly`. `EditorMenu` is one shell with three contents.

**4. Greenness between tasks.** Every task ends on a green full gate. Task 3 moves
`useEditor` and updates `DocumentClient` in one commit, because a half-moved editor does
not compile.

**5. The risk worth stating.** The mousedown `preventDefault` in §12.1 is the one thing
that makes a finished-looking toolbar silently useless: without it every click blurs the
editor and every command applies to an empty selection. It is called out in Tasks 3 and
5 and is the first thing to check if a control "does nothing".
