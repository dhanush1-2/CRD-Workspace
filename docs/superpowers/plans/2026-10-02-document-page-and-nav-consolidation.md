# Document Page and Nav Consolidation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish the document screen — the 780px glass page sheet and the remote-cursor pill — and move presence and connection status off the transitional row and into the nav where the design puts them, then delete that row.

**Architecture:** The nav needs read-only state (connection status, remote peers) that only the Yjs provider has, and the provider lives inside `DocumentClient`, which is a *descendant* of `AppShell`. A child cannot provide React context to its parent, so this plan introduces a small module-level store that `DocumentClient` publishes to and the nav components subscribe to via `useSyncExternalStore`. See the decision note below — **confirm it before executing Task 1.**

**Tech Stack:** Next.js 16 App Router (webpack), React 19, CSS Modules, Yjs + y-websocket, Tiptap, Playwright, Vitest.

**Spec:** `docs/design/glass-handoff.md` — the Layout section's nav items 5 and 6 (presence avatars, status pill) and item 3's tab presence dot, the `**Document.**` screen section, and the `**Viewer.**` note.

## THE ONE DECISION TO CONFIRM BEFORE EXECUTING

The nav must show live status and presence. Three ways to get provider state up there:

1. **A module-level store (what this plan does).** `DocumentClient` already owns the provider; it publishes `{ status, peers }` to a tiny store, and nav components read it with `useSyncExternalStore`. Smallest diff, leaves the provider lifecycle — which `collaboration.spec.ts` covers — completely untouched, and keeps the nav ignorant of Yjs. Cost: a module singleton, valid because exactly one document is open at a time.
2. **Move the provider into `AppShell`.** Architecturally tidier in the abstract: whoever needs the data highest owns it. But it relocates the doc/provider lifecycle into a component that also renders on the dashboard and workspace pages where no document exists, couples the nav to Yjs, and puts the connection logic that the collaboration tests exercise onto a new code path.
3. **Lift both into a shared client layout.** Correct long-term, and it is the same restructure as making the tab indicator glide (`/workspaces/[id]/documents/[docId]` with a layout at the workspace segment). Out of scope here, and still an open question.

This plan takes **option 1** because it is reversible and does not disturb working sync code. If you would rather go straight to option 2 or 3, say so — Task 1 changes shape and Tasks 2-4 mostly do not.

## Global Constraints

- **No backend changes.** No Prisma schema edits, no sync-server changes, no API route changes. The *rich* status popover (version number, queued-edit count, response time) needs data the sync server does not expose and is **not** in this plan; only the connection state the client already has.
- **The sync behaviour is frozen.** `useCollaborativeDoc`, the provider lifecycle, the awareness protocol and the token flow keep their exact current semantics. Publishing to a store is additive.
- These `data-testid`s keep their meaning: `status` (and its exact text content — `collaboration.spec.ts` asserts `toHaveText('connected')`), `presence`, `presence-{name}`, `role`, `read-only`, `document-title`, `workspace-link`, `tab-{documentId}`, `tab-overview`.
- Every colour, radius, duration and easing from a token where one exists; raw values only where the handoff gives the literal, with a comment.
- Pair every `backdrop-filter` with `-webkit-backdrop-filter`. Animation inside `@media (prefers-reduced-motion: no-preference)`.
- `apps/web/test/css-tokens.test.ts` must keep passing.
- Accessibility: the status pill is not colour-alone — it keeps a text label. Presence avatars carry accessible names. The nav's new controls are keyboard-reachable with visible focus.
- Every test proven to discriminate. Commit before mutating.
- Full gate per task: `pnpm typecheck`, `pnpm --filter @crdt/web build`, `pnpm test`, `pnpm --filter @crdt/web exec playwright test`. Baseline: Vitest 236, Playwright 32 (plus whatever earlier plans added). Revert `apps/web/next-env.d.ts` if the build rewrites it.

## Deliberately out of scope

- **The status popover** (270px, People here / Response time / Waiting to sync / Version) and the **offline / syncing pills** and their toasts. All need the sync server to expose a version sequence, a queued-edit count and a latency ping. The toast primitive they will use already exists.
- **The history button and panel**, and the **version-preview bar**.
- **`y-indexeddb`.** Offline edits surviving a tab close is a second persistence layer with real conflict semantics; it needs its own design pass.

## File Structure

