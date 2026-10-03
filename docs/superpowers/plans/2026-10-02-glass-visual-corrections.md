# Glass Visual Corrections Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix what the design owner's screenshot review found wrong on screen: the paint splatter is roughly three times too large and bleeds colour through the nav and the content glass, the document page sits flush against the nav with no title, and the dashboard's nav has an empty gap.

**Architecture:** Entirely values and small markup. No new components, no state, no routing. Three of the five fixes are numbers in `lib/splatter/geometry.ts` and `PaintSplatter.tsx`; the rest are a stylesheet rule and one heading. One task is a diagnosis rather than a change.

**Tech Stack:** Next.js 16 App Router (webpack), React 19, CSS Modules, Canvas 2D, Playwright, Vitest.

**Spec:** The design owner's review of 2026-10-02, quoted verbatim in each task. Where it conflicts with `docs/design/glass-handoff.md`, the review is newer and wins; Task 6 updates the handoff so the two agree afterwards.

## Global Constraints

- **No backend changes.** No Prisma schema, sync-server or API route edits.
- **No routing changes.** A separate plan owns the shared-layout restructure; nothing here touches route files or `AppShell`'s structure.
- Every colour, radius, duration and easing from a token in `apps/web/src/app/globals.css` where one exists. Raw values only where the design gives that literal, with a comment.
- `apps/web/test/css-tokens.test.ts` must keep passing.
- Pair every `backdrop-filter` with `-webkit-backdrop-filter`; all animation inside `@media (prefers-reduced-motion: no-preference)`.
- Every test proven to discriminate. **Commit before mutating** — `git checkout --` silently does nothing on an untracked file, which has bitten this project.
- Full gate per task: `pnpm typecheck`, `pnpm --filter @crdt/web build` (no root build script), `pnpm test`, `pnpm --filter @crdt/web exec playwright test`. Baseline: **Vitest 252, Playwright 63**. Revert `apps/web/next-env.d.ts` if the build rewrites it.

## Decisions already made by the design owner — do not re-litigate

