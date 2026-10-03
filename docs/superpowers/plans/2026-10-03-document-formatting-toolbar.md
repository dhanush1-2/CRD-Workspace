# Document Formatting Toolbar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the document page a formatting toolbar — bold through to links — and curated control over font family and size, without letting a document stop looking like the product.

**Architecture:** Most of this already exists. StarterKit puts bold, italic, underline, strike, inline code, headings, both list kinds, blockquote, code block, horizontal rule and link in the schema today; there is simply no UI, so they are reachable only by keyboard. The new capability is font family and size, which needs `@tiptap/extension-text-style`. One shared extension list becomes the single definition of the document's shape, consumed by the editor and by the history plan's restore primitive — a schema that disagrees with the one a document was written under silently drops marks.

**Tech Stack:** Tiptap 3.31.3 (`@tiptap/react`, StarterKit, Collaboration, CollaborationCaret), `@tiptap/extension-text-style` (new), Yjs 13.6, CSS Modules, Playwright.

**Spec:** The design owner's decisions of 2026-10-03, recorded below. `docs/design/glass-handoff.md` is the binding visual spec and has no toolbar in it; this plan adds one and Task 6 records it there.

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
- **The toolbar lives inside `Editor.tsx`**, which owns the editor instance. Lifting `useEditor` into `DocumentClient` to put the bar elsewhere would spread the editor's lifecycle across two components for a layout gain.
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

### Task 3: The toolbar

**Files:**
- Create: `apps/web/src/components/EditorToolbar.tsx`
- Create: `apps/web/src/components/editor-toolbar.module.css`
- Modify: `apps/web/src/components/Editor.tsx`
- Test: `apps/web/e2e/editor-toolbar.spec.ts`

**Interfaces:**
- Consumes: `FONT_FAMILIES`, `FONT_SIZES`, `DEFAULT_FONT_SIZE` (Task 2); `useEditorState` from `@tiptap/react`.
- Produces: `<EditorToolbar editor={editor} />`

**Re-rendering on selection.** Tiptap 3 does not re-render on every transaction by default — `useEditor` takes `shouldRerenderOnTransaction` and `@tiptap/react` exports `useEditorState`. Use `useEditorState` with a selector returning exactly the flags the bar shows, so moving the caret re-renders the toolbar and nothing else. **Verify the selector's shape against the installed types** before writing it, and report the signature you found.

- [ ] **Step 1: Write the failing test**

Create `apps/web/e2e/editor-toolbar.spec.ts` covering:

```
 1. an editor sees the toolbar on a document; it is role="toolbar"
 2. a viewer sees no toolbar at all (count 0, not disabled)
 3. a board shows no toolbar
 4. Bold: select a word, click Bold, the word is wrapped in <strong>; the button is
    aria-pressed; clicking again unwraps it
 5. the Bold button reflects the caret: it is not pressed in plain text and pressed
    when the caret sits inside bold text
 6. the heading select turns a paragraph into an <h2> and back
 7. bullet list wraps the line in <ul><li>
 8. the font select puts font-family on a span around the selection
 9. the size select puts font-size on a span, and the select shows 18 for plain text
10. the link button turns the selection into an <a> with the typed href
11. formatting made in one browser appears in the other  <-- the one that matters
12. the toolbar is reachable by keyboard: Tab into it, arrow keys move along it
```

Case 11 is why this is an e2e suite and not a unit test: a mark that does not survive the CRDT round trip is worthless, and nothing else in the plan would catch it. Use two contexts, as `collaboration.spec.ts` does, with `?nobc=1` so the two tabs sync through the server rather than BroadcastChannel.

Case 12 is the ARIA toolbar pattern: one tab stop for the whole bar, arrow keys between controls. If that is more than a day's work, implement plain tab stops instead, drop the arrow-key half of the case, and **say so** — do not leave the test asserting something that is not built.

- [ ] **Step 2: Build it**

Groups in order, separated by a 1px divider: heading select · font select · size select · bold italic underline strike · bullet numbered · link quote code divider.