| File | Responsibility |
|---|---|
| `lib/doc-state.ts` (new) | Module store: `publishDocState`, `clearDocState`, `useDocState`. |
| `components/SyncStatus.tsx` (new) | The nav's status pill, reading the store. |
| `components/NavPresence.tsx` (new) | The nav's 28px overlapping avatars, reading the store. |
| `components/AppShell.tsx` (modify) | Render both in the slots Plan 1 left, plus the viewer pill if it is not already there. |
| `components/NavTabs.tsx` (modify) | Green presence dot on the tab others are in. |
| `components/nav-tabs.module.css` (modify) | The dot. |
| `app/documents/[id]/DocumentClient.tsx` (modify) | Publish to the store; delete the transitional header row. |
| `app/documents/[id]/document.module.css` (modify) | The 780px glass page sheet; drop the dead header rules. |
| `app/globals.css` (modify) | The remote-cursor pill and its 0.7s glide. |

---

### Task 1: The document-state store

**Files:**
- Create: `apps/web/src/lib/doc-state.ts`
- Test: `apps/web/test/doc-state.test.ts`

**Interfaces:**
- Produces:
  - `type DocPeer = { clientId: number; name: string; color: string }`
  - `type DocState = { documentId: string | null; status: DocStatus; peers: DocPeer[] }`
  - `publishDocState(next: DocState): void`
  - `clearDocState(documentId: string): void` — clears only if the store still holds that document, so a late unmount cannot wipe a newer document's state.
  - `useDocState(): DocState`

`DocStatus` is the existing type from `@/hooks/use-doc` — import it rather than redeclaring.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import { publishDocState, clearDocState, getDocState, subscribeDocState } from '@/lib/doc-state'

describe('doc state store', () => {
  it('notifies subscribers and returns a stable snapshot', () => {
    let calls = 0
    const stop = subscribeDocState(() => { calls += 1 })
    publishDocState({ documentId: 'a', status: 'connected', peers: [] })
    const first = getDocState()
    // A second identical publish must not notify: useSyncExternalStore re-renders
    // every subscriber on each notify, and the provider publishes on every
    // awareness tick.
    publishDocState({ documentId: 'a', status: 'connected', peers: [] })
    expect(calls).toBe(1)
    expect(getDocState()).toBe(first)
    stop()
  })

  it('a stale unmount does not clear a newer document', () => {
    publishDocState({ documentId: 'old', status: 'connected', peers: [] })
    publishDocState({ documentId: 'new', status: 'connected', peers: [] })
    clearDocState('old')
    expect(getDocState().documentId).toBe('new')
  })
})
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `pnpm test -- doc-state`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement the store**

```ts
import { useSyncExternalStore } from 'react'
import type { DocStatus } from '@/hooks/use-doc'

export type DocPeer = { clientId: number; name: string; color: string }
export type DocState = { documentId: string | null; status: DocStatus; peers: DocPeer[] }

const EMPTY: DocState = { documentId: null, status: 'connecting', peers: [] }

let state: DocState = EMPTY
const listeners = new Set<() => void>()

function same(a: DocState, b: DocState): boolean {
  return (
    a.documentId === b.documentId &&
    a.status === b.status &&
    a.peers.length === b.peers.length &&
    a.peers.every((peer, i) => {
      const other = b.peers[i]!
      return peer.clientId === other.clientId && peer.name === other.name && peer.color === other.color
    })
  )
}

export function publishDocState(next: DocState): void {
  // The provider publishes on every awareness change, which fires on every
  // keystroke of every peer. Without this equality gate the whole nav re-renders
  // on each one.
  if (same(state, next)) return
  state = next
  for (const listener of listeners) listener()
}

export function clearDocState(documentId: string): void {
  // Guarded by id: React may unmount the old document after the new one mounts,
  // and an unguarded clear would blank the nav for the document now on screen.
  if (state.documentId !== documentId) return
  state = EMPTY
  for (const listener of listeners) listener()
}

export function getDocState(): DocState {
  return state
}

export function subscribeDocState(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useDocState(): DocState {
  return useSyncExternalStore(subscribeDocState, getDocState, () => EMPTY)
}
```

The third argument to `useSyncExternalStore` is the server snapshot — it must be `EMPTY`, not `getDocState`, or the server render and the client's first render disagree and React logs a hydration mismatch.

- [ ] **Step 4: Run to confirm it passes**

Run: `pnpm test -- doc-state` — PASS.

- [ ] **Step 5: Prove the equality gate discriminates**

