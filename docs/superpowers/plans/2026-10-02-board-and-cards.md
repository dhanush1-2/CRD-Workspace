# Board and Cards Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Kanban board's placeholder grey design with the Glass design — glass columns with count chips, white cards with a hover lift, a violet drag-over outline, the blue peer ring with a name chip, and the new add buttons.

**Architecture:** `Board.tsx` currently carries every style as an inline `style` object and has no stylesheet. This plan gives it `board.module.css` and converts the markup to classes, keeping every behaviour — the drag payload, `moveCard`/`addCard`/`addColumn`/`removeCard` calls, `setCardFocus` on focus/blur/hover, the `readOnly` gating and every `data-testid` — byte-identical. `CardPresence` is restyled from grey text into the peer chip, and the ring it implies is drawn on the card.

**Tech Stack:** Next.js 16 App Router (webpack), React 19, CSS Modules, Yjs, Playwright, Vitest.

**Spec:** `docs/design/glass-handoff.md` — the board at the `**Board.**` section (column, card, states, add buttons), the shared glass recipe, and the keyframes. The owner also supplied add-button values after the handoff was written; they are quoted verbatim in Task 4 and recorded in the handoff's Implementation status section.

## Global Constraints

- **No backend changes and no CRDT shape changes.** No Prisma schema edits, no sync-server changes, no API route changes, and no new fields on the card's `Y.Map`. Card notes and the activity log belong to the backend plan; this plan styles what already exists.
- **Behaviour is frozen.** Every drag handler, Yjs mutation, presence call and `readOnly` guard keeps its exact current semantics. This is a restyle. If you believe a behaviour is wrong, report it; do not change it.
- These `data-testid`s keep their meaning and their exact current values: `column-{id}`, `card-{id}`, `add-card-{columnId}`, `add-column`, `card-presence-{cardId}`, `presence`, `presence-{name}`. `collaboration.spec.ts` drives all of them.
- `data-column={column.id}` on each card stays — `collaboration.spec.ts` asserts a card moved columns by reading it.
- Every colour, radius, duration and easing comes from a token in `apps/web/src/app/globals.css` where one exists. Raw values **only** where the handoff gives that literal, with a comment saying so.
- Pair every `backdrop-filter` with `-webkit-backdrop-filter`. All animation and transition inside `@media (prefers-reduced-motion: no-preference)`; a hover or selected *colour* is not motion and belongs outside it.
- `apps/web/test/css-tokens.test.ts` must keep passing: every `var(--x)` you write must exist in `globals.css`.
- Accessibility: cards stay keyboard-focusable with a visible focus ring, the delete button keeps an accessible name, and the peer chip is not conveyed by colour alone — it carries the peer's name as text.
- Every test proven to discriminate: break the thing, watch it fail, restore. Commit before mutating so `git checkout --` restores.
- Full gate per task: `pnpm typecheck`, `pnpm --filter @crdt/web build`, `pnpm test`, `pnpm --filter @crdt/web exec playwright test`. Baseline: Vitest 236, Playwright 32. Revert `apps/web/next-env.d.ts` if the build rewrites it.

## Deliberately out of scope

- **The card detail sheet.** It needs `description` and an activity log on the card's `Y.Map`, which is backend-plan work. Task 3 adds the `.cardSelected` class the sheet will use, but nothing wires click-to-select — a selection state with nothing to open is dead interaction.
- **The "has notes" card meta.** Same reason: there is no `description` field yet. The class is not added either, because unlike selection it has no later consumer waiting for it.
- **Presence avatars in the nav.** That is the document-page plan. `Presence.tsx`'s `Presence` export (the coloured name pills in the document header) is NOT touched here; only `CardPresence` is.

## File Structure

