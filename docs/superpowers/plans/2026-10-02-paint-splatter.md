# Paint Splatter Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the animated paint-splatter layer to the painted canvas background — seeded so every load looks the same, pre-rendered so the animation loop only composites, and still under reduced motion.

**Architecture:** Three separable pieces, each testable on its own: a seeded PRNG and the splat *geometry* generator (pure functions, unit-tested with no DOM), a painter that rasterises one splat onto its own small offscreen canvas once, and a client component that owns the `requestAnimationFrame` loop and does nothing per frame but `drawImage` and speck fills. `CanvasBackground` stays a server component; only the new splatter child is a client component.

**Tech Stack:** Next.js 16 App Router (webpack), React 19, Canvas 2D, Vitest, Playwright.

**Spec:** The owner's message of 2026-10-02, item 1, quoted verbatim in the task bodies. This is **not** in `docs/design/glass-handoff.md` — Task 6 adds it there so the next reader has one source.

## Global Constraints

- **No backend changes.** This is a client-only visual layer.
- **Production defaults are fixed:** `splashes: 'subtle'`, `splashColor: 'purple'`, `splashMotion: 'live'`. The design has these as three settings; build the code so the values are parameters with those defaults, but ship **no** settings UI and no persistence. A toggle nobody can reach is dead weight; a parameterised module is just honest structure.
- **Reduced motion is not optional.** With `prefers-reduced-motion: reduce`, or with motion set to `still`, draw exactly one static frame and never start the loop. A continuously animating background is precisely what that preference exists to stop.
- **The background must never intercept a click.** `apps/web/e2e/glass-shell.spec.ts` already has a guard asserting the canvas layer does not — it must keep passing. The new canvas inherits `pointer-events: none` from `.canvas`; verify, do not assume.
- Every colour here is a raw hex from the owner's palette and stays raw — these are artwork, not design tokens. Put them in one exported constant, not scattered.
- `apps/web/test/css-tokens.test.ts` must keep passing.
- Every test proven to discriminate. Commit before mutating.
- Full gate per task: `pnpm typecheck`, `pnpm --filter @crdt/web build`, `pnpm test`, `pnpm --filter @crdt/web exec playwright test`. Revert `apps/web/next-env.d.ts` if the build rewrites it.

## Performance budget — treat this as a requirement, not advice

- **Each splat gets its own offscreen canvas sized to that splat's bounding box**, never to the viewport. 40 viewport-sized canvases at DPR 2 on a 1440×900 screen is roughly 1.5 GB; the same 40 splats at a few hundred pixels square is a few megabytes. Getting this wrong is the difference between a background and a crash.
- **Device pixel ratio capped at 2**, per the spec.
- **The rAF loop may only** `drawImage` pre-rendered splats and fill specks. No path construction, no gradient creation, no `shadowBlur` inside the loop.
- **Rebuild on resize is debounced 150ms** — rasterising on every resize event would stutter the whole page.
- **Pause the loop when the tab is hidden** (`document.visibilityState`). Not in the owner's spec, but an animation loop burning CPU on a background tab is a defect in anything shipped; state it in the report as an addition.

## File Structure

| File | Responsibility |
|---|---|
| `lib/splatter/random.ts` (new) | Seeded PRNG. Pure, deterministic, unit-tested. |
| `lib/splatter/geometry.ts` (new) | Splat and speck *descriptions* as plain data. Pure, no canvas. |
| `lib/splatter/paint.ts` (new) | Rasterises one splat description onto an offscreen canvas. |
| `components/PaintSplatter.tsx` (new) | Client component: canvas element, rAF loop, resize, visibility, reduced motion. |
| `components/CanvasBackground.tsx` (modify) | Mount `PaintSplatter` between the blobs and the weave. |
| `components/canvas-background.module.css` (modify) | The splatter layer's positioning and opacity. |

---

### Task 1: Seeded randomness

**Files:**
- Create: `apps/web/src/lib/splatter/random.ts`
- Test: `apps/web/test/splatter-random.test.ts`

**Interfaces:**
- Produces: `createRandom(seed: number) => { next(): number; range(min: number, max: number): number; int(min: number, max: number): number; pick<T>(items: readonly T[]): T }`. `next()` returns `[0, 1)`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest'
import { createRandom } from '@/lib/splatter/random'