Remove the `if (same(state, next)) return` line. Re-run: the first test must FAIL with `expected 2 to be 1`. Restore it.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/doc-state.ts apps/web/test/doc-state.test.ts
git commit -m "feat(doc): add the document-state store the nav reads"
```

---

### Task 2: Publish from `DocumentClient` and delete the transitional row

**Files:**
- Modify: `apps/web/src/app/documents/[id]/DocumentClient.tsx`, `apps/web/src/app/documents/[id]/document.module.css`

**Interfaces:**
- Consumes: `publishDocState`, `clearDocState` (Task 1); the existing `useCollaborativeDoc` and `usePresence`.

- [ ] **Step 1: Publish on every change**

In `DocumentClient`, after the existing `usePresence` call, add an effect that publishes. Depend on the primitives, not on `presence` (a fresh array each render):

```tsx
  useEffect(() => {
    publishDocState({
      documentId,
      status,
      peers: presence.map((user) => ({
        clientId: user.clientId,
        name: user.name,
        color: user.color,
      })),
    })
  })

  useEffect(() => () => clearDocState(documentId), [documentId])
```

The first effect deliberately has **no dependency array**: it must run after every render because `presence` is a new array each time, and the store's own equality gate — not a dep list — is what stops the redundant notifies. Say this in a comment, because a reviewer will otherwise read a missing dep array as a mistake.

- [ ] **Step 2: Delete the transitional row**

Remove the whole `<header className={styles.header}>` block from `DocumentClient` — the role badge, `.spacer`, `<Presence>`, the status span and the read-only block. The nav now carries status (Task 3) and presence (Task 4), and the viewer pill covers read-only.

**This breaks tests, and that is expected:** `collaboration.spec.ts` asserts `getByTestId('status')` has text `connected`, and `auth-flow.spec.ts` asserts `getByTestId('role')`. Do **not** delete those assertions. Leave them failing until Task 3 puts `status` in the nav, then confirm they pass unchanged — the testids move, their meaning does not. Report the exact failures.

- [ ] **Step 3: Drop the dead CSS**

From `document.module.css`, delete `.header`, `.spacer`, `.status`, both `.status[data-status=...]` rules and `.readOnly`. All of them lose their only consumer here. Keep nothing "just in case" — the token test and the reviewers both flag dead rules.

- [ ] **Step 4: Verify**

Run: `pnpm typecheck` — clean. Run: `pnpm test` — passes (unit tests do not touch this). Playwright will have the expected failures from Step 2; list them.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/documents
git commit -m "refactor(document): publish doc state; remove the transitional header row"
```

---

### Task 3: The nav status pill

**Files:**
- Create: `apps/web/src/components/SyncStatus.tsx`
- Modify: `apps/web/src/components/AppShell.tsx`, `apps/web/src/components/app-shell.module.css`

**Interfaces:**
- Consumes: `useDocState` (Task 1), the field style from the handoff's Layout item 6.
- Produces: `SyncStatus` — `() => JSX.Element | null`. Returns `null` when `documentId` is `null`, so the dashboard and workspace pages show nothing.

- [ ] **Step 1: Write the component**

The handoff: *"**Status pill:** field style, 8px dot plus label (`3 here` / `Synced` / `Offline` / `Syncing`). The label hides below 1100px."* The dot colour comes from the status; the label carries the meaning in words, so the state is never colour-alone.

Map the existing `DocStatus` to a label and a dot colour: `connected` → `Synced` / `--ok`; `connecting` → `Syncing` / `--sync`; `disconnected` or `fatal` → `Offline` / `--danger`. When peers are present and the status is `connected`, the label becomes `{n} here` per the handoff's first example.

Keep `data-testid="status"` on the element whose **entire text content** is the raw status string — `collaboration.spec.ts` asserts `toHaveText('connected')`. The simplest honest way to satisfy both that test and the design: render the human label visibly and keep a visually-hidden element carrying the raw status with the testid, using the existing `ui.labelHidden` clip. Do **not** change the test, and do not make the visible pill read `connected`, which is not a word the design uses.

- [ ] **Step 2: Style it**

Field style, per Layout item 4's definition: fill `--field-bg`, border `--field-border`, `inset 0 1px 2px rgba(30,30,50,.06)`, 36px high, pill radius, text `#55585f`. The 8px dot is a `border-radius: 50%` span. Below 1100px the label hides — put that in the existing `@media (max-width: 1100px)` block in `app-shell.module.css` alongside the other things that shed.