| File | Responsibility |
|---|---|
| `components/board.module.css` (new) | Every board surface: scroller, column, card and its states, add buttons, peer chip. |
| `components/Board.tsx` (modify) | Same component, same behaviour, classes instead of inline styles. |
| `components/Presence.tsx` (modify) | `CardPresence` becomes the peer chip. `Presence` untouched. |
| `components/ui/ui.module.css` (modify) | Task 5 only: the button press duration. |
| `app/(auth)/auth.module.css` (modify) | Task 5 only: the GitHub button hover. |
| `e2e/board.spec.ts` (new) | Guards for the states that CSS alone can get wrong. |

---

### Task 1: The board stylesheet

**Files:**
- Create: `apps/web/src/components/board.module.css`

**Interfaces:**
- Consumes: tokens from `globals.css` (`--accent`, `--text`, `--text-2`, `--text-muted`, `--r-column`, `--r-card`, `--r-pill`, `--ease`, `--dur`, `--dur-fast`) and the `g-in` keyframe.
- Produces: the class names Task 2 and Task 3 consume: `.scroller`, `.column`, `.columnOver`, `.columnHead`, `.columnTitle`, `.count`, `.cards`, `.card`, `.cardDragging`, `.cardSelected`, `.cardPeer`, `.cardTitle`, `.delete`, `.addCard`, `.addList`, `.peerChip`, `.peerAvatar`.

- [ ] **Step 1: Write the stylesheet**

Create `apps/web/src/components/board.module.css`. Values marked "handoff literal" are given verbatim by the spec and stay raw.