- **Splat sizing uses the detailed table** in Task 1, with layer opacity **0.32** (the summary block's figure), not the summary block's `scale(0.35, 0.7)`.
- **Splatter is excluded from the top 90px AND the content glass is raised.** Both, not either.
- The presence count including yourself, and the shared-layout restructure, belong to the shell plan. Not here.

---

### Task 1: Resize the splats

**Files:**
- Modify: `apps/web/src/lib/splatter/geometry.ts`, `apps/web/src/components/PaintSplatter.tsx`
- Modify: `apps/web/test/splatter-geometry.test.ts`

**Interfaces:**
- Consumes: `createRandom` from `lib/splatter/random.ts`.
- Produces: no signature changes. Only the numbers inside `makeSplat` and `splatCount`, and `LAYER_OPACITY`.

The owner's verdict: *"Splatter is still far too big… Rays should taper to a fine point. Right now they're even thickness with big balls on the ends, which is what makes them look like spiders."*

- [ ] **Step 1: Apply the table**

| Value | Now | Change to |
|---|---|---|
| `BASE_CORE_RADIUS` | `30` | `11` |
| splat scale (`PaintSplatter.tsx`) | `range(0.7, 1.4)` | `range(0.6, 1.2)` |
| ray `width` | `scale * range(5, 11)` | `scale * range(1.5, 4)` |
| ray `tipR` | `scale * range(2.5, 6)` | `scale * range(1, 2.5)` |
| ray `length` | `coreR * range(1.4, 3.2)` | `coreR * range(1.5, 5)` |
| droplet distance | `coreR * (1 + t * 0.9 …)` | `coreR * (1 + t * 4 …)` |
| droplet `r` | `scale * (5.5 - 4.7 * t)` | `scale * (2.5 - 2.1 * t)` |
| drip `width` | `scale * range(3, 6)` | `scale * range(1, 2.5)` |
| `splatCount` | `16 + 12 * …` | `10 + 8 * …` |
| `LAYER_OPACITY.subtle` | `0.5` | `0.32` |

Keep the structure untouched — still 9 core circles, 10–23 rays, 35% of rays with a drip, 40–90 droplets at decreasing size, 0–3 core drips. Only magnitudes change.

- [ ] **Step 2: Fix the tests the new numbers break**

`splatter-geometry.test.ts` asserts the count formula explicitly:

```ts
  it('splatCount follows 16 + 12 * sqrt(W*H)/1100', () => {
    expect(splatCount(1100, 1100)).toBe(28)
```

Update that test's expectation and its name to the new formula. Recompute the expected value rather than running the code and pasting what it returns — the point of the test is to pin the formula independently.

Run the whole splatter suite and report every other assertion that moved. The structural tests (ray count, droplet count, drip ratio, life, rotation, drift) should be unaffected because they assert counts and ranges, not sizes. **The radius test is the one to watch:** it independently recomputes the furthest painted extent and asserts the stored radius lands within 1px above it. That should still hold at any scale — if it fails, the geometry and the radius calculation have drifted apart and that is a real defect, not a number to adjust.

- [ ] **Step 3: Verify the rays actually taper**

The owner suspects the rays are drawn at even thickness. Read `apps/web/src/lib/splatter/paint.ts` and check what the streak does between its base and its tip. It should narrow from `width` at the core to roughly 15% of that at the tip, then draw the `tipR` blob.

Report what you find. If it already tapers, say so and change nothing. If it strokes a constant-width line, that is the spider-leg cause and it must be fixed — and note that `splat.radius` assumes ray drips are no wider than `tipR`, so do not widen anything while fixing it.

- [ ] **Step 4: Measure the result**

Re-run the memory replay the handoff documents, so its table stays true. From the repo root:

```bash
npx --no-install tsx <a throwaway script that replays makeSplat with the fixed seed>
```

Report the new splat count and total canvas memory at 1440×900, and the new min/median/max canvas side. Delete the script. The handoff's figures are updated in Task 6.

Also report the widest splat's total span (`2 * radius`) so it can be checked against the owner's *"at most about 120px across"*. If the median is far from that, say so — the table and that sentence came from the same review and should agree.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/splatter apps/web/src/components/PaintSplatter.tsx apps/web/test/splatter-geometry.test.ts
git commit -m "fix(splatter): resize splats to the design's scale"
```

---

### Task 2: Keep splatter out of the nav

**Files:**
- Modify: `apps/web/src/components/PaintSplatter.tsx`
- Test: `apps/web/e2e/glass-shell.spec.ts` (append)

The owner: *"The coloured streaks inside the top bar are splatter showing through the glass. Don't draw any splatter in the top 90px."*

- [ ] **Step 1: Add the exclusion**

The nav is a sticky bar at the top of the viewport, so the exclusion is in **viewport** space, not document space — the splatter canvas is `position: absolute` inside a `position: fixed` parent, so canvas y maps directly to viewport y.

Add a named constant, `NAV_EXCLUSION_PX = 90`, with a comment saying it exists so splat colour does not read through the nav's glass. Then when placing a splat — both at build time and when re-placing one after its life ends — reject any position whose centre, minus its radius, falls above that line. Reject and re-draw a position rather than clamping: clamping would pile splats along the boundary in a visible band.

**Guard against an infinite loop.** On a short viewport the exclusion could reject most of the area. Cap the retries (say 20) and fall back to placing the splat below the line rather than looping forever. Say what you chose.

Specks need the same treatment — they are placed independently and 320 of them across the nav would be just as visible.

- [ ] **Step 2: Write the failing test**

Assert no painted pixel appears in the top 90px. Read the canvas with `toDataURL` is not enough — sample the pixels. In the page, draw the splatter canvas into a scratch canvas and use `getImageData(0, 0, width, 90)` to assert every alpha is 0.

Run it before the fix and confirm it FAILS, then after and confirm it passes. Paste both.

- [ ] **Step 3: Prove it discriminates**

Commit, then set `NAV_EXCLUSION_PX = 0`, confirm the test fails, restore with `git checkout --`, verify `git diff --exit-code`.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/PaintSplatter.tsx apps/web/e2e/glass-shell.spec.ts
git commit -m "fix(splatter): no paint behind the nav"
```

---

### Task 3: Raise the content glass

**Files:**
- Modify: whichever stylesheet supplies the workspace tile and People card fills — find it first

The owner: *"The workspace tile and the People card pick up strong colour from splatter behind them. Raise the tile and card glass from .55 to .7."*

- [ ] **Step 1: Find where those fills actually come from**

`.tile` in `ui.module.css` sets only `border-radius` and `padding` — it has no background. The `.55` the owner saw is `--glass-bg: rgba(255, 255, 255, 0.55)`, reached through `.glass`. So the fills are inherited from a token that the nav, the sign-in card, the sheets and the popovers also use.

**Do not change the token.** Raising `--glass-bg` globally would thicken every glass surface in the app, including ones the owner has not complained about and has already signed off.

Instead find the specific rules for the workspace document tiles, the dashboard workspace tiles and the People panel, and give those a `rgba(255, 255, 255, 0.7)` fill. Report which selectors you changed and which you deliberately left on the token.

- [ ] **Step 2: Check the contrast you just changed**

Raising the fill raises text contrast, so nothing should regress — but the `--text-faint` text on these surfaces was previously measured at 4.51:1 against the bare canvas. Compute the new ratio over `rgba(255,255,255,.7)` on the canvas base and report it. If anything lands under 4.5:1, say so rather than assuming more white is always safer.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/app
git commit -m "fix(ui): raise tile and card glass so splatter does not tint content"
```

---

### Task 4: The document page's gap and title

**Files:**
- Modify: `apps/web/src/app/documents/[id]/document.module.css`, `apps/web/src/app/documents/[id]/DocumentClient.tsx`
- Test: `apps/web/e2e/glass-shell.spec.ts` (append)

The owner: *"The document page touches the bottom of the top bar… the document page has `margin: 28px auto 64px`… The document also has no title. Show the document name as a 32px/600 heading at the top of the page."*

- [ ] **Step 1: The gap**

`.page` is currently `margin: 0 auto`. Change it to `margin: 28px auto 64px`.

The board is not wrapped in `.page`, and its `.scroller` already has `padding: 28px 16px 16px` — so it already has the owner's 28px. Confirm that and leave it alone.

The dashboard and workspace pages want 40px per the review. Check what they have; if they already match, say so and change nothing.

- [ ] **Step 2: The title**

Render the document name as the page's heading, 32px at weight 600, inside `.page` above the editor.

**There is already a screen-reader-only `<h1>` carrying the title**, added when the old header row was removed. Do not add a second heading — promote that one to visible and styled. Two `<h1>`s with the same text, one hidden, is worse than either alone.

Give it `data-testid="document-heading"`. Note that `document-title` is already taken by the create form's input on the workspace page, so do not reuse it.

- [ ] **Step 3: Write the failing test**

Assert the heading is visible with the document's name and computes to 32px at weight 600, and that `.page`'s top margin is 28px. Run before the change to confirm both fail; paste the output.

- [ ] **Step 4: Prove it discriminates**

Commit, then revert the margin to `0 auto`, confirm the margin assertion fails, restore and verify `git diff --exit-code`.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/documents apps/web/e2e/glass-shell.spec.ts
git commit -m "feat(document): a visible title and space below the nav"
```

---

### Task 5: Diagnose the column drag-over outline

**Files:** none expected — this task produces a diagnosis. Change code only if you find a real defect.

The owner reports *"no violet outline on a column when dragging over it"*. **That feature is built.** `board.module.css`'s `.columnOver` sets `background: rgba(255,255,255,.75)` plus `inset 0 0 0 2px var(--accent)`, and `Board.tsx` applies it from its `dragOver` state. So either it is broken, or it was not triggered during the review.

- [ ] **Step 1: Reproduce it**

Write a throwaway Playwright check: start dragging a card, move over a different column, and read that column's computed `box-shadow` mid-drag. The committed drag tests use `dragTo`, which completes atomically and gives no mid-drag moment — so you will need `dragstart` / `dragover` dispatched with a shared `DataTransfer`, or Playwright's `mouse.move` steps.

Report what you observe: does the accent inset appear during a drag-over or not?

- [ ] **Step 2: If it works, say so and stop**

Report that the feature is present and functioning, and that the review's observation was most likely an untriggered state. Delete the throwaway check. Do not change code to fix a bug that does not exist.

- [ ] **Step 3: If it is broken, find out why before fixing**

Likely causes, in order of probability: `onDragLeave` firing as the pointer crosses a child card and clearing `dragOver` immediately; the card's own `onDrop`/`onDragOver` stopping propagation so the column never sees it; or `.columnOver` losing the specificity contest with `.column`.

Name the cause, fix it, and **commit the reproduction as a permanent test** — a visual drag state with no coverage is exactly how this gets lost again. Prove it discriminates.

- [ ] **Step 4: Commit (only if you changed something)**

```bash
git add apps/web/src/components apps/web/e2e
git commit -m "fix(board): show the drag-over outline on the hovered column"
```

---

### Task 6: Verify and reconcile the handoff

**Files:**
- Modify: `docs/design/glass-handoff.md`

- [ ] **Step 1: Full gate**

typecheck clean; `pnpm test` with the exact count; build succeeds with 13 routes unchanged; Playwright all passing from cold. Revert `next-env.d.ts` if rewritten.

- [ ] **Step 2: Make the handoff agree with reality**

The handoff's `### Paint splatter` section records the **old** sizes, count formula, opacity and measured memory. All of those changed in Task 1. Update:

- the per-splat structure's magnitudes and the count formula,
- `LAYER_OPACITY.subtle` to 0.32,
- the measured memory table with Task 1 Step 4's figures,
- the new nav exclusion (90px) as an addition to the spec, with the reason: splat colour read through the nav's glass.

Also record under the Built section: the document page's 28px top margin and visible 32px/600 title, and the raised tile and card glass with the selectors it applies to and the note that `--glass-bg` itself was deliberately left alone.

And record Task 5's finding about the column outline either way — "verified working" is worth writing down, because the next reviewer will otherwise raise it again.

- [ ] **Step 3: Commit**

```bash
git add docs/design/glass-handoff.md
git commit -m "docs: reconcile the handoff with the visual corrections"
```

---

## Self-Review

**1. Spec coverage.** Of the owner's review, this plan covers: splatter size, count, opacity and ray taper (Task 1); the nav exclusion zone (Task 2); content glass tint (Task 3); the document page's gap and missing title (Task 4); and the column drag-over report (Task 5, as a diagnosis). Deliberately **not** here, with their owners named in the header: the tab-highlight slide, the presence count, the dashboard "Workspaces" label, the History button, scroll-shrink and the 760px tab dropdown all belong to the shell plan; the card detail sheet, "Has notes" and the offline pill need the backend.

**2. Placeholder scan.** No "TBD". Task 1's values are a complete table. Tasks 3 and 5 are deliberately framed as "find it, then report" because I could not determine from here where the tile fills resolve from, or whether the drag-over outline is actually broken — those are verification instructions with a required report, not hand-waving.

**3. Type consistency.** No signatures change anywhere in this plan. The only new identifier is `NAV_EXCLUSION_PX` in `PaintSplatter.tsx`, used only there.

**4. The risk worth stating.** Task 1 changes the seeded output, so the splatter pattern every user sees changes. That is intended. It also invalidates the handoff's measured memory table, which is why Task 1 Step 4 re-measures and Task 6 rewrites it — a stale performance figure in a document that tells people "do not raise this without re-measuring" is worse than no figure.