- [ ] **Step 3: Render it in the nav**

Replace Plan 1's placeholder comment (`{/* Plan 2 fills this with the status pill. */}`) in `AppShell` with `<SyncStatus />`.

- [ ] **Step 4: Confirm the previously-failing tests now pass unchanged**

Run: `pnpm --filter @crdt/web exec playwright test collaboration`
Expected: PASS, with the assertion untouched. If it still fails, the testid is not carrying the raw status text — fix the component, not the test.

- [ ] **Step 5: Prove it discriminates**

Commit first. Then make `SyncStatus` always render the `Synced` branch regardless of status. Confirm a collaboration test fails. Restore with `git checkout --` and verify `git diff --exit-code`.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/SyncStatus.tsx apps/web/src/components/AppShell.tsx apps/web/src/components/app-shell.module.css
git commit -m "feat(nav): the status pill reads live document state"
```

---

### Task 4: Presence avatars in the nav, and the tab dot

**Files:**
- Create: `apps/web/src/components/NavPresence.tsx`
- Modify: `apps/web/src/components/AppShell.tsx`, `apps/web/src/components/app-shell.module.css`, `apps/web/src/components/NavTabs.tsx`, `apps/web/src/components/nav-tabs.module.css`
- Modify: `apps/web/src/components/Presence.tsx`

**Interfaces:**
- Consumes: `useDocState` (Task 1), `colorFor` is **not** needed — peers carry their own `color` from awareness.
- Produces: `NavPresence` — `() => JSX.Element | null`, `null` when there are no peers.

- [ ] **Step 1: Write `NavPresence`**

The handoff: *"Presence avatars: 28px, overlapping at −7px, white 2px ring; hover `translateY(-3px) scale(1.06)`; hidden below 1100px."*

Each avatar is a 28px circle filled with the peer's `color`, showing their initial, with `title` and `aria-label` carrying the full name so the identity is not colour-only. Overlap with `margin-left: -7px` on every avatar after the first. The hover transform goes inside `prefers-reduced-motion: no-preference`; hidden below 1100px goes in the existing media block.

Move `data-testid="presence"` onto this component's wrapper and keep `data-testid={`presence-${user.name}`}` on each avatar — `collaboration.spec.ts` uses them, and they must keep meaning the same thing in their new home.

- [ ] **Step 2: Retire the old `Presence` export**

`Presence.tsx`'s `Presence` component (the coloured name pills) now has no caller, because Task 2 deleted the row that used it. Delete that export and its inline styles. Keep `CardPresence`, which the board uses.

Grep for `<Presence` and `from '@/components/Presence'` across `src` first and report what you find, so the deletion is evidence-based rather than assumed.

- [ ] **Step 3: The tab presence dot**

The handoff, Layout item 3: *"A green 6px dot shows when others are in that document."* In `NavTabs`, read `useDocState()` and render a 6px `--ok` dot inside the tab whose id matches `documentId` when `peers.length > 0`.

**Be careful about what this can and cannot show.** The store holds state for the *currently open* document only, so the dot can only ever appear on the active tab. Showing presence on *other* tabs needs per-document awareness the client does not subscribe to. Implement the active-tab case, and record the limitation in Task 6's status note rather than implying the feature is complete.

- [ ] **Step 4: Write the failing e2e test**

Add to `apps/web/e2e/collaboration.spec.ts` (it already has the two-context harness) or a new spec following its pattern: with two users on the same document, assert the second user's nav shows an avatar with the first user's name, and that the active tab carries the dot. Then assert that when one leaves, the avatar goes.

- [ ] **Step 5: Prove it discriminates**

Commit first. Make `NavPresence` return `null` unconditionally; confirm the new test fails. Restore and verify `git diff --exit-code`.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components apps/web/e2e
git commit -m "feat(nav): presence avatars and the tab presence dot"
```

---

### Task 5: The document page sheet and the cursor pill

**Files:**
- Modify: `apps/web/src/app/documents/[id]/document.module.css`, `apps/web/src/app/documents/[id]/DocumentClient.tsx`, `apps/web/src/app/globals.css`

- [ ] **Step 1: The glass page sheet**

The handoff: *"**Document.** Max-width 780, centered. The page is a glass sheet: radius 30, padding 56/56/96, `rgba(255,255,255,.78)`."*