```css
.scroller {
  display: flex;
  gap: 16px;
  align-items: flex-start;
  padding: 28px 16px 16px;
  overflow-x: auto;
}

/* Column: 290px, radius 26, glass rgba(255,255,255,.42) — handoff literals. */
.column {
  flex: none;
  width: 290px;
  border-radius: var(--r-column);
  padding: 14px;
  background: rgba(255, 255, 255, 0.42);
  backdrop-filter: blur(20px) saturate(180%);
  -webkit-backdrop-filter: blur(20px) saturate(180%);
  border: 1px solid rgba(255, 255, 255, 0.85);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.9);
}

/* Drag-over: fill .75 plus a 2px accent inset — handoff literals. */
.columnOver {
  background: rgba(255, 255, 255, 0.75);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.9), inset 0 0 0 2px var(--accent);
}

.columnHead {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0 2px 12px;
}

.columnTitle {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  letter-spacing: -0.01em;
  min-width: 0;
  overflow-wrap: anywhere;
}

/* Count chip: 22px pill, rgba(0,0,0,.05) — handoff literals. */
.count {
  flex: none;
  display: grid;
  place-items: center;
  min-width: 22px;
  height: 22px;
  padding: 0 7px;
  border-radius: var(--r-pill);
  background: rgba(0, 0, 0, 0.05);
  font-size: 12.5px;
  font-weight: 600;
  color: var(--text-2);
}

.cards {
  display: grid;
  gap: 8px;
}

/*
  Card. Base fill .92, radius 18, padding 14/16, title 14.5px, and the
  0 0 0 1px #fff + 0 2px 8px rgba(30,45,40,.06) shadow are handoff literals.
*/
.card {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 14px 16px;
  border-radius: var(--r-card);
  background: rgba(255, 255, 255, 0.92);
  box-shadow: 0 0 0 1px #fff, 0 2px 8px rgba(30, 45, 40, 0.06);
  cursor: grab;
}

.card[data-readonly='true'] {
  cursor: default;
}

@media (prefers-reduced-motion: no-preference) {
  .card {
    animation: g-in 0.5s var(--ease);
    transition:
      transform var(--dur-fast) var(--ease),
      box-shadow var(--dur-fast) var(--ease);
  }
  .card:hover {
    transform: translateY(-3px) scale(1.01);
  }
  .card:active {
    transform: scale(0.98);
  }
}

.card:hover {
  box-shadow: 0 0 0 1px #fff, 0 14px 30px rgba(30, 45, 40, 0.12);
}

.cardDragging {
  opacity: 0.4;
}

/* Used by the card sheet in a later plan; no caller wires selection yet. */
.cardSelected {
  box-shadow: 0 0 0 2px var(--accent), 0 2px 8px rgba(30, 45, 40, 0.06);
}

/* A remote peer on the card — handoff literals, including the peer blue. */
.cardPeer {
  box-shadow: 0 0 0 2px #0ea5e9, 0 4px 14px rgba(14, 165, 233, 0.18);
}

.cardTitle {
  flex: 1 1 auto;
  min-width: 0;
  font-size: 14.5px;
  line-height: 1.35;
  color: var(--text);
  overflow-wrap: anywhere;
}

/* Delete ×: a 24px circle for editors. */
.delete {
  flex: none;
  display: grid;
  place-items: center;
  width: 24px;
  height: 24px;
  border: 0;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.05);
  color: var(--text-muted);
  font-size: 15px;
  line-height: 1;
  cursor: pointer;
}

.delete:hover {
  background: rgba(0, 0, 0, 0.1);
  color: var(--text);
}

/* Peer chip: avatar + name, rgba(14,165,233,.1) with text #0b6e99 — handoff literals. */
.peerChip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-top: 8px;
  padding: 3px 9px 3px 3px;
  border-radius: var(--r-pill);
  background: rgba(14, 165, 233, 0.1);
  color: #0b6e99;
  font-size: 12px;
  font-weight: 500;
}

.peerAvatar {
  flex: none;
  display: grid;
  place-items: center;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  color: #fff;
  font-size: 10px;
  font-weight: 600;
}

/* "+ Add a card": a ghost pill. */
.addCard {
  width: 100%;
  height: 36px;
  margin-top: 8px;
  border: 0;
  border-radius: var(--r-pill);
  background: rgba(255, 255, 255, 0.55);
  box-shadow: inset 0 0 0 1px rgba(40, 40, 60, 0.08);
  color: var(--text-2);
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
}

.addCard:hover {
  background: rgba(255, 255, 255, 0.9);
}

/* "+ Add a list": a 230x54 dashed pill. */
.addList {
  flex: none;
  width: 230px;
  height: 54px;
  border: 1.5px dashed rgba(40, 40, 60, 0.22);
  border-radius: var(--r-pill);
  background: rgba(255, 255, 255, 0.7);
  backdrop-filter: blur(20px) saturate(180%);
  -webkit-backdrop-filter: blur(20px) saturate(180%);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.9), 0 4px 16px rgba(30, 45, 40, 0.06);
  color: var(--text-2);
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
}

.addList:hover {
  background: rgba(255, 255, 255, 0.92);
}

@media (prefers-reduced-motion: no-preference) {
  .addCard,
  .addList {
    transition:
      background var(--dur-fast) var(--ease),
      transform var(--dur) var(--ease);
  }
  .addList:active,
  .addCard:active {
    transform: scale(0.97);
  }
}
```

- [ ] **Step 2: Verify the tokens resolve**

Run: `pnpm test -- css-tokens`
Expected: PASS. Every `var()` above must be defined in `globals.css` — check `--r-column`, `--r-card`, `--dur-fast` in particular before running.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/board.module.css
git commit -m "feat(board): add the glass board stylesheet"
```

---

### Task 2: Convert `Board.tsx` to the stylesheet

**Files:**
- Modify: `apps/web/src/components/Board.tsx`

**Interfaces:**
- Consumes: Task 1's classes; the existing `useBoard`, `usePresence`, `setCardFocus`, `addCard`, `addColumn`, `moveCard`, `removeCard`.
- Produces: no new exports.

- [ ] **Step 1: Replace the markup, keeping behaviour byte-identical**

Read the current file first. Then make these changes and no others:

- Import `styles from './board.module.css'` and `colorFor from '@/lib/color'`.
- Root `<div>`: `className={styles.scroller}`, drop its inline `style`.
- Each `<section>`: `className={`${styles.column} ${dragOver === column.id ? styles.columnOver : ''}`}`, drop the inline `style`. Keep `data-testid`, `onDragOver`, `onDragLeave`, `onDrop` exactly as they are.
- Replace the bare `<h2>` with the header row:

```tsx
          <div className={styles.columnHead}>
            <h2 className={styles.columnTitle}>{column.title}</h2>
            <span className={styles.count}>{(cardsByColumn.get(column.id) ?? []).length}</span>
          </div>