```tsx
'use client'

import type { Editor } from '@tiptap/react'
import { useEditorState } from '@tiptap/react'
import { DEFAULT_FONT_SIZE, FONT_FAMILIES, FONT_SIZES } from './editor-type'
import styles from './editor-toolbar.module.css'

/**
 * The document's formatting bar.
 *
 * Most of what it exposes was already in the schema and reachable only by keyboard,
 * which is the problem it solves: the formatting existed and nobody could find it.
 *
 * Not rendered for a viewer at all, rather than disabled — the board does the same,
 * and the sync server rejects a viewer's update frames regardless, so a disabled bar
 * would be decoration over an enforcement that already exists.
 */
export function EditorToolbar({ editor }: { editor: Editor }) {
```

Each toggle is a `<button type="button" aria-pressed={active}>`. The three dropdowns are native `<select>` with an `aria-label`. Every control gets a `data-testid` the test names.

**The link control needs a popover, not a `window.prompt`.** A prompt is blocking, unstyled and untestable. A small input beside the button, Enter to apply and Escape to cancel, following the share sheet's field styling.

**Guard the empty selection.** Bold with no selection should toggle the stored mark so the next typed character is bold — Tiptap does this already. The font and size selects with no selection should do the same and must not throw.

- [ ] **Step 3: Style it**

Inside the sheet, above the content, below the title. A light band rather than a second glass surface: the sheet is already glass, and glass on glass reads as a mistake.

```css
.bar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 2px;
  margin: 0 0 20px;
  padding: 6px;
  border-radius: var(--r-pill);
  background: rgba(40, 40, 60, 0.04);
}
```

Buttons 30px, pill radius, `--text-2`, `aria-pressed` state in `--accent-tint` with `--accent-text`, hover white. Use the global focus ring. Wrapping rather than scrolling, because the sheet is only 668px wide inside its padding and a scrolling toolbar hides controls.

- [ ] **Step 4: Run, prove it discriminates, commit**

Discrimination, one at a time: render the toolbar for viewers and watch case 2 fail; drop `aria-pressed` and watch case 5 fail; remove `TextStyle` and watch cases 8 and 9 fail. Then **break the round trip deliberately** — apply the mark to the throwaway editor state rather than through `editor.chain()` — and confirm case 11 fails. Restore each.

```bash
git add apps/web
git commit -m "feat(editor): a formatting toolbar in the document sheet"
```

---

### Task 4: Does it still look like the design?

A toolbar and six sizes can wreck a carefully set page. This task is a look, not a change — change something only if you find a defect.

**Files:** none expected.

- [ ] **Step 1: Look at it**

At the dev server, on a document: type a few paragraphs and a heading. Apply each family and each size. Make a list, a quote, a code block, a link. Then answer, in the report:

1. Does the sheet still read as the design's document page, or does the bar dominate it?
2. At 14px and at 32px inside a paragraph, is the line spacing acceptable?
3. Does Serif or Mono at 32px overflow the 668px measure?
4. With the toolbar present, is the title still the first thing you see?
5. At 760px and at 1000px wide, does the bar wrap sensibly?

- [ ] **Step 2: Report, and fix only real defects**

If the bar dominates, the cheapest fix is lowering its contrast, not restructuring. If a size and the heading line-height fight, Task 2 Step 4 already flagged where to fix it. **Do not redesign on your own judgement** — report with specifics and let the owner decide, unless something is plainly broken (overflow, clipping, an unreachable control).

---

### Task 5: Shortcuts that come free, and a cheatsheet

StarterKit already binds ⌘B, ⌘I, ⌘U, ⌘⇧S, ⌘E, ⌘⌥1-6, ⌘⇧8, ⌘⇧7, ⌘⇧B and ⌘⇧C, and `Collaboration` binds ⌘Z and ⇧⌘Z through `yUndoPlugin`. None of this is documented anywhere the user can see, which is the same discoverability problem the toolbar fixes.

**Files:**
- Modify: `apps/web/src/components/EditorToolbar.tsx`
- Test: `apps/web/e2e/editor-toolbar.spec.ts`

- [ ] **Step 1: Verify which bindings actually exist**

Do not take the list above on trust. For each, in a browser: put the caret in a word, press the key, and check the document. **Report a table of what worked and what did not.** Tiptap's defaults move between versions.