Add a `.page` rule to `document.module.css` with those values — `max-width: 780px; margin: 0 auto; border-radius: var(--r-sheet); padding: 56px 56px 96px; background: rgba(255,255,255,.78)` plus the paired glass blur, the `--glass-border` border and the `--glass-highlight` inset. Wrap `DocumentClient`'s content in it.

This replaces the editor's temporary 24px padding — find and remove that, wherever it lives (check `Editor.tsx` and `globals.css`'s ProseMirror rules). Report where it was.

The board is **not** wrapped in the sheet: it is a horizontal scroller with its own 16px gutters and would be crushed inside a 780px column. Apply `.page` only for `type === 'doc'`.

- [ ] **Step 2: The cursor pill and its glide**

`globals.css` already styles `.collaboration-carets__caret` and `.collaboration-carets__label` (lines ~268-290). Two changes:

- `.collaboration-carets__label`: change `border-radius: 3px 3px 3px 0` to `var(--r-pill)` so it is the pill the handoff describes. Its 11px/500 and `0 4px 10px` shadow already match.
- `.collaboration-carets__caret`: add the glide — `transition: left .7s var(--ease), top .7s var(--ease)` — inside a `@media (prefers-reduced-motion: no-preference)` block.

Check whether the caret is positioned with `left`/`top` at all before relying on that transition; if Tiptap positions it another way, report what it actually uses instead of shipping a transition that animates nothing.

- [ ] **Step 3: Verify**

Full gate. The collaboration tests exercise two live carets, so they are the real check that nothing about the editor broke.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/app/documents apps/web/src/app/globals.css
git commit -m "feat(document): the glass page sheet and the remote-cursor pill"
```

---

### Task 6: Verify and record

**Files:**
- Modify: `docs/design/glass-handoff.md`

- [ ] **Step 1: Full gate**

typecheck clean; `pnpm test` with the count reported; build succeeds with the route list unchanged; Playwright all passing from a cold start. Revert `next-env.d.ts` if rewritten.

- [ ] **Step 2: Update the status section**

Move into "Built": the document glass sheet, the remote-cursor pill, nav presence avatars, the connection status pill, and the tab presence dot. Record precisely:

- The status **popover** is still deferred, and why: version sequence, queued-edit count and latency ping are not exposed by the sync server.
- The tab dot only appears on the **active** tab, because the client subscribes to awareness for the open document only. Showing it on other tabs needs per-document awareness.
- `Presence.tsx`'s `Presence` export was deleted; `CardPresence` remains for the board.
- The document-state store is a module singleton, valid while one document is open at a time, and the reason option 2 (provider in `AppShell`) and option 3 (shared client layout) were not taken.

- [ ] **Step 3: Commit**

```bash
git add docs/design/glass-handoff.md
git commit -m "docs: record the document page and nav consolidation as built"
```

---

## Self-Review

**1. Spec coverage.** Document screen: 780px centred glass sheet with the specified radius, padding and fill; remote cursor as a 2px bar with a pill label and the 0.7s glide (Task 5). Nav: presence avatars at 28px overlapping −7px with the white ring and hover lift, hidden below 1100px (Task 4); status pill in field style with an 8px dot and a label that hides below 1100px (Task 3); tab presence dot (Task 4, with its limitation recorded). The transitional row is gone (Task 2). Not covered, with reasons in "Deliberately out of scope": the status popover, offline/syncing pills, history, `y-indexeddb`.

**2. Placeholder scan.** No "TBD". The store is given in full with its tests. Tasks 3-5 specify exact values and name the files, and ask the implementer to **report** what it finds in the two places I could not verify from here (how Tiptap positions the caret; where the editor's temporary 24px padding lives) rather than guessing — those are verification instructions, not placeholders.

**3. Type consistency.** `DocStatus` is imported from `@/hooks/use-doc`, not redeclared. `DocPeer` mirrors the fields `PresenceUser` actually has (`clientId`, `name`, `color`) — verified against `hooks/use-presence.ts`. `useDocState` is consumed by `SyncStatus`, `NavPresence` and `NavTabs`, all declared in Task 1.

**4. Known intended breakage.** Task 2 deletes the row carrying `status` and `role`, which fails `collaboration.spec.ts` and `auth-flow.spec.ts` until Task 3 (and the viewer pill) rehome those testids. Both tasks state this, and Task 3 Step 4 requires the assertions to pass **unchanged** — if they need editing, the testids changed meaning and that is a defect, not a fix.