```

- Wrap the card list in `<div className={styles.cards}>`.
- Each `<article>`: `className` composed from `styles.card`, plus `styles.cardPeer` when a remote peer is on this card (Task 3 supplies that check), plus `styles.cardDragging` while this card is the one being dragged. Add `data-readonly={readOnly}`. Drop the inline `style`. Keep `data-testid`, `data-column`, `draggable`, `onDragStart`, `onDrop`, `onFocus`, `onBlur`, `onMouseEnter`, `onMouseLeave` and `tabIndex` unchanged.
- Track the dragged card so `.cardDragging` has a source: add `const [dragging, setDragging] = useState<string | null>(null)`, set it in `onDragStart`, and clear it in a new `onDragEnd`. `onDragEnd` fires even when the drop is cancelled, which is why it — not `onDrop` — is the right place to clear.
- Card title: `<span className={styles.cardTitle}>{card.title}</span>`.
- Delete button: `className={styles.delete}`, drop the inline `style`, keep `aria-label` and `onClick` exactly.
- `+ Add card` button: `className={styles.addCard}`, and the label text becomes **`+ Add a card`** per the handoff. Keep `data-testid={`add-card-${column.id}`}` and the `addCard(...)` call unchanged.
- `+ Add column` button: `className={styles.addList}`, label becomes **`+ Add a list`**. Keep `data-testid="add-column"` and the `addColumn(...)` call unchanged.

- [ ] **Step 2: Check the label change against the e2e suite**

The two button labels change text. Run: `grep -rn "Add card\|Add column" apps/web/e2e apps/web/src` and update any test that matches on that text. `collaboration.spec.ts` uses the testids, which do not change — confirm that is still true rather than assuming it.

- [ ] **Step 3: Verify**

Run: `pnpm typecheck` — clean.
Run: `pnpm --filter @crdt/web exec playwright test collaboration` — all pass. This is the real gate for this task: those tests drag cards between columns and assert `data-column`, so they prove the behaviour survived the restyle.
Run: `pnpm --filter @crdt/web exec playwright test` — all 32 pass.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/Board.tsx
git commit -m "feat(board): glass columns, cards and add buttons"
```

---

### Task 3: The peer ring and chip

**Files:**
- Modify: `apps/web/src/components/Presence.tsx`, `apps/web/src/components/Board.tsx`
- Test: `apps/web/e2e/board.spec.ts` (create)

**Interfaces:**
- Consumes: `PresenceUser` from `@/hooks/use-presence` (fields: `clientId`, `name`, `color`, `cardId`), Task 1's `.peerChip` / `.peerAvatar` / `.cardPeer`.
- Produces: `CardPresence` keeps its exact signature — `({ users, cardId }: { users: PresenceUser[]; cardId: string }) => JSX.Element | null` — and its `data-testid={`card-presence-${cardId}`}`.

- [ ] **Step 1: Restyle `CardPresence`**

In `Presence.tsx`, replace only the `CardPresence` body. Leave the `Presence` export completely alone — the document-page plan owns it.

```tsx
export function CardPresence({ users, cardId }: { users: PresenceUser[]; cardId: string }) {
  const here = users.filter((user) => user.cardId === cardId)
  if (here.length === 0) return null

  return (
    <div data-testid={`card-presence-${cardId}`} className={styles.peers}>
      {here.map((user) => (
        <span className={styles.peerChip} key={user.clientId}>
          <span className={styles.peerAvatar} style={{ background: user.color }} aria-hidden="true">
            {user.name.slice(0, 1).toUpperCase()}
          </span>
          {user.name}
        </span>
      ))}
    </div>
  )
}
```