- [ ] **Step 2: Put them where they can be found**

Every toolbar control gains the real shortcut in its `title`, so hovering Bold says "Bold ⌘B". Use the verified list, and omit the shortcut for anything Step 1 showed is not bound — a tooltip that lies is worse than no tooltip.

Platform: ⌘ on a Mac, Ctrl elsewhere. `navigator.platform` is deprecated; use `navigator.userAgent.includes('Mac')` and say in a comment that it is a cosmetic label, so a wrong guess costs a wrong glyph in a tooltip and nothing else.

- [ ] **Step 3: Test and commit**

Assert one tooltip contains the modifier glyph, and that pressing ⌘B with a selection bolds it — which proves the binding as well as the label.

```bash
git add apps/web
git commit -m "feat(editor): label the shortcuts that already work"
```

---

### Task 6: Record it

**Files:**
- Modify: `docs/design/glass-handoff.md`
- Modify: `docs/superpowers/plans/2026-10-03-history-and-authorship-backend.md`

- [ ] **Step 1: The handoff**

The handoff's document screen has no toolbar in it. Add one: its position in the sheet, its groups, that it is absent for viewers, the three families and six sizes with the reason they are curated, and that System is stored as `var(--font)`. Record Task 4's answers, including anything that looked wrong and was left.

Also correct the type section: it says paragraphs are 18px, which is now the *default* rather than the only size.

- [ ] **Step 2: The history plan**

Its Task 5 Step 6 creates `editor-schema.ts`. That module now exists. Rewrite the step to consume it, and add a line to that plan's constraints: `restoreEditor` builds its schema from `editorExtensions`, so **a document containing a `textStyle` mark can only be restored by a schema that includes it** — the two must not drift, which is the whole reason the module is shared.

- [ ] **Step 3: Commit**

```bash
git add docs
git commit -m "docs: record the formatting toolbar and the curated type scale"
```

---

## Self-Review

**1. Spec coverage.** The owner's three answers: a fixed bar inside the sheet (Task 3), curated families and sizes (Task 2), and all four control groups — core text, font and size, headings and lists, link/quote/code/divider (Task 3). Task 1 is the shared schema both the toolbar and the history plan's restore need. Task 5 surfaces the bindings that already worked and nobody could see.

Deliberately **not** here: colour, highlight and alignment, which the owner did not pick and which are a later addition to the same bar; and the app-level shortcuts (⌘⇧[, ⌘⇧H, ⌘S and so on), which are a separate proposal awaiting the owner's yes and touch the shell rather than the editor.

**2. Placeholder scan.** Three places require finding out rather than assuming, each with an instruction for either outcome: what `@tiptap/extension-text-style` exports (Task 2 Step 1, with the fallback spelled out), `useEditorState`'s selector signature (Task 3), and which keyboard bindings actually exist (Task 5 Step 1, which explicitly says not to trust the list in the plan). Task 1 Step 1 ships a deliberately failing expectation and names the choice to make about it. Task 3 Step 1 gives twelve numbered cases rather than code, because they depend on the suite's existing fixtures, and names case 11 as the one that carries the weight.

**3. Type consistency.** `editorExtensions` and `getEditorSchema()` are defined once in Task 1 and consumed by `Editor.tsx`, by Task 2's additions and by the history plan's `restoreEditor`. `FONT_FAMILIES` entries are `{ label, value }` in the module, the test and the select. `FONT_SIZES` is `readonly number[]` and `DEFAULT_FONT_SIZE` is one of its members, asserted. `EditorToolbar` takes `editor` and nothing else.

**4. Greenness between tasks.** Task 1 is the exception and says so: it lands with one failing expectation that Task 2 closes, or splits the list to stay green — the implementer chooses and records which. Every other task ends on a green full gate. Task 3 changes no existing test; Task 5 only adds to its own.

**5. The risk worth stating.** Six sizes and three families can make a document stop looking like the design, which is exactly what the curation is for and exactly what Task 4 exists to check. If Task 4 finds the bar dominating the page, that is a finding for the owner rather than licence to redesign the sheet.

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-10-03-document-formatting-toolbar.md`. Independent of every other outstanding plan except that it supersedes one step of the history backend plan.