describe('createRandom', () => {
  it('is deterministic for a seed', () => {
    const a = createRandom(1234)
    const b = createRandom(1234)
    const first = [a.next(), a.next(), a.next()]
    const second = [b.next(), b.next(), b.next()]
    expect(first).toEqual(second)
  })

  it('differs across seeds', () => {
    expect(createRandom(1).next()).not.toBe(createRandom(2).next())
  })

  it('stays in [0,1) over many draws', () => {
    const r = createRandom(7)
    for (let i = 0; i < 10_000; i += 1) {
      const value = r.next()
      expect(value).toBeGreaterThanOrEqual(0)
      expect(value).toBeLessThan(1)
    }
  })

  it('range and int respect their bounds, and int is inclusive', () => {
    const r = createRandom(99)
    const seen = new Set<number>()
    for (let i = 0; i < 2_000; i += 1) {
      const value = r.range(5, 7)
      expect(value).toBeGreaterThanOrEqual(5)
      expect(value).toBeLessThan(7)
      seen.add(r.int(1, 3))
    }
    // int(1,3) must be able to produce 3, or every "0-3 drips" range in the
    // geometry silently loses its top value.
    expect([...seen].sort()).toEqual([1, 2, 3])
  })
})
```

- [ ] **Step 2: Run it, confirm it fails**

Run: `pnpm test -- splatter-random`. Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

Use mulberry32 — small, fast, good enough for artwork, and trivially deterministic:

```ts
export function createRandom(seed: number) {
  let state = seed >>> 0
  function next(): number {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  return {
    next,
    range: (min: number, max: number) => min + next() * (max - min),
    // Inclusive of max: the spec's ranges read as "10–23 rays" and "0–3 drips".
    int: (min: number, max: number) => Math.floor(min + next() * (max - min + 1)),
    pick: <T,>(items: readonly T[]): T => items[Math.floor(next() * items.length)]!,
  }
}
```

- [ ] **Step 4: Run to confirm it passes, then prove the inclusivity test discriminates**

Run: `pnpm test -- splatter-random` — PASS. Then change `int` to the exclusive form (`max - min`), re-run, and confirm the inclusivity assertion FAILS with `[1, 2]`. Restore.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/splatter/random.ts apps/web/test/splatter-random.test.ts
git commit -m "feat(splatter): seeded random"
```

---

### Task 2: Splat geometry

**Files:**
- Create: `apps/web/src/lib/splatter/geometry.ts`
- Test: `apps/web/test/splatter-geometry.test.ts`

**Interfaces:**
- Produces:
  - `PALETTES: { purple: readonly string[]; orange: readonly string[] }`
  - `type Circle = { x: number; y: number; r: number }`
  - `type Ray = { x: number; y: number; angle: number; length: number; width: number; tipR: number; drip: number }` — `drip` is the downward drip length, `0` for none.
  - `type Splat = { color: string; radius: number; core: Circle[]; rays: Ray[]; droplets: Circle[]; drips: Ray[]; rotation: number; life: number; driftX: number; driftY: number }`
  - `type Speck = { x: number; y: number; r: number; color: string; phase: number }`
  - `makeSplat(random: Random, color: string, scale: number): Splat`
  - `splatCount(width: number, height: number): number`
  - `makeSpecks(random: Random, width: number, height: number, palette: readonly string[], count?: number): Speck[]`

The owner's palettes, verbatim — violet appears twice in the purple set on purpose, so `pick` chooses it more often:

```ts
export const PALETTES = {
  purple: [
    '#7b3fe4', '#5b4ee8', '#9d5cf0', '#c13ea6', '#e8559b', '#3d8fdc',
    '#22b8c9', '#f0b429', '#f2843a', '#4cc38a', '#b794f6',
  ],
  orange: [
    '#f2762e', '#f0b429', '#e2453c', '#f59e0b', '#2e8bd6', '#2aa58a',
    '#e8559b', '#7b3fe4', '#22b8c9',
  ],
} as const
```

- [ ] **Step 1: Write the failing test**

Cover the counts the spec fixes, because these are the numbers a later refactor would quietly drift:

```ts
import { describe, it, expect } from 'vitest'
import { createRandom } from '@/lib/splatter/random'
import { makeSplat, makeSpecks, splatCount, PALETTES } from '@/lib/splatter/geometry'

describe('splat geometry', () => {
  it('a splat has 9 core circles, 10-23 rays, 40-90 droplets and 0-3 drips', () => {
    for (let seed = 0; seed < 50; seed += 1) {
      const splat = makeSplat(createRandom(seed), '#7b3fe4', 1)
      expect(splat.core).toHaveLength(9)
      expect(splat.rays.length).toBeGreaterThanOrEqual(10)
      expect(splat.rays.length).toBeLessThanOrEqual(23)
      expect(splat.droplets.length).toBeGreaterThanOrEqual(40)
      expect(splat.droplets.length).toBeLessThanOrEqual(90)
      expect(splat.drips.length).toBeGreaterThanOrEqual(0)
      expect(splat.drips.length).toBeLessThanOrEqual(3)
    }
  })

  it('about 35% of rays carry a drip', () => {
    let rays = 0
    let dripped = 0
    for (let seed = 0; seed < 200; seed += 1) {
      for (const ray of makeSplat(createRandom(seed), '#7b3fe4', 1).rays) {
        rays += 1
        if (ray.drip > 0) dripped += 1
      }
    }
    // Wide band: this pins "a minority of rays, not none and not all", which is
    // what a regression would break, without asserting the PRNG's exact stream.
    expect(dripped / rays).toBeGreaterThan(0.25)
    expect(dripped / rays).toBeLessThan(0.45)
  })

  it('life is 16-32s, rotation within +/-0.25 rad and drift within +/-3px', () => {
    for (let seed = 0; seed < 50; seed += 1) {
      const splat = makeSplat(createRandom(seed), '#7b3fe4', 1)
      expect(splat.life).toBeGreaterThanOrEqual(16_000)
      expect(splat.life).toBeLessThanOrEqual(32_000)
      expect(Math.abs(splat.rotation)).toBeLessThanOrEqual(0.25)
      expect(Math.abs(splat.driftX)).toBeLessThanOrEqual(3)
      expect(Math.abs(splat.driftY)).toBeLessThanOrEqual(3)
    }
  })

  it('splatCount follows 16 + 12 * sqrt(W*H)/1100', () => {
    expect(splatCount(1100, 1100)).toBe(28)
    expect(splatCount(1440, 900)).toBe(16 + Math.round((12 * Math.sqrt(1440 * 900)) / 1100))
  })

  it('specks default to about 320 and sit inside the viewport', () => {
    const specks = makeSpecks(createRandom(3), 800, 600, PALETTES.purple)
    expect(specks).toHaveLength(320)
    for (const speck of specks) {
      expect(speck.x).toBeGreaterThanOrEqual(0)
      expect(speck.x).toBeLessThanOrEqual(800)
      expect(speck.y).toBeGreaterThanOrEqual(0)
      expect(speck.y).toBeLessThanOrEqual(600)
    }
  })

  it('droplets get smaller down the list', () => {
    const { droplets } = makeSplat(createRandom(11), '#7b3fe4', 1)
    // "40-90 scattered at decreasing size" — assert the trend, not every step.
    const firstTen = droplets.slice(0, 10).reduce((sum, d) => sum + d.r, 0) / 10
    const lastTen = droplets.slice(-10).reduce((sum, d) => sum + d.r, 0) / 10
    expect(firstTen).toBeGreaterThan(lastTen)
  })
})
```

- [ ] **Step 2: Run, confirm it fails**

Run: `pnpm test -- splatter-geometry`.

- [ ] **Step 3: Implement the generator**

Build it to satisfy the spec's structure exactly:
- **Core:** 9 circles clustered near the origin, radii scaled by `scale`, offsets small enough that they overlap into one mass.
- **Rays:** `random.int(10, 23)` streaks, each with an angle over the full circle, a length well beyond the core, a width that tapers, and a `tipR` blob at the end. 35% get `drip > 0` — use `random.next() < 0.35`.
- **Droplets:** `random.int(40, 90)`, scattered out to roughly twice the core radius, radius decreasing along the list.
- **Drips:** `random.int(0, 3)` vertical rays from the core, angle fixed downward.
- `radius` is the splat's bounding radius, used by the painter to size its offscreen canvas — compute it from the furthest ray tip plus its blob, and the furthest droplet.
- `life` in milliseconds, `rotation` in radians, `driftX`/`driftY` in CSS pixels.

- [ ] **Step 4: Run to confirm it passes**

Run: `pnpm test -- splatter-geometry` — PASS.

- [ ] **Step 5: Prove two of these discriminate**

Commit first. Then: change the ray count to a fixed `9` and confirm the count test fails; change the drip probability to `1` and confirm the ratio test fails. Restore each with `git checkout --`, verifying `git diff --exit-code`.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/splatter/geometry.ts apps/web/test/splatter-geometry.test.ts
git commit -m "feat(splatter): splat and speck geometry"
```

---

### Task 3: The painter

**Files:**
- Create: `apps/web/src/lib/splatter/paint.ts`

**Interfaces:**
- Consumes: `Splat` from `geometry.ts`.
- Produces: `paintSplat(splat: Splat, dpr: number) => HTMLCanvasElement` — an offscreen canvas sized to `2 * splat.radius * dpr` square, with the splat drawn centred, ready to `drawImage`.

- [ ] **Step 1: Implement**

- Create the canvas via `document.createElement('canvas')`; set `width`/`height` to `Math.ceil(2 * splat.radius * dpr)` and scale the context by `dpr`, then translate to the centre.
- Fill everything in `splat.color`. Draw core circles, then rays (a tapered shape plus a tip circle, plus the drip when `drip > 0`), then drips, then droplets.
- Use `globalAlpha` variation if it helps the look, but **no `shadowBlur`** — it is the single most expensive canvas operation and this runs once per splat at build time, not per frame, so the cost is bounded but still pointless.
- Return the canvas. Never cache it in a module-level map keyed by anything viewport-sized; the component owns the lifetime.

- [ ] **Step 2: Verify it typechecks and the bundle still builds**

Run: `pnpm typecheck` — clean. Run: `pnpm --filter @crdt/web build` — succeeds. There is no unit test here: the painter's only output is pixels, and asserting pixel values in jsdom (which has no real canvas) would test nothing. Say so in your report rather than leaving a reviewer to wonder.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/lib/splatter/paint.ts
git commit -m "feat(splatter): rasterise a splat to an offscreen canvas"
```

---

### Task 4: The component and its loop

**Files:**
- Create: `apps/web/src/components/PaintSplatter.tsx`
- Modify: `apps/web/src/components/CanvasBackground.tsx`, `apps/web/src/components/canvas-background.module.css`

**Interfaces:**
- Produces: `PaintSplatter` — `({ strength = 'subtle', palette = 'purple', motion = 'live' }: { strength?: 'off' | 'subtle' | 'bold'; palette?: 'purple' | 'orange'; motion?: 'live' | 'still' }) => JSX.Element | null`. Returns `null` when `strength === 'off'`.

- [ ] **Step 1: The stylesheet**

Add to `canvas-background.module.css`:

```css
/*
  The splatter sits above the blobs and below the weave, so the texture reads
  over the paint. Opacity comes from the strength setting: .5 subtle, .9 bold.
*/
.splatter {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
}
```

Set the layer opacity inline from `strength` (`0.5` or `0.9`) rather than adding two classes — it is one number driven by a prop.

- [ ] **Step 2: Write the component**

Structure, in this order:

1. A `canvas` ref and a single `useEffect` that owns everything. It must read `window.matchMedia('(prefers-reduced-motion: reduce)').matches`.
2. **Build:** size the canvas to `clientWidth/Height * min(devicePixelRatio, 2)`, seed `createRandom` with a **fixed constant** (not `Date.now()` — the spec says the pattern is the same on every load), generate `splatCount(w, h)` splats and `makeSpecks(...)`, and `paintSplat` each one. Stagger each splat's start time across its own life so they do not all land together.
3. **Static path:** if reduced motion is set, or `motion === 'still'`, draw one frame at full opacity and `return` the cleanup without ever calling `requestAnimationFrame`.
4. **Loop:** one `requestAnimationFrame`. Per frame, clear and for each splat compute its phase from `performance.now()`:
   - **Landing:** first 650ms, scale `0.35 → 1` with ease-out-back, alpha `0 → 1`.
   - **Life:** `splat.life` ms total, drifting up to `driftX/driftY`, at fixed `rotation`.
   - **Fade-out:** the last 2400ms, alpha `1 → 0`; when it ends, re-place that splat at a new random position and restart its phase. Reuse its already-painted canvas — re-rasterising mid-loop is exactly what the budget forbids.
   - Draw with `drawImage` only, using `setTransform` for the position, scale and rotation.
   - **Specks:** fill each at `0.55 + 0.175 * (1 + sin(t / period + speck.phase))` so it shimmers between .55 and .9.
5. **Resize:** a `resize` listener debounced 150ms that tears down and rebuilds.
6. **Visibility:** on `visibilitychange`, cancel the frame when hidden and restart when visible. Note in your report that this is an addition to the spec.
7. **Cleanup:** cancel the frame, remove both listeners, clear the splat canvases.

The effect's dependency array is `[strength, palette, motion]`.

- [ ] **Step 3: Mount it**

In `CanvasBackground.tsx`, add `<PaintSplatter />` between the last blob and `<div className={styles.weave} />`. `CanvasBackground` stays a server component; `PaintSplatter` carries its own `'use client'`.

- [ ] **Step 4: Verify the click guard still holds**

Run: `pnpm --filter @crdt/web exec playwright test glass-shell`
The existing test asserting the background never intercepts a click **must** pass. The new canvas inherits `pointer-events: none` from `.canvas` — confirm with a direct `getComputedStyle` read on the canvas element in a new assertion, rather than trusting inheritance.

- [ ] **Step 5: Add a reduced-motion test**

Playwright can emulate it. With `test.use({ reducedMotion: 'reduce' })`, assert the canvas has been drawn to (its `toDataURL()` is not a blank image) **and** that no animation frame is pending — the practical check is that two `toDataURL()` reads 500ms apart are **identical** under reduced motion, and **differ** without it. Write both halves; the pair is what makes it meaningful.

- [ ] **Step 6: Prove it discriminates**

Commit first. Then remove the reduced-motion branch so the loop always runs, and confirm the "identical under reduced motion" assertion fails. Restore and verify `git diff --exit-code`.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/components/PaintSplatter.tsx apps/web/src/components/CanvasBackground.tsx apps/web/src/components/canvas-background.module.css apps/web/e2e
git commit -m "feat(splatter): animated paint layer on the painted canvas"
```

---

### Task 5: Measure it

**Files:** none — this task produces a report, not a diff.

A continuously animating full-viewport canvas behind every screen is the highest-risk thing in this plan. Measure before declaring it done.

- [ ] **Step 1: Count the work per frame**

Instrument the loop temporarily (do not commit it) to log the number of `drawImage` and speck fills per frame, and the frame duration, over ~200 frames at a 1440×900 viewport. Report the median and the worst frame.

- [ ] **Step 2: Measure the memory of the splat canvases**

Sum `width * height * 4` bytes across every offscreen canvas and report the total in MB at DPR 2. If it exceeds ~40MB, the bounding radii are too large — report it rather than shipping it.

- [ ] **Step 3: Confirm the loop actually stops**

With the tab hidden, confirm no frames are scheduled; with reduced motion, confirm `requestAnimationFrame` was never called at all. A `console.count` in a temporary build is fine.

- [ ] **Step 4: Report**

Put all three numbers in your report. If any looks bad, say so plainly — a slow background is worse than no background.

---

### Task 6: Verify and record

**Files:**
- Modify: `docs/design/glass-handoff.md`

- [ ] **Step 1: Full gate**

typecheck clean; `pnpm test` with the count; build succeeds, routes unchanged; Playwright all passing cold. Revert `next-env.d.ts` if rewritten.

- [ ] **Step 2: Write the splatter spec into the handoff**

The owner's specification lives only in a chat message, which the previous plan's status note already flags as a problem. Add a `### Paint splatter` subsection to the handoff carrying: placement and stacking order, the two palettes verbatim, the strength opacities, the per-splat structure (9 core circles, 10–23 rays with a tip blob and 35% drips, 40–90 decreasing droplets, 0–3 drips), the count formula, the animation timings, the fixed seed, the DPR cap and the reduced-motion rule. Then move it out of "Deferred" in the status section.

Record the two deviations: the three settings exist as parameters with fixed production defaults and no UI, and the loop pauses on a hidden tab.

- [ ] **Step 3: Commit**

```bash
git add docs/design/glass-handoff.md
git commit -m "docs: specify the paint splatter and record it as built"
```

---

## Self-Review

**1. Spec coverage.** Placement and stacking (Task 4 Step 3), both palettes with the duplicated violet (Task 2), strength opacities (Task 4 Step 1), the full per-splat structure and the 35% drip rate (Task 2), the count formula and ~320 specks (Task 2), the fixed seed (Task 4 Step 2), landing/life/fade-out/speck shimmer timings (Tasks 2 and 4), one rAF loop that only composites (Task 4 and the performance budget), 150ms debounced rebuild and the DPR cap (Task 4), and the reduced-motion static frame (Task 4, tested in Step 5). The three settings become parameters with fixed defaults, stated as a deviation.

**2. Placeholder scan.** No "TBD". Tasks 1 and 2 give complete code and complete tests. Tasks 3 and 4 are specified step by step with every number and ordering constraint, but without a full transcription of the drawing code — deliberately, because the painter's output is pixels and the exact brush strokes are a judgement the implementer should make against the spec's structure, not copy from me. Both tasks state exactly what must be true of the result and how it will be checked.

**3. Type consistency.** `createRandom`'s return type is consumed as `Random` by `geometry.ts` — export that type from `random.ts` so `geometry.ts` can name it. `Splat.radius` is the contract between `geometry.ts` and `paint.ts` and is defined where it is produced. `PaintSplatter`'s prop union matches the spec's three settings exactly.