Import `styles from './board.module.css'` in `Presence.tsx`, and add a `.peers` rule to that stylesheet: `display: flex; flex-wrap: wrap; gap: 6px;`. The chip keeps the peer's **name as text**, so the state is never conveyed by colour alone.

- [ ] **Step 2: Draw the ring on the card**

In `Board.tsx`, inside the card map, compute whether a remote peer is on this card and add `styles.cardPeer` when so:

```tsx
            const peerHere = presence.some((user) => user.cardId === card.id)
```

`usePresence` returns only remote peers (it excludes the local client), so no self-filtering is needed — verify that in `use-presence.ts` before relying on it, and if it does include the local client, filter it out and say so in your report.

- [ ] **Step 3: Write the failing e2e test**

Create `apps/web/e2e/board.spec.ts`. Follow `glass-shell.spec.ts`'s conventions: one `LABEL`, one import block from `./fixtures.js`, one `test.afterAll`. Two tests:

1. **The column count chip reflects the number of cards.** Seed a board, add two cards, assert the chip in that column reads `2`. This is the one piece of new *information* on the board and nothing else asserts it.
2. **A dragged card is visibly faded.** Start a drag on a card (`dispatchEvent` a `dragstart`), then assert the card's computed `opacity` is `0.4`. Reset by dispatching `dragend`.

For the peer ring, use the two-browser pattern from `collaboration.spec.ts`: with two contexts on the same board, hover a card in page A and assert page B's copy of that card has a box-shadow containing the peer blue, and that `card-presence-{id}` shows A's name. If that proves flaky in a single run, say so and leave the ring to a comment rather than committing a flaky test.

- [ ] **Step 4: Prove each test discriminates**

Commit first. Then: remove the `.count` element and confirm test 1 fails; remove `styles.cardDragging` from the className and confirm test 2 fails; remove `styles.cardPeer` and confirm the ring test fails. Restore each with `git checkout --` and verify `git diff --exit-code`. Paste all failures.

- [ ] **Step 5: Verify and commit**

Run the full gate. Then:

```bash
git add apps/web/src/components/Presence.tsx apps/web/src/components/Board.tsx apps/web/src/components/board.module.css apps/web/e2e/board.spec.ts
git commit -m "feat(board): peer ring and name chip"
```

---

### Task 4: Confirm the add-button values against the owner's spec

**Files:**
- Modify: `apps/web/src/components/board.module.css` (only if Task 1 drifted)

The owner supplied these after the handoff was written. Task 1 already encodes them; this task is a verification pass, because four fix rounds in the previous plan were drift from supplied values.

- [ ] **Step 1: Diff the shipped CSS against these values**

`+ Add a list`: dashed border `1.5px dashed rgba(40,40,60,.22)`; background `rgba(255,255,255,.7)` with blur 20px; shadow `inset 0 1px 0 rgba(255,255,255,.9), 0 4px 16px rgba(30,45,40,.06)`; text `#3d403b` at weight 500; hover background `rgba(255,255,255,.92)`; pressed `scale(.97)`.

`+ Add a card`: background `rgba(255,255,255,.55)`; `inset 0 0 0 1px rgba(40,40,60,.08)`; text `#3d403b` at weight 500; hover background `rgba(255,255,255,.9)`.

Note `#3d403b` is exactly `--text-2`, so the token is correct there and should stay a token. Check every other number character by character and fix any that differs. Report what you found, including "no drift" if that is the answer.

- [ ] **Step 2: Commit only if something changed**

```bash
git add apps/web/src/components/board.module.css
git commit -m "fix(board): correct add-button values to the owner's spec"
```

---

### Task 5: The two small details

**Files:**
- Modify: `apps/web/src/app/(auth)/auth.module.css`, `apps/web/src/components/ui/ui.module.css`

From the owner's audit: *"The GitHub button darkens on hover; the design only lifts it 1px."* and *"Buttons press in over 0.3s; the design uses 0.4s."*

- [ ] **Step 1: The GitHub button hover**

In `(auth)/auth.module.css`, find the provider-button hover rule and replace the background darkening with a 1px lift: `transform: translateY(-1px)`, keeping the fill unchanged. Put the `transform` inside the existing `prefers-reduced-motion: no-preference` block, since a lift is motion. If the rule applies to both provider buttons, change both — the audit names GitHub because that is the visible one, not because Google should differ.

- [ ] **Step 2: The press duration**

In `ui.module.css`, find the `:active { transform: scale(...) }` transition on `.button` and change its duration from `0.3s` to `0.4s`. Prefer `var(--dur)` if that token is `0.4s` — check `globals.css` rather than hard-coding. Apply the same to `.addCard` / `.addList` in `board.module.css` if they use a different duration, so the whole app presses at one speed.

- [ ] **Step 3: Verify and commit**

Run the full gate — these are visual-only and no test should move.

```bash
git add apps/web/src/app/\(auth\)/auth.module.css apps/web/src/components/ui/ui.module.css apps/web/src/components/board.module.css
git commit -m "fix(ui): lift the provider buttons on hover; press at 0.4s"
```

---

### Task 6: Verify and record

**Files:**
- Modify: `docs/design/glass-handoff.md`

- [ ] **Step 1: Full gate**

- `pnpm typecheck` — clean.
- `pnpm test` — report the count.
- `pnpm --filter @crdt/web build` — succeeds, route list unchanged (this plan adds no routes).
- `pnpm --filter @crdt/web exec playwright test` — all pass, started cold.
- Revert `apps/web/next-env.d.ts` if the build rewrote it.

- [ ] **Step 2: Update the implementation status section**

Move the board restyle and the card peer ring into "Built". Keep the card detail sheet in "Deferred" and state its blocker precisely: `description` and an activity log on the card's `Y.Map`. Record that `.cardSelected` exists unused, waiting for that sheet, and that the "has notes" meta was deliberately not added because there is no `description` field to drive it.

- [ ] **Step 3: Commit**

```bash
git add docs/design/glass-handoff.md
git commit -m "docs: record the board restyle as built"
```

---

## Self-Review

**1. Spec coverage.** Column 290px/radius 26/glass .42 with the drag-over fill and accent inset, header title and count chip (Task 1-2). Card base/hover/active/entrance/dragging/selected and the peer ring (Tasks 1-3). Delete × as a 24px circle (Tasks 1-2). "+ Add a card" ghost pill and "+ Add a list" 230×54 dashed pill, with the owner's later values verified (Tasks 1, 2, 4). Peer chip with avatar, name, fill and text colour (Tasks 1, 3). The two polish items (Task 5). Not covered, with reasons stated in "Deliberately out of scope": the card sheet, the "has notes" meta, and nav presence.

**2. Placeholder scan.** No "TBD", no "add appropriate styling". The stylesheet is given in full. Task 2 lists every markup change individually rather than restating the component, because its instruction is to preserve behaviour exactly and a full rewrite invites drift.

**3. Type consistency.** `CardPresence` keeps its exact props and testid. `PresenceUser` is used with the fields it actually has (`clientId`, `name`, `color`, `cardId`) — verified against `hooks/use-presence.ts`. `colorFor` is already imported elsewhere in the app with the same signature.

**4. Risk to flag at execution.** Task 3's peer-ring test needs two browser contexts and depends on awareness propagating within the test's timeout. `collaboration.spec.ts` already does this successfully, so the pattern is proven here — but if it flakes, the plan explicitly permits dropping that one assertion rather than committing a flaky test.
