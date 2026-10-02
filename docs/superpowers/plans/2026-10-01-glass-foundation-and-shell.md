# Glass Foundation and Shell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the app's visual foundation and chrome in the Glass design — painted-canvas background, frosted glass surfaces, a sticky glass nav with document tabs — and restyle sign-in, dashboard and workspace to match.

**Architecture:** All colour, blur, radius and motion values become CSS custom properties on `:root` in `globals.css`, so later plans never hard-code them. A fixed `CanvasBackground` layer renders behind everything from the root layout. The header becomes a sticky glass nav; the document-tabs strip is a client island with a measured sliding indicator. Pages stay server components that fetch data and pass it down, exactly as today.

**Tech Stack:** Next.js 16 App Router (forced `--webpack`), React 19, TypeScript 7, CSS Modules, CSS custom properties, `ResizeObserver`, Playwright, Vitest.

**Spec:** `docs/design/glass-handoff.md` (the design handoff). The interactive prototype it describes is at `docs/design/glass-prototype.html` and is the visual source of truth — open it in a browser when a value is ambiguous.

## Global Constraints

- **The spec is `docs/design/glass-handoff.md`. Copy exact values from it** — colours, radii, blur, shadows, easing, durations, sizes. Do not approximate, round, or substitute a "close enough" value.
- **Never hard-code a design value in a component or module CSS when a token exists.** Every colour, radius, blur, duration and easing comes from a `var(--…)` defined in `globals.css`.
- **Do not change any behaviour.** This plan is visual. No route changes, no data-model changes, no new API routes, no auth changes.
- **Do not modify anything under `apps/web/src/app/api/`, `apps/sync/`, `packages/`, `prisma/`, or `render.yaml`.**
- **Every `data-testid` currently in the app must survive with identical semantics.** The e2e suite depends on these: `auth-error`, `signin-github`, `signin-google`, `current-user`, `sign-out`, `workspace-<id>`, `workspace-name`, `create-workspace`, `document-<id>`, `document-title`, `document-type`, `create-document`, `member-<id>`, `member-email`, `member-role`, `add-member`, `member-error`, `workspace-link`, `role`, `status`, `read-only`, `add-column`, `add-card-<columnId>`, `column-<id>`, `card-<id>`, `presence-<name>`, `card-presence-<id>`. Moving an element is fine; renaming or dropping its test id is not.
- **`data-testid="status"` must keep rendering the connection status string as its exact and only text content** (`connecting` / `connected` / `disconnected` / `fatal`). `collaboration.spec.ts` asserts `toHaveText('connected')`.
- **`data-testid="document-title"` is used twice** — the create-document input on the workspace page, and the `<h1>` on the document page. They never render together. Keep both.
- **Pair every `backdrop-filter` with `-webkit-backdrop-filter`**, and provide the no-support fallback from the spec: raise glass opacity to `.92` under `@supports not (backdrop-filter: blur(1px))`.
- **Wrap all motion in `@media (prefers-reduced-motion: no-preference)`**, and pause the canvas blob animation when reduced motion is requested.
- **Add no new runtime dependencies.** The font is the system stack; there is nothing to install.
- **Next 16:** `params` and `searchParams` are Promises in Server Components and must be awaited. A repeated query param arrives as an array — narrow with `typeof x === 'string'` before use.
- **`redirect()` from `next/navigation` must never sit inside a `try` whose `catch` swallows errors.**
- **Relative imports inside `apps/web/src/lib/` carry a `.js` extension.** Imports through `@/` do not.
- Run commands from the repo root. Vitest: `pnpm test`. Typecheck: `pnpm typecheck`. E2E: `pnpm --filter @crdt/web exec playwright test` (it starts the web and sync servers itself).
- **Postgres runs in Docker on port 5433 and is shared with other checkouts.** Never start, stop or restart it.
- **Do not commit `apps/web/next-env.d.ts`.**
- Commit after every task, conventional-commit prefixes.

---

## What this plan deliberately does NOT build

These appear in the nav and screens in the spec, and belong to later plans. Where the spec places one in the nav, this plan leaves a **slot** — a documented, empty position — rather than an inert button that looks clickable and does nothing.

| Deferred | Plan |
|---|---|
| Status pill + status popover | 2 — sync telemetry |
| Offline / syncing floating pills, toasts | 2 |
| Presence avatars in the nav, tab "others are here" dot | 2 (needs provider state lifted to the nav) |
| History button + history panel + version preview bar | 3 |
| Card sheet, card peer rings, board restyle | 4 |
| ⌘K palette (the search field is built but opens nothing yet) | 5 |
| Share sheet (the Share button is built but opens nothing yet) | 5 |

**Two exceptions, built here because the nav is unusable without them:** the search field and the Share button are rendered to spec but are **disabled** with `aria-disabled="true"` and `title="Coming soon"`, so nothing looks clickable that isn't. Plan 5 wires both.

---

## File Structure

### New files

| File | Responsibility |
|---|---|
| `apps/web/src/components/CanvasBackground.tsx` | The fixed painted-canvas layer: five animated blobs plus the weave overlay. Mounted once in the root layout. |
| `apps/web/src/components/canvas-background.module.css` | Blob sizes, positions, colours, keyframe wiring, reduced-motion handling. |
| `apps/web/src/components/NavTabs.tsx` | Client island: the Overview + document tabs strip and the measured sliding glass indicator. |
| `apps/web/src/components/nav-tabs.module.css` | Tab, strip, overflow-mask and indicator styles. |
| `apps/web/src/components/UserMenu.tsx` | Client island: the 36px avatar button and its popover (name, email, All workspaces, Sign out). |
| `apps/web/src/components/user-menu.module.css` | Avatar button and popover styles. |

### Modified files

| File | Change |
|---|---|
| `apps/web/src/app/globals.css` | Replaced wholesale: Glass tokens, reset, typography, keyframes, glass recipe helper, editor rules kept. |
| `apps/web/src/app/layout.tsx` | Mounts `CanvasBackground`; sets the scroll model. |
| `apps/web/src/components/ui/ui.module.css` | Replaced: glass buttons, pill inputs, glass panels/tiles, chips, segmented control. |
| `apps/web/src/components/ui/Button.tsx` | Variants become `accent` / `glass` / `ghost` / `danger`. |
| `apps/web/src/components/ui/TextField.tsx` | Pill input, optional label hiding. |
| `apps/web/src/components/ui/Panel.tsx` | Becomes a glass surface. |
| `apps/web/src/components/AppShell.tsx` | Becomes the sticky glass nav; gains `workspace`, `documents`, `activeDocumentId` props. |
| `apps/web/src/components/app-shell.module.css` | Replaced: sticky wrapper, nav bar, slots, responsive rules. |
| `apps/web/src/components/SignOutButton.tsx` | Moves into the user menu; keeps `data-testid="sign-out"`. |
| `apps/web/src/app/(auth)/layout.tsx`, `auth.module.css`, `login/page.tsx` | Glass sign-in card. |
| `apps/web/src/app/page.tsx`, `dashboard.module.css`, `CreateWorkspaceForm.tsx` | Dashboard tile grid + dashed create tile. |
| `apps/web/src/app/workspaces/[id]/page.tsx`, `workspace.module.css`, `CreateDocumentForm.tsx`, `MembersPanel.tsx` | Document tiles, segmented create tile, People list. |
| `apps/web/e2e/glass-shell.spec.ts` (new) | E2E for the nav, tabs and indicator. |

### Why this shape

`CanvasBackground` and `NavTabs` are separate client islands because they are the only two pieces needing browser APIs (animation preferences, `ResizeObserver`). Everything else stays a server component. `AppShell` remains a server component that *composes* those islands, so pages keep passing data down rather than fetching in the client.

---

## Task 1: Design tokens, typography, keyframes

**Files:**
- Modify: `apps/web/src/app/globals.css` (replace wholesale)
- Modify: `apps/web/src/app/layout.tsx`

**Interfaces:**
- Consumes: nothing.
- Produces: every token later tasks use. Exact names, all on `:root`:
  `--canvas-base --text --text-2 --text-muted --text-faint --icon-faint --danger`
  `--accent --accent-hover --accent-text --accent-tint --accent-shadow --accent-ring`
  `--ok --warn --sync`
  `--glass-bg --glass-bg-strong --glass-bg-sheet --glass-border --glass-blur --glass-highlight --field-bg --field-border`
  `--ease --dur-fast --dur --dur-slow`
  `--r-pill --r-card --r-tile --r-column --r-sheet --r-panel`
  Keyframes: `g-in g-pop g-sheet g-side g-fade g-up g-pulse g-paint`.

**No unit test.** This repo has no jsdom and no React Testing Library (`apps/web/vitest.config.ts` sets `environment: 'node'`), and these are values, not logic. The honest verification is that it compiles, the production build resolves the CSS, and the e2e suite still passes. Do not write a test that asserts nothing.

- [ ] **Step 1: Replace `globals.css`**

Replace the whole file. The `.editor .ProseMirror` and `.collaboration-carets__*` rules at the bottom are load-bearing for the Tiptap editor and must survive — they are reproduced here with the Glass typography applied.

```css
:root {
  /* surfaces */
  --canvas-base: #f1f1ef;
  --text: #1c1d1b;
  --text-2: #3d403b;
  --text-muted: #5f625d;
  --text-faint: #7b7e78;
  --icon-faint: #a3a6a0;
  --danger: #c4372b;

  /* accent: indigo-violet */
  --accent: oklch(0.42 0.11 285);
  --accent-hover: oklch(0.37 0.11 285);
  --accent-text: oklch(0.38 0.1 285);
  --accent-tint: oklch(0.95 0.02 285);
  --accent-shadow: oklch(0.42 0.11 285 / 0.22);
  --accent-ring: oklch(0.42 0.11 285 / 0.1);

  /* status */
  --ok: oklch(0.62 0.13 150);
  --warn: oklch(0.72 0.15 65);
  --sync: oklch(0.42 0.11 285);

  /* glass */
  --glass-bg: rgba(255, 255, 255, 0.55);
  --glass-bg-strong: rgba(255, 255, 255, 0.72);
  --glass-bg-sheet: rgba(255, 255, 255, 0.82);
  --glass-border: rgba(255, 255, 255, 0.85);
  --glass-blur: blur(28px) saturate(190%);
  --glass-highlight: inset 0 1px 0 rgba(255, 255, 255, 0.95);
  --field-bg: rgba(240, 240, 244, 0.9);
  --field-border: rgba(40, 40, 60, 0.12);

  /* motion */
  --ease: cubic-bezier(0.32, 0.72, 0, 1);
  --dur-fast: 0.3s;
  --dur: 0.55s;
  --dur-slow: 0.7s;

  /* radii */
  --r-pill: 999px;
  --r-card: 18px;
  --r-tile: 24px;
  --r-column: 26px;
  --r-sheet: 30px;
  --r-panel: 28px;

  --font: -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', system-ui, sans-serif;
}

*,
*::before,
*::after {
  box-sizing: border-box;
}

html {
  /* The page itself scrolls; there is no inner scroll container and no sidebar. */
  height: 100%;
}

body {
  min-height: 100%;
  margin: 0;
  background: var(--canvas-base);
  color: var(--text);
  font-family: var(--font);
  font-size: 15px;
  line-height: 1.47;
  letter-spacing: -0.01em;
  -webkit-font-smoothing: antialiased;
  text-rendering: optimizeLegibility;
}

h1,
h2,
h3 {
  margin: 0;
  font-weight: 600;
}

h1 {
  font-size: 32px;
  letter-spacing: -0.025em;
}

h2 {
  font-size: 21px;
  letter-spacing: -0.02em;
}

h3 {
  font-size: 18px;
}

p {
  margin: 0;
  text-wrap: pretty;
}

a {
  color: var(--accent-text);
  text-decoration: none;
}

a:hover {
  text-decoration: underline;
}

button,
input,
select,
textarea {
  font: inherit;
  letter-spacing: inherit;
  color: inherit;
}

:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

/* Screen and surface entrances. Every one is motion-gated below. */
@keyframes g-in {
  from {
    opacity: 0;
    transform: translateY(14px);
    filter: blur(6px);
  }
  to {
    opacity: 1;
    transform: none;
    filter: none;
  }
}

@keyframes g-pop {
  from {
    opacity: 0;
    transform: translateY(-6px) scale(0.96);
    filter: blur(4px);
  }
  to {
    opacity: 1;
    transform: none;
    filter: none;
  }
}

@keyframes g-sheet {
  from {
    opacity: 0;
    transform: translateY(24px) scale(0.97);
  }
  to {
    opacity: 1;
    transform: none;
  }
}

@keyframes g-side {
  from {
    opacity: 0;
    transform: translateX(28px);
  }
  to {
    opacity: 1;
    transform: none;
  }
}

@keyframes g-fade {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}

@keyframes g-up {
  from {
    opacity: 0;
    transform: translate(-50%, 16px) scale(0.96);
  }
  to {
    opacity: 1;
    transform: translate(-50%, 0);
  }
}

@keyframes g-pulse {
  0%,
  100% {
    opacity: 1;
    transform: scale(1);
  }
  50% {
    opacity: 0.4;
    transform: scale(0.8);
  }
}

@keyframes g-paint {
  0%,
  100% {
    transform: translate(0, 0) rotate(0) scale(1);
    border-radius: 42% 58% 63% 37% / 41% 44% 56% 59%;
  }
  33% {
    transform: translate(50px, -30px) rotate(12deg) scale(1.08);
    border-radius: 63% 37% 44% 56% / 55% 62% 38% 45%;
  }
  66% {
    transform: translate(-30px, 40px) rotate(-8deg) scale(0.95);
    border-radius: 38% 62% 56% 44% / 48% 36% 64% 52%;
  }
}

/*
  Browsers without backdrop-filter get opaque surfaces instead of transparent
  ones. Without this the glass reads as barely-tinted white and text over the
  canvas blobs loses contrast.
*/
@supports not (backdrop-filter: blur(1px)) {
  :root {
    --glass-bg: rgba(255, 255, 255, 0.92);
    --glass-bg-strong: rgba(255, 255, 255, 0.92);
    --glass-bg-sheet: rgba(255, 255, 255, 0.92);
  }
}

/* Tiptap editor surface. Typography follows the Glass document spec. */
.editor .ProseMirror {
  min-height: 60vh;
  outline: none;
  caret-color: var(--accent);
}

.editor .ProseMirror h1 {
  font-size: 32px;
  font-weight: 600;
  margin: 0 0 20px;
}

.editor .ProseMirror h2 {
  font-size: 21px;
  font-weight: 600;
  margin: 28px 0 8px;
}

.editor .ProseMirror p {
  font-size: 17px;
  line-height: 1.65;
  color: var(--text-2);
  margin: 0 0 12px;
}

.collaboration-carets__caret {
  border-left: 1px solid;
  border-right: 1px solid;
  margin-left: -1px;
  margin-right: -1px;
  pointer-events: none;
  position: relative;
  word-break: normal;
}

.collaboration-carets__label {
  border-radius: 3px 3px 3px 0;
  color: #fff;
  font-size: 11px;
  font-weight: 500;
  left: -1px;
  line-height: 1;
  padding: 3px 5px;
  position: absolute;
  top: -1.4em;
  user-select: none;
  white-space: nowrap;
  box-shadow: 0 4px 10px rgba(30, 45, 40, 0.18);
}
```

- [ ] **Step 2: Mount the canvas slot in the layout**

Replace `apps/web/src/app/layout.tsx`. `CanvasBackground` does not exist yet — Task 2 creates it — so this step only prepares the structure and leaves the import commented with a pointer. Do **not** leave a broken import.

```tsx
import './globals.css'

import type { ReactNode } from 'react'
import { WarmSync } from '@/components/WarmSync'

export const metadata = { title: 'CRDT Workspace' }

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <WarmSync />
        {children}
      </body>
    </html>
  )
}
```

(Unchanged for now. Task 2 adds `CanvasBackground` here once it exists.)

- [ ] **Step 3: Verify it compiles and the suite still passes**

Run: `pnpm typecheck` — Expected: clean.
Run: `pnpm --filter @crdt/web build` — Expected: completes. This is the step that proves the CSS resolves under the forced-webpack config.
Run: `pnpm --filter @crdt/web exec playwright test` — Expected: all pass. Styling changed; behaviour did not. Any failure here is a real regression, not an expected consequence.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/app/globals.css apps/web/src/app/layout.tsx
git commit -m "feat(ui): add Glass design tokens, typography and keyframes"
```

---

## Task 2: Painted canvas background

**Files:**
- Create: `apps/web/src/components/CanvasBackground.tsx`
- Create: `apps/web/src/components/canvas-background.module.css`
- Modify: `apps/web/src/app/layout.tsx`

**Interfaces:**
- Consumes: `--canvas-base`, keyframe `g-paint` (Task 1).
- Produces: `<CanvasBackground />`, a server component rendering a fixed, non-interactive layer. Later tasks assume `z-index: 0` behind content and `pointer-events: none`.

**No unit test**, same reasoning as Task 1. Verified by build and by the e2e check in Step 4 that it never intercepts clicks.

- [ ] **Step 1: Write the stylesheet**

Create `apps/web/src/components/canvas-background.module.css`. Blob order, sizes, positions and colours are copied exactly from the spec:

```css
.canvas {
  position: fixed;
  inset: 0;
  z-index: 0;
  overflow: hidden;
  pointer-events: none;
  background: var(--canvas-base);
}

.blob {
  position: absolute;
  filter: blur(90px);
  opacity: 0.55;
  border-radius: 42% 58% 63% 37% / 41% 44% 56% 59%;
}

/* Animation is opt-in: without this guard the page moves for people who asked it not to. */
@media (prefers-reduced-motion: no-preference) {
  .blob {
    animation-name: g-paint;
    animation-timing-function: ease-in-out;
    animation-iteration-count: infinite;
  }
}

.b1 {
  width: 620px;
  height: 520px;
  left: -140px;
  top: -160px;
  background: oklch(0.86 0.012 260);
  animation-duration: 52s;
}

.b2 {
  width: 520px;
  height: 460px;
  right: -120px;
  top: -60px;
  background: oklch(0.9 0.015 80);
  animation-duration: 60s;
  animation-direction: reverse;
}

.b3 {
  width: 480px;
  height: 420px;
  right: 18%;
  bottom: -180px;
  background: oklch(0.83 0.01 240);
  animation-duration: 68s;
}

.b4 {
  width: 520px;
  height: 440px;
  left: 12%;
  bottom: -200px;
  background: oklch(0.92 0.012 60);
  animation-duration: 76s;
  animation-direction: reverse;
}

.b5 {
  width: 360px;
  height: 320px;
  left: 44%;
  top: 22%;
  background: oklch(0.88 0.008 200);
  animation-duration: 84s;
}

/*
  Canvas weave. multiply keeps it reading as texture on the paper rather than a
  grey film laid over it.
*/
.weave {
  position: absolute;
  inset: 0;
  mix-blend-mode: multiply;
  background:
    repeating-linear-gradient(0deg, rgba(60, 50, 30, 0.018) 0 1px, transparent 1px 3px),
    repeating-linear-gradient(90deg, rgba(60, 50, 30, 0.015) 0 1px, transparent 1px 4px);
}
```

- [ ] **Step 2: Write the component**

Create `apps/web/src/components/CanvasBackground.tsx`. No `'use client'` — it has no interactivity, and the reduced-motion decision is made in CSS, not JavaScript:

```tsx
import styles from './canvas-background.module.css'

/**
 * The painted canvas behind every screen: five slow blurred blobs under a woven
 * texture. Fixed and pointer-events:none, so it never scrolls with content and
 * never intercepts a click.
 *
 * The blob animation is CSS-only and gated on prefers-reduced-motion, so it
 * needs no client JavaScript and costs nothing on the server.
 */
export function CanvasBackground() {
  return (
    <div className={styles.canvas} aria-hidden="true">
      <div className={`${styles.blob} ${styles.b1}`} />
      <div className={`${styles.blob} ${styles.b2}`} />
      <div className={`${styles.blob} ${styles.b3}`} />
      <div className={`${styles.blob} ${styles.b4}`} />
      <div className={`${styles.blob} ${styles.b5}`} />
      <div className={styles.weave} />
    </div>
  )
}
```

- [ ] **Step 3: Mount it, and lift content above it**

Replace `apps/web/src/app/layout.tsx`:

```tsx
import './globals.css'

import type { ReactNode } from 'react'
import { CanvasBackground } from '@/components/CanvasBackground'
import { WarmSync } from '@/components/WarmSync'

export const metadata = { title: 'CRDT Workspace' }

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <CanvasBackground />
        <WarmSync />
        {/*
          The canvas is fixed at z-index 0, so everything else needs a stacking
          context above it. position:relative is what gives z-index meaning here.
        */}
        <div style={{ position: 'relative', zIndex: 1 }}>{children}</div>
      </body>
    </html>
  )
}
```

- [ ] **Step 4: Write a failing e2e test that the canvas never swallows clicks**

A full-viewport fixed layer is exactly the kind of thing that silently breaks every button on the page. Create `apps/web/e2e/glass-shell.spec.ts`:

```ts
import { test, expect } from '@playwright/test'

test('the canvas background never intercepts a click', async ({ page }) => {
  await page.goto('/login')

  // Whatever sits at the centre of the viewport, it must not be the canvas.
  const tag = await page.evaluate(() => {
    const el = document.elementFromPoint(window.innerWidth / 2, window.innerHeight / 2)
    return el?.className ?? ''
  })
  expect(String(tag)).not.toContain('canvas')

  // And the sign-in button is still genuinely clickable.
  await expect(page.getByTestId('signin-github')).toBeVisible()
  await page.getByTestId('signin-github').click({ trial: true })
})
```

Run: `pnpm --filter @crdt/web exec playwright test glass-shell`
Expected: PASS. If it fails, the canvas is capturing pointer events — fix `pointer-events: none` or the stacking context rather than the test.

- [ ] **Step 5: Prove the test discriminates**

Temporarily delete `pointer-events: none;` from `.canvas`. Re-run the test. Expected: FAIL — the element at the centre point is now the canvas. Restore it with `git checkout --` and confirm it passes again. Report both observations.

- [ ] **Step 6: Full verification**

Run: `pnpm typecheck` — clean.
Run: `pnpm --filter @crdt/web exec playwright test` — all pass.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/components/CanvasBackground.tsx apps/web/src/components/canvas-background.module.css apps/web/src/app/layout.tsx apps/web/e2e/glass-shell.spec.ts
git commit -m "feat(ui): add the painted canvas background"
```

---

## Task 3: Glass UI primitives

**Files:**
- Modify: `apps/web/src/components/ui/ui.module.css` (replace wholesale)
- Modify: `apps/web/src/components/ui/Button.tsx`
- Modify: `apps/web/src/components/ui/TextField.tsx`
- Modify: `apps/web/src/components/ui/Panel.tsx`

**Interfaces:**
- Consumes: all tokens from Task 1.
- Produces:
  - `Button` — `(props: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'accent' | 'glass' | 'ghost' | 'danger' }) => JSX.Element`. Client component. `type` still defaults to `'button'`.
  - `TextField` — `(props: InputHTMLAttributes<HTMLInputElement> & { label: string; hideLabel?: boolean }) => JSX.Element`. Client component, label wired by `useId`.
  - `Panel` — `({ title?, action?, children }) => JSX.Element`. Server-safe.
  - `ui.module.css` exports, consumed directly by later tasks: `.glass .tile .chip .chipAccent .segmented .segment .segmentOn .empty .error .pillInput .count`.

**Critical:** `Button`'s `type` default of `'button'` is load-bearing — `SignOutButton` relies on it. Every form submit button passes `type="submit"` explicitly.

- [ ] **Step 1: Replace `ui.module.css`**

```css
/*
  The shared glass recipe. Every frosted surface in the app composes this class
  rather than repeating the four properties, so a change to the blur or the
  highlight lands everywhere at once.
*/
.glass {
  background: var(--glass-bg);
  backdrop-filter: var(--glass-blur);
  -webkit-backdrop-filter: var(--glass-blur);
  border: 1px solid var(--glass-border);
  box-shadow: var(--glass-highlight), 0 10px 30px rgba(30, 45, 40, 0.08);
}

.button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  height: 36px;
  padding: 0 18px;
  border: 1px solid transparent;
  border-radius: var(--r-pill);
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  white-space: nowrap;
}

@media (prefers-reduced-motion: no-preference) {
  .button {
    transition:
      transform 0.4s var(--ease),
      background 0.3s var(--ease);
  }
  .button:active:not(:disabled) {
    transform: scale(0.96);
  }
}

.button:disabled,
.button[aria-disabled='true'] {
  opacity: 0.5;
  cursor: not-allowed;
}

.accent {
  background: var(--accent);
  color: #fff;
  box-shadow: 0 4px 14px var(--accent-shadow);
}

.accent:hover:not(:disabled) {
  background: var(--accent-hover);
}

.glassButton {
  background: var(--glass-bg-strong);
  backdrop-filter: var(--glass-blur);
  -webkit-backdrop-filter: var(--glass-blur);
  border-color: var(--field-border);
  color: var(--text);
  box-shadow: var(--glass-highlight), 0 2px 8px rgba(30, 45, 40, 0.06);
}

.glassButton:hover:not(:disabled) {
  background: #fff;
}

.ghost {
  background: transparent;
  color: var(--text-muted);
}

.ghost:hover:not(:disabled) {
  background: rgba(0, 0, 0, 0.05);
  color: var(--text);
}

.danger {
  background: transparent;
  color: var(--danger);
}

.danger:hover:not(:disabled) {
  background: rgba(196, 55, 43, 0.08);
}

.field {
  display: grid;
  gap: 6px;
}

.label {
  font-size: 13px;
  font-weight: 500;
  color: var(--text-muted);
}

/* Visually hidden but still read by screen readers and by Playwright's getByLabel. */
.labelHidden {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
  border: 0;
}

.input,
.pillInput {
  width: 100%;
  height: 40px;
  padding: 0 16px;
  background: var(--field-bg);
  border: 1px solid var(--field-border);
  border-radius: var(--r-pill);
  font-size: 14.5px;
  box-shadow: inset 0 1px 2px rgba(30, 30, 50, 0.06);
}

.input::placeholder,
.pillInput::placeholder {
  color: var(--text-faint);
}

.input:focus,
.pillInput:focus {
  outline: none;
  background: #fff;
  border-color: var(--accent);
  box-shadow: 0 0 0 5px var(--accent-ring);
}

.panel {
  border-radius: var(--r-panel);
  overflow: hidden;
}

.panelHeader {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 18px 22px;
  border-bottom: 1px solid rgba(40, 40, 60, 0.08);
}

.panelBody {
  padding: 18px 22px;
}

.tile {
  border-radius: var(--r-tile);
  padding: 22px;
}

@media (prefers-reduced-motion: no-preference) {
  .tile {
    transition:
      transform 0.4s var(--ease),
      box-shadow 0.4s var(--ease);
  }
}

.chip {
  display: inline-flex;
  align-items: center;
  height: 22px;
  padding: 0 10px;
  border-radius: var(--r-pill);
  background: rgba(0, 0, 0, 0.05);
  font-size: 12px;
  font-weight: 500;
  color: var(--text-muted);
}

.chipAccent {
  background: var(--accent-tint);
  color: var(--accent-text);
}

.count {
  min-width: 22px;
  justify-content: center;
}

.segmented {
  display: inline-flex;
  padding: 3px;
  gap: 3px;
  background: rgba(0, 0, 0, 0.05);
  border-radius: var(--r-pill);
}

.segment {
  height: 30px;
  padding: 0 14px;
  border: 0;
  border-radius: var(--r-pill);
  background: transparent;
  font-size: 13.5px;
  font-weight: 500;
  color: var(--text-muted);
  cursor: pointer;
}

.segmentOn {
  background: #fff;
  color: var(--text);
  box-shadow: 0 1px 3px rgba(30, 45, 40, 0.14);
}

.empty {
  color: var(--text-muted);
  font-size: 14px;
}

.error {
  padding: 10px 14px;
  border: 1px solid rgba(196, 55, 43, 0.25);
  border-radius: var(--r-card);
  background: rgba(196, 55, 43, 0.06);
  color: var(--danger);
  font-size: 13px;
}
```

- [ ] **Step 2: Update `Button.tsx`**

```tsx
'use client'

import type { ButtonHTMLAttributes } from 'react'
import styles from './ui.module.css'

type Variant = 'accent' | 'glass' | 'ghost' | 'danger'

const VARIANT_CLASS: Record<Variant, string> = {
  accent: styles.accent!,
  glass: styles.glassButton!,
  ghost: styles.ghost!,
  danger: styles.danger!,
}

export function Button({
  variant = 'accent',
  className,
  type = 'button',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      {...props}
      type={type}
      className={[styles.button, VARIANT_CLASS[variant], className].filter(Boolean).join(' ')}
    />
  )
}
```

`type` defaults to `'button'` on purpose. HTML's own default is `'submit'`, which makes any button dropped inside a form submit it by accident; `SignOutButton` depends on this default.

- [ ] **Step 3: Update `TextField.tsx`**

```tsx
'use client'

import { useId, type InputHTMLAttributes } from 'react'
import styles from './ui.module.css'

export function TextField({
  label,
  hideLabel = false,
  className,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label: string; hideLabel?: boolean }) {
  const id = useId()
  return (
    <div className={styles.field}>
      {/*
        When hidden the label is still in the DOM and still associated with the
        input, so screen readers and Playwright's getByLabel both keep working.
      */}
      <label className={hideLabel ? styles.labelHidden : styles.label} htmlFor={id}>
        {label}
      </label>
      <input {...props} id={id} className={[styles.pillInput, className].filter(Boolean).join(' ')} />
    </div>
  )
}
```

- [ ] **Step 4: Update `Panel.tsx`**

```tsx
import type { ReactNode } from 'react'
import styles from './ui.module.css'

export function Panel({
  title,
  action,
  children,
}: {
  title?: string
  action?: ReactNode
  children: ReactNode
}) {
  return (
    <section className={`${styles.glass} ${styles.panel}`}>
      {(title ?? action) && (
        <header className={styles.panelHeader}>
          {title ? <h2>{title}</h2> : <span />}
          {action}
        </header>
      )}
      <div className={styles.panelBody}>{children}</div>
    </section>
  )
}
```

No `'use client'` — `Panel` uses no hooks and must stay renderable from Server Components.

- [ ] **Step 5: Verify**

Run: `pnpm typecheck` — clean.
Run: `pnpm --filter @crdt/web build` — completes.
Run: `pnpm --filter @crdt/web exec playwright test` — all pass. Variant names changed (`primary`→`accent`, `secondary`→`glass`); the typecheck catches every call site that still uses an old name. Fix those call sites as part of this task.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components/ui
git commit -m "feat(ui): rebuild the UI primitives as glass surfaces"
```

---

## Task 4: The sticky glass nav

**Files:**
- Modify: `apps/web/src/components/AppShell.tsx`
- Modify: `apps/web/src/components/app-shell.module.css` (replace wholesale)
- Create: `apps/web/src/components/UserMenu.tsx`
- Create: `apps/web/src/components/user-menu.module.css`
- Modify: `apps/web/src/components/SignOutButton.tsx`
- Modify: `apps/web/src/app/page.tsx`, `apps/web/src/app/workspaces/[id]/page.tsx` (pass the new props)

**Interfaces:**
- Consumes: `Button`, `ui.module.css` `.glass` (Task 3); `colorFor` from `@/lib/color`; `SessionUser` from `@/lib/current-user`.
- Produces:
  - `AppShell` — `({ user, workspace?, documents?, activeDocumentId?, children }) => JSX.Element`, where
    `workspace?: { id: string; name: string }`,
    `documents?: Array<{ id: string; title: string; type: 'doc' | 'board' }>`,
    `activeDocumentId?: string`.
    Server component.
  - `UserMenu` — `({ user }: { user: SessionUser }) => JSX.Element`. Client component. Contains the element carrying `data-testid="sign-out"`.

The nav's tab strip is added in Task 5; this task renders everything around it and leaves the strip's position in the layout.

- [ ] **Step 1: Write the nav stylesheet**

Replace `apps/web/src/components/app-shell.module.css`:

```css
.shell {
  min-height: 100vh;
}

/*
  The nav floats over the scrolling page rather than pinning to the viewport
  edge, so the 12px of padding is part of the design, not a margin on the bar.
*/
.navWrap {
  position: sticky;
  top: 0;
  z-index: 30;
  padding: 12px 16px 0;
}

.nav {
  display: flex;
  align-items: center;
  gap: 10px;
  height: 56px;
  padding: 0 8px 0 10px;
  border-radius: var(--r-pill);
  background: var(--glass-bg-strong);
  backdrop-filter: var(--glass-blur);
  -webkit-backdrop-filter: var(--glass-blur);
  border: 1px solid rgba(40, 40, 60, 0.1);
  box-shadow:
    inset 0 1px 0 #fff,
    0 12px 32px rgba(30, 30, 50, 0.12),
    0 2px 6px rgba(30, 30, 50, 0.08);
}

@media (prefers-reduced-motion: no-preference) {
  .nav {
    animation: g-pop 0.6s var(--ease);
  }
}

.logo {
  flex: none;
  width: 36px;
  height: 36px;
  border: 0;
  border-radius: 50%;
  background: var(--accent);
  cursor: pointer;
  box-shadow: 0 4px 14px var(--accent-shadow);
}

@media (prefers-reduced-motion: no-preference) {
  .logo {
    transition: transform 0.4s var(--ease);
  }
  .logo:hover {
    transform: rotate(-8deg) scale(1.05);
  }
  .logo:active {
    transform: scale(0.92);
  }
}

.workspaceName {
  flex: none;
  border: 0;
  background: transparent;
  padding: 0 4px;
  font-size: 15px;
  font-weight: 600;
  color: var(--text);
  cursor: pointer;
  white-space: nowrap;
}

.divider {
  flex: none;
  width: 1px;
  height: 22px;
  background: rgba(40, 40, 60, 0.12);
}

/* Task 5 fills this. Keeping it here means the nav's flex layout is final now. */
.tabsSlot {
  flex: 1 1 auto;
  min-width: 120px;
}

.search {
  flex: none;
  display: flex;
  align-items: center;
  gap: 10px;
  height: 36px;
  min-width: 170px;
  padding: 0 10px 0 14px;
  border-radius: var(--r-pill);
  background: var(--field-bg);
  border: 1px solid var(--field-border);
  box-shadow: inset 0 1px 2px rgba(30, 30, 50, 0.06);
  color: #55585f;
  font-size: 14px;
}

.kbd {
  margin-left: auto;
  padding: 2px 6px;
  border: 1px solid var(--field-border);
  border-radius: 6px;
  background: #fff;
  font-size: 11px;
  color: var(--text-muted);
}

.spacer {
  flex: 1 1 auto;
}

/* Below 1100px the nav sheds its optional pieces before it wraps. */
@media (max-width: 1100px) {
  .search {
    min-width: 0;
  }
  .searchLabel {
    display: none;
  }
}

.content {
  position: relative;
  z-index: 1;
}
```

- [ ] **Step 2: Write the user menu stylesheet**

Create `apps/web/src/components/user-menu.module.css`:

```css
.wrap {
  position: relative;
  flex: none;
}

.avatar {
  display: grid;
  place-items: center;
  width: 36px;
  height: 36px;
  border: 0;
  border-radius: 50%;
  color: #fff;
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
}

@media (prefers-reduced-motion: no-preference) {
  .avatar {
    transition: transform 0.4s var(--ease);
  }
  .avatar:active {
    transform: scale(0.94);
  }
}

.popover {
  position: absolute;
  top: calc(100% + 10px);
  right: 0;
  width: 240px;
  padding: 8px;
  border-radius: 22px;
  background: var(--glass-bg-strong);
  backdrop-filter: var(--glass-blur);
  -webkit-backdrop-filter: var(--glass-blur);
  border: 1px solid var(--glass-border);
  box-shadow: var(--glass-highlight), 0 20px 50px rgba(30, 45, 40, 0.18);
  transform-origin: top right;
}

@media (prefers-reduced-motion: no-preference) {
  .popover {
    animation: g-pop 0.45s var(--ease);
  }
}

.identity {
  padding: 10px 12px 12px;
  border-bottom: 1px solid rgba(40, 40, 60, 0.08);
  margin-bottom: 6px;
}

.name {
  font-size: 14px;
  font-weight: 600;
}

.email {
  font-size: 12.5px;
  color: var(--text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.item {
  display: block;
  width: 100%;
  padding: 9px 12px;
  border: 0;
  border-radius: 14px;
  background: transparent;
  text-align: left;
  font-size: 14px;
  color: var(--text);
  cursor: pointer;
}

.item:hover {
  background: rgba(0, 0, 0, 0.05);
  text-decoration: none;
}

.danger {
  color: var(--danger);
}
```

- [ ] **Step 3: Write `UserMenu.tsx`**

Create `apps/web/src/components/UserMenu.tsx`:

```tsx
'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { colorFor } from '@/lib/color'
import type { SessionUser } from '@/lib/current-user'
import styles from './user-menu.module.css'

export function UserMenu({ user }: { user: SessionUser }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [pending, setPending] = useState(false)
  const wrap = useRef<HTMLDivElement>(null)

  // Close on an outside click or Escape. Without both, the popover strands the
  // person on any page with no obvious way back.
  useEffect(() => {
    if (!open) return
    function onPointerDown(event: PointerEvent) {
      if (!wrap.current?.contains(event.target as Node)) setOpen(false)
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  return (
    <div className={styles.wrap} ref={wrap}>
      <button
        type="button"
        className={styles.avatar}
        style={{ background: colorFor(user.id) }}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Account"
        onClick={() => setOpen((value) => !value)}
      >
        {user.name.slice(0, 1).toUpperCase()}
      </button>

      {open && (
        <div className={styles.popover} role="menu">
          <div className={styles.identity}>
            {/*
              current-user keeps its test id and its exact text: the e2e suite
              asserts the signed-in person's name here.
            */}
            <div className={styles.name} data-testid="current-user">
              {user.name}
            </div>
            <div className={styles.email}>{user.email}</div>
          </div>

          <Link className={styles.item} href="/" role="menuitem" onClick={() => setOpen(false)}>
            All workspaces
          </Link>

          <button
            type="button"
            className={`${styles.item} ${styles.danger}`}
            role="menuitem"
            data-testid="sign-out"
            disabled={pending}
            onClick={async () => {
              setPending(true)
              await fetch('/api/auth/logout', { method: 'POST' })
              // refresh() drops the server tree rendered for the old session
              // before navigating, so no signed-in data stays on screen.
              router.refresh()
              router.push('/login')
            }}
          >
            Sign out
          </button>
        </div>
      )}
    </div>
  )
}
```

**Note on `current-user`:** it now lives inside a popover, so it is not in the DOM until the menu is opened. Task 7 updates the one e2e test that asserts it to open the menu first.

- [ ] **Step 4: Rewrite `AppShell.tsx`**

```tsx
import Link from 'next/link'
import type { ReactNode } from 'react'
import type { SessionUser } from '@/lib/current-user'
import { UserMenu } from './UserMenu'
import { Button } from './ui/Button'
import styles from './app-shell.module.css'

export type NavDocument = { id: string; title: string; type: 'doc' | 'board' }

export function AppShell({
  user,
  workspace,
  children,
}: {
  user: SessionUser
  /** Omitted on the dashboard, where there is no workspace in context. */
  workspace?: { id: string; name: string }
  documents?: NavDocument[]
  activeDocumentId?: string
  children: ReactNode
}) {
  return (
    <div className={styles.shell}>
      <div className={styles.navWrap}>
        <nav className={styles.nav}>
          <Link href="/" aria-label="All workspaces">
            <span className={styles.logo} />
          </Link>

          {workspace && (
            <>
              <Link className={styles.workspaceName} href={`/workspaces/${workspace.id}`}>
                {workspace.name}
              </Link>
              <span className={styles.divider} />
            </>
          )}

          {/* Task 5 renders NavTabs here. */}
          <div className={styles.tabsSlot} />

          {/*
            Rendered to spec but inert until Plan 5 builds the palette. Marked
            aria-disabled so it does not advertise an action that does nothing.
          */}
          <div className={styles.search} aria-disabled="true" title="Coming soon">
            <span className={styles.searchLabel}>Search</span>
            <span className={styles.kbd}>⌘K</span>
          </div>

          {/* Plan 2 fills this with the status pill. */}

          <Button variant="accent" aria-disabled="true" title="Coming soon">
            Share
          </Button>

          <UserMenu user={user} />
        </nav>
      </div>

      <div className={styles.content}>{children}</div>
    </div>
  )
}
```

- [ ] **Step 5: Delete the old `SignOutButton` usage**

`SignOutButton.tsx` is now unused — its logic moved into `UserMenu`. Delete the file:

```bash
git rm apps/web/src/components/SignOutButton.tsx
```

If `pnpm typecheck` reports any remaining import of it, remove that import as part of this task.

- [ ] **Step 6: Pass `workspace` from the workspace page**

In `apps/web/src/app/workspaces/[id]/page.tsx`, change the `AppShell` call from passing `breadcrumb` to passing `workspace`:

```tsx
    <AppShell user={user} workspace={{ id, name: workspace.name }}>
```

Remove the now-unused `breadcrumb` prop and any `<span>{workspace.name}</span>` previously passed to it. The dashboard (`apps/web/src/app/page.tsx`) keeps `<AppShell user={user}>` with no workspace.

- [ ] **Step 7: Verify**

Run: `pnpm typecheck` — clean.
Run: `pnpm --filter @crdt/web exec playwright test` — Expected: the test asserting `current-user` FAILS, because that element now lives behind the user menu. Every other test passes. This is the expected consequence of Step 3; Task 7 fixes the test. Report exactly which tests fail.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/components apps/web/src/app/workspaces/\[id\]/page.tsx apps/web/src/app/page.tsx
git commit -m "feat(ui): rebuild the header as the sticky glass nav"
```

---

## Task 5: Document tabs and the sliding glass indicator

**Files:**
- Create: `apps/web/src/components/NavTabs.tsx`
- Create: `apps/web/src/components/nav-tabs.module.css`
- Modify: `apps/web/src/components/AppShell.tsx` (render `NavTabs` in the slot)
- Modify: `apps/web/src/app/workspaces/[id]/page.tsx`, `apps/web/src/app/documents/[id]/page.tsx` (pass documents)
- Test: `apps/web/e2e/glass-shell.spec.ts` (append)

**Interfaces:**
- Consumes: `NavDocument` from `AppShell` (Task 4).
- Produces: `NavTabs` — `({ workspaceId, documents, activeDocumentId }: { workspaceId: string; documents: NavDocument[]; activeDocumentId?: string }) => JSX.Element`. Client component. Each tab carries `data-testid="tab-<documentId>"`; Overview carries `data-testid="tab-overview"`.

The indicator is measured, not CSS-driven: its `transform` and `width` come from the active tab's `offsetLeft` and `offsetWidth`. It must be re-measured on route change, on resize, and when the strip scrolls.

- [ ] **Step 1: Write the stylesheet**

Create `apps/web/src/components/nav-tabs.module.css`:

```css
.strip {
  position: relative;
  display: flex;
  align-items: center;
  gap: 2px;
  flex: 1 1 auto;
  min-width: 120px;
  padding: 3px;
  overflow-x: auto;
  scrollbar-width: none;
  /*
    The edge fade is applied inline from measured overflow, not here. The
    prototype sets mask-image to `none` when the strip fits: an unconditional
    mask fades the right edge of a two-tab strip forever, which reads as a
    rendering fault rather than as "there is more".
  */
}

.strip::-webkit-scrollbar {
  display: none;
}

.tab {
  position: relative;
  z-index: 1;
  flex: none;
  display: inline-flex;
  align-items: center;
  gap: 7px;
  height: 32px;
  padding: 0 14px;
  border: 0;
  border-radius: var(--r-pill);
  background: transparent;
  font-size: 14px;
  font-weight: 500;
  color: var(--text-muted);
  cursor: pointer;
  white-space: nowrap;
}

.tab:hover {
  color: var(--text);
  text-decoration: none;
}

.tabActive {
  font-weight: 600;
  color: var(--text);
}

/*
  The liquid-glass pill that slides between tabs. Positioned and sized from
  JavaScript; everything visual lives here.
*/
.indicator {
  position: absolute;
  top: 3px;
  bottom: 3px;
  left: 0;
  border-radius: var(--r-pill);
  pointer-events: none;
  background:
    linear-gradient(
      180deg,
      rgba(255, 255, 255, 0.35) 0%,
      rgba(255, 255, 255, 0) 45%,
      rgba(255, 255, 255, 0) 70%,
      rgba(255, 255, 255, 0.25) 100%
    ),
    rgba(110, 110, 130, 0.07);
  backdrop-filter: blur(6px) saturate(240%) contrast(1.05);
  -webkit-backdrop-filter: blur(6px) saturate(240%) contrast(1.05);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.95),
    inset 0 -1px 0 rgba(255, 255, 255, 0.6),
    inset 1px 0 0 rgba(255, 255, 255, 0.45),
    inset -1px 0 0 rgba(255, 255, 255, 0.45),
    inset 0 0 0 1px rgba(80, 80, 100, 0.08),
    inset 0 2px 6px rgba(80, 80, 100, 0.08),
    inset 0 -3px 8px rgba(255, 255, 255, 0.35),
    0 1px 2px rgba(40, 40, 60, 0.06),
    0 4px 14px rgba(40, 40, 60, 0.06);
}

@media (prefers-reduced-motion: no-preference) {
  .indicator {
    transition:
      transform 0.55s var(--ease),
      width 0.55s var(--ease),
      opacity 0.3s var(--ease);
  }
}
```

- [ ] **Step 2: Write `NavTabs.tsx`**

```tsx
'use client'

import Link from 'next/link'
import { useLayoutEffect, useRef, useState } from 'react'
import type { NavDocument } from './AppShell'
import styles from './nav-tabs.module.css'

type Metrics = { x: number; w: number }

export function NavTabs({
  workspaceId,
  documents,
  activeDocumentId,
}: {
  workspaceId: string
  documents: NavDocument[]
  activeDocumentId?: string
}) {
  const strip = useRef<HTMLDivElement>(null)
  const [metrics, setMetrics] = useState<Metrics | null>(null)
  const [overflowing, setOverflowing] = useState(false)

  // useLayoutEffect, not useEffect: measuring after paint makes the indicator
  // visibly jump from 0 to its position on first render.
  useLayoutEffect(() => {
    const element = strip.current
    if (!element) return

    function measure() {
      const active = element!.querySelector<HTMLElement>(`[data-active="true"]`)
      if (!active) {
        setMetrics(null)
        return
      }
      setMetrics({ x: active.offsetLeft, w: active.offsetWidth })

      // Keep the active tab in view without scrollIntoView, which also scrolls
      // every ancestor and yanks the whole page sideways. Offsets and the
      // smooth behaviour are copied from the prototype.
      const left = active.offsetLeft
      const right = left + active.offsetWidth
      if (left < element!.scrollLeft) {
        element!.scrollTo({ left: left - 12, behavior: 'smooth' })
      } else if (right > element!.scrollLeft + element!.clientWidth) {
        element!.scrollTo({ left: right - element!.clientWidth + 24, behavior: 'smooth' })
      }

      // The strip only overflows at some widths, so the fade is state, not style.
      setOverflowing(element!.scrollWidth > element!.clientWidth + 2)
    }

    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    element.addEventListener('scroll', measure, { passive: true })
    return () => {
      observer.disconnect()
      element.removeEventListener('scroll', measure)
    }
  }, [activeDocumentId, documents])

  return (
    <div
      className={styles.strip}
      ref={strip}
      role="tablist"
      style={{
        maskImage: overflowing ? 'linear-gradient(90deg,#000 82%,transparent)' : 'none',
        WebkitMaskImage: overflowing ? 'linear-gradient(90deg,#000 82%,transparent)' : 'none',
      }}
    >
      <span
        className={styles.indicator}
        style={{
          transform: `translateX(${metrics?.x ?? 0}px)`,
          width: metrics?.w ?? 0,
          opacity: metrics ? 1 : 0,
        }}
      />

      <Link
        className={`${styles.tab} ${!activeDocumentId ? styles.tabActive : ''}`}
        href={`/workspaces/${workspaceId}`}
        data-active={!activeDocumentId}
        data-testid="tab-overview"
      >
        Overview
      </Link>

      {documents.map((document) => (
        <Link
          key={document.id}
          className={`${styles.tab} ${document.id === activeDocumentId ? styles.tabActive : ''}`}
          href={`/documents/${document.id}`}
          data-active={document.id === activeDocumentId}
          data-testid={`tab-${document.id}`}
        >
          {document.title}
        </Link>
      ))}
    </div>
  )
}
```

- [ ] **Step 3: Render it in the nav**

In `AppShell.tsx`, import `NavTabs` and replace the slot:

```tsx
          {workspace && documents ? (
            <NavTabs
              workspaceId={workspace.id}
              documents={documents}
              activeDocumentId={activeDocumentId}
            />
          ) : (
            <div className={styles.tabsSlot} />
          )}
```

Destructure `documents` and `activeDocumentId` from the props (they are already declared in the type).

- [ ] **Step 4: Pass documents from both pages**

In `apps/web/src/app/workspaces/[id]/page.tsx`, the page already selects the workspace's documents. Pass them:

```tsx
    <AppShell
      user={user}
      workspace={{ id, name: workspace.name }}
      documents={workspace.documents}
    >
```

In `apps/web/src/app/documents/[id]/page.tsx` the document page currently renders `DocumentClient` with no shell. Wrap it, fetching the sibling documents for the tab strip. Replace the final `return` with:

```tsx
  const siblings = await prisma.document.findMany({
    where: { workspaceId: document.workspace.id },
    select: { id: true, title: true, type: true },
    orderBy: { createdAt: 'asc' },
  })

  return (
    <AppShell
      user={user}
      workspace={document.workspace}
      documents={siblings}
      activeDocumentId={id}
    >
      <DocumentClient
        documentId={id}
        type={type}
        role={role}
        readOnly={role === 'viewer'}
        title={document.title}
        workspace={document.workspace}
        user={{ name: user.name, color: colorFor(user.id) }}
      />
    </AppShell>
  )
```

Add `import { AppShell } from '@/components/AppShell'` to that file. The authorization order is unchanged: `requireDocumentRole` still runs before any display query.

- [ ] **Step 5: Write the failing e2e test**

Append to `apps/web/e2e/glass-shell.spec.ts`:

```ts
import { cleanup, createDocument, seedWorkspace, signIn } from './fixtures.js'

const LABEL = 'e2e-glass'

test.afterAll(async () => {
  await cleanup(LABEL)
})

test('the nav shows a tab per document and marks the open one active', async ({ page }) => {
  const label = `${LABEL}-tabs`
  const { owner, workspace } = await seedWorkspace(label)
  const board = await createDocument(workspace.id, 'board')
  const doc = await createDocument(workspace.id, 'doc')
  await signIn(page, owner.id)

  await page.goto(`/documents/${board.id}`)

  await expect(page.getByTestId('tab-overview')).toBeVisible()
  await expect(page.getByTestId(`tab-${board.id}`)).toHaveAttribute('data-active', 'true')
  await expect(page.getByTestId(`tab-${doc.id}`)).toHaveAttribute('data-active', 'false')

  // The indicator is measured from the active tab, so a zero width means the
  // measurement never ran — the bug this test exists to catch.
  const width = await page.locator('[class*="indicator"]').evaluate((el) => el.getBoundingClientRect().width)
  expect(width).toBeGreaterThan(0)

  await cleanup(label)
})

test('switching documents moves the indicator', async ({ page }) => {
  const label = `${LABEL}-slide`
  const { owner, workspace } = await seedWorkspace(label)
  const first = await createDocument(workspace.id, 'board')
  const second = await createDocument(workspace.id, 'doc')
  await signIn(page, owner.id)

  await page.goto(`/documents/${first.id}`)
  const indicator = page.locator('[class*="indicator"]')
  const before = await indicator.evaluate((el) => el.getBoundingClientRect().x)

  await page.getByTestId(`tab-${second.id}`).click()
  await expect(page.getByTestId(`tab-${second.id}`)).toHaveAttribute('data-active', 'true')
  // The slide is 0.55s; wait for it to settle rather than racing it.
  await page.waitForTimeout(800)
  const after = await indicator.evaluate((el) => el.getBoundingClientRect().x)

  expect(after).not.toBe(before)

  await cleanup(label)
})
```

Run: `pnpm --filter @crdt/web exec playwright test glass-shell`
Expected: both new tests FAIL before Steps 2–4 are in place; PASS after.

- [ ] **Step 6: Prove the indicator test discriminates**

Temporarily change `setMetrics({ x: active.offsetLeft, w: active.offsetWidth })` to `setMetrics({ x: 0, w: 0 })`. Re-run. Expected: the width assertion FAILS. Restore with `git checkout --` and confirm it passes. Report both.

- [ ] **Step 7: Verify**

Run: `pnpm typecheck` — clean.
Run: `pnpm --filter @crdt/web exec playwright test` — everything except the known `current-user` failure from Task 4.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/components apps/web/src/app apps/web/e2e/glass-shell.spec.ts
git commit -m "feat(ui): add document tabs with a sliding glass indicator"
```

---

## Task 6: Sign-in, dashboard and workspace screens

**Files:**
- Modify: `apps/web/src/app/(auth)/layout.tsx`, `(auth)/auth.module.css`, `(auth)/login/page.tsx`
- Modify: `apps/web/src/app/page.tsx`, `apps/web/src/app/dashboard.module.css`, `apps/web/src/app/CreateWorkspaceForm.tsx`
- Modify: `apps/web/src/app/workspaces/[id]/page.tsx`, `workspace.module.css`, `CreateDocumentForm.tsx`, `MembersPanel.tsx`

**Interfaces:**
- Consumes: tokens (Task 1), primitives (Task 3), `AppShell` (Tasks 4–5).
- Produces: no new exported interfaces. Every existing `data-testid` keeps its meaning.

- [ ] **Step 1: Sign-in**

Replace `apps/web/src/app/(auth)/auth.module.css`:

```css
.shell {
  min-height: 100vh;
  display: grid;
  place-items: center;
  padding: 24px;
}

.card {
  width: 100%;
  max-width: 400px;
  display: grid;
  gap: 28px;
  padding: 44px 40px;
  border-radius: 28px;
  text-align: center;
  background: var(--glass-bg-sheet);
  backdrop-filter: var(--glass-blur);
  -webkit-backdrop-filter: var(--glass-blur);
  border: 1px solid var(--glass-border);
  box-shadow: var(--glass-highlight), 0 40px 90px rgba(30, 45, 40, 0.22);
}

@media (prefers-reduced-motion: no-preference) {
  .card {
    animation: g-sheet 0.6s var(--ease);
  }
}

.mark {
  width: 52px;
  height: 52px;
  margin: 0 auto;
  border-radius: 16px;
  background: var(--accent);
  box-shadow: 0 8px 24px var(--accent-shadow);
}

.heading {
  font-size: 30px;
}

.lede {
  color: var(--text-muted);
  font-size: 15px;
}

.providers {
  display: grid;
  gap: 10px;
}

.provider {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 50px;
  border-radius: var(--r-pill);
  font-size: 15px;
  font-weight: 500;
}

.providerAccent {
  background: var(--accent);
  color: #fff;
  box-shadow: 0 6px 20px var(--accent-shadow);
}

.providerAccent:hover {
  background: var(--accent-hover);
  text-decoration: none;
}

.providerGlass {
  background: var(--glass-bg-strong);
  border: 1px solid var(--field-border);
  color: var(--text);
}

.providerGlass:hover {
  background: #fff;
  text-decoration: none;
}

.alt {
  font-size: 13px;
  color: var(--text-muted);
}

.error {
  padding: 10px 14px;
  border: 1px solid rgba(196, 55, 43, 0.25);
  border-radius: var(--r-card);
  background: rgba(196, 55, 43, 0.06);
  color: var(--danger);
  font-size: 13px;
}
```

Replace `apps/web/src/app/(auth)/layout.tsx`:

```tsx
import type { ReactNode } from 'react'
import styles from './auth.module.css'

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main className={styles.shell}>
      <div className={styles.card}>
        <div className={styles.mark} aria-hidden="true" />
        {children}
      </div>
    </main>
  )
}
```

In `apps/web/src/app/(auth)/login/page.tsx`, keep every line of logic — `safeNext`, the `getCurrentUser` redirect outside any try/catch, `oauthErrorMessage`, the array-narrowing of `next` — and change only the markup:

```tsx
  return (
    <>
      <div>
        <h1 className={styles.heading}>Sign in</h1>
        <p className={styles.lede}>Sign in to your workspaces.</p>
      </div>
      {message && (
        <p className={styles.error} role="alert" data-testid="auth-error">
          {message}
        </p>
      )}
      {providers.length === 0 ? (
        <p className={styles.alt} data-testid="no-providers">
          No sign-in providers are configured.
        </p>
      ) : (
        <div className={styles.providers}>
          {providers.map((id) => (
            <a
              key={id}
              className={`${styles.provider} ${
                id === 'github' ? styles.providerAccent : styles.providerGlass
              }`}
              href={`/api/auth/oauth/${id}?next=${encodeURIComponent(destination)}`}
              data-testid={`signin-${id}`}
            >
              Continue with {PROVIDERS[id].label}
            </a>
          ))}
        </div>
      )}
      <p className={styles.alt}>New here? Signing in creates your account and a workspace of your own.</p>
    </>
  )
```

- [ ] **Step 2: Dashboard**

Replace `apps/web/src/app/dashboard.module.css`:

```css
.page {
  max-width: 960px;
  margin: 0 auto;
  padding: 40px 16px 64px;
  display: grid;
  gap: 24px;
}

@media (prefers-reduced-motion: no-preference) {
  .page {
    animation: g-in 0.7s var(--ease);
  }
}

.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
  gap: 16px;
}

.tile {
  display: flex;
  flex-direction: column;
  gap: 32px;
  color: var(--text);
}

.tile:hover {
  transform: translateY(-2px);
  box-shadow: var(--glass-highlight), 0 10px 28px rgba(30, 45, 40, 0.08);
  text-decoration: none;
}

.tile:active {
  transform: scale(0.98);
}

.initial {
  display: grid;
  place-items: center;
  width: 44px;
  height: 44px;
  border-radius: 14px;
  background: var(--accent);
  color: #fff;
  font-size: 18px;
  font-weight: 600;
}

.tileName {
  font-size: 18px;
  font-weight: 600;
}

.tileMeta {
  font-size: 13.5px;
  color: var(--text-muted);
}

.createTile {
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  gap: 12px;
  border: 1.5px dashed rgba(0, 0, 0, 0.12);
  border-radius: var(--r-tile);
  padding: 22px;
  background: transparent;
  box-shadow: none;
}
```

In `apps/web/src/app/page.tsx`, keep the membership-scoped Prisma query exactly as it is — a workspace the user does not belong to is never loaded — and replace the list markup with the tile grid. Each tile keeps `data-testid={`workspace-${workspace.id}`}` and must still contain the workspace name:

```tsx
      <div className={styles.page}>
        <h1>Workspaces</h1>
        <div className={styles.grid}>
          {memberships.map(({ role, workspace }) => (
            <Link
              key={workspace.id}
              href={`/workspaces/${workspace.id}`}
              className={`${ui.glass} ${ui.tile} ${styles.tile}`}
              data-testid={`workspace-${workspace.id}`}
            >
              <span className={styles.initial}>{workspace.name.slice(0, 1).toUpperCase()}</span>
              <span>
                <span className={styles.tileName}>{workspace.name}</span>
                <span className={styles.tileMeta}>
                  {' '}
                  · {workspace._count.documents}{' '}
                  {workspace._count.documents === 1 ? 'document' : 'documents'} · {role}
                </span>
              </span>
            </Link>
          ))}
          <CreateWorkspaceForm />
        </div>
      </div>
```

In `CreateWorkspaceForm.tsx`, keep the whole submit handler — the narrow try/catch around `fetch`, `setPending(false)` on both the error and success paths, `router.refresh()` — and change only the markup to the dashed create tile, with `TextField` using `hideLabel` and placeholder "Name it, then press Enter". Keep `data-testid="workspace-name"` on the input and `data-testid="create-workspace"` on the button.

- [ ] **Step 3: Workspace**

Replace `apps/web/src/app/workspaces/[id]/workspace.module.css` with a tile grid for documents, a glass People list, and the segmented create tile. Keep every class the `MembersPanel` already uses — `.memberRow`, `.memberEmail`, `.memberForm`, `.memberError`, `.itemName`, `.spacer`, `.form`, `.formField`, `.select` — so that component needs no structural change:

```css
.page {
  max-width: 1040px;
  margin: 0 auto;
  padding: 40px 16px 64px;
  display: grid;
  gap: 28px;
}

@media (prefers-reduced-motion: no-preference) {
  .page {
    animation: g-in 0.7s var(--ease);
  }
}

.meta {
  color: var(--text-muted);
  font-size: 14px;
}

.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(230px, 1fr));
  gap: 16px;
}

.docTile {
  display: flex;
  flex-direction: column;
  gap: 28px;
  color: var(--text);
}

.docTile:hover {
  transform: translateY(-2px);
  box-shadow: var(--glass-highlight), 0 10px 28px rgba(30, 45, 40, 0.08);
  text-decoration: none;
}

.docTitle {
  font-size: 16px;
  font-weight: 600;
}

.createTile {
  display: grid;
  gap: 12px;
  border: 1.5px dashed rgba(0, 0, 0, 0.12);
  border-radius: var(--r-tile);
  padding: 22px;
}

.form {
  display: grid;
  gap: 12px;
}

.formField {
  min-width: 0;
}

.select {
  height: 40px;
  padding: 0 14px;
  border-radius: var(--r-pill);
  background: var(--field-bg);
  border: 1px solid var(--field-border);
  font-size: 14px;
}

.memberRow {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 12px 0;
  border-bottom: 1px solid rgba(40, 40, 60, 0.07);
}

.memberRow:last-child {
  border-bottom: none;
}

.itemName {
  font-weight: 500;
}

.memberEmail {
  color: var(--text-muted);
  font-size: 13px;
}

.spacer {
  flex: 1;
}

.memberForm {
  margin-top: 16px;
}

.memberError {
  margin-top: 12px;
}
```

In `page.tsx`, keep the authorization sequence untouched — `getCurrentUser`, `redirect` outside the try, `requireWorkspaceRole` in the try with 404-before-403, `notFound()` on `HttpError` 404 — and change only the rendering: an `<h1>` of the workspace name, a meta line `{n} documents · {m} people`, the document tiles with a `Board` / `Page` chip, and the People panel. Keep `data-testid={`document-${document.id}`}` on each tile.

In `CreateDocumentForm.tsx`, keep the whole submit handler and swap the `<select>` for the segmented control from `ui.module.css`, backed by a hidden input so the form data shape is unchanged. Keep `data-testid="document-title"`, `data-testid="document-type"` and `data-testid="create-document"`. **`document-type` must remain an element Playwright can `selectOption` on** — keep the real `<select>` in the DOM and style it, rather than replacing it with buttons.

- [ ] **Step 4: Verify**

Run: `pnpm typecheck` — clean.
Run: `pnpm --filter @crdt/web build` — completes.
Run: `pnpm --filter @crdt/web exec playwright test` — everything except the known `current-user` failure. Report any other failure; it is a real regression.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app
git commit -m "feat(ui): restyle sign-in, dashboard and workspace in Glass"
```

---

## Task 7: Reconcile the e2e suite and verify the whole plan

**Files:**
- Modify: `apps/web/e2e/auth-flow.spec.ts` (the `current-user` assertion)
- Modify: `docs/design/glass-handoff.md` (append a short status note)

**Interfaces:**
- Consumes: everything above.
- Produces: nothing importable.

- [ ] **Step 1: Fix the one legitimately-changed test**

`current-user` now lives inside the user menu popover. In `apps/web/e2e/auth-flow.spec.ts`, in the test `'the dashboard lists the workspaces you belong to and can create another'`, open the menu before asserting, and open it again before signing out:

```ts
  await page.goto('/')
  // The signed-in identity moved into the account menu in the Glass nav.
  await page.getByLabel('Account').click()
  await expect(page.getByTestId('current-user')).toHaveText('Owner')
  await page.keyboard.press('Escape')
  await expect(page.getByTestId(`workspace-${workspace.id}`)).toContainText(label)
```

and later in the same test:

```ts
  await page.getByLabel('Account').click()
  await page.getByTestId('sign-out').click()
  await expect(page).toHaveURL('/login')
```

Change nothing else about that test. Its assertions are still the same assertions.

- [ ] **Step 2: Confirm no other test needed changing**

Run: `pnpm --filter @crdt/web exec playwright test`
Expected: **all pass.** If any other test needed editing to go green, stop and report it — that means behaviour changed, and this plan is supposed to be visual only.

- [ ] **Step 3: Full verification**

- `pnpm test` — all Vitest tests pass. Report the count.
- `pnpm typecheck` — clean.
- `pnpm --filter @crdt/web build` — completes; the route list is unchanged from before this plan.
- `pnpm --filter @crdt/web exec playwright test` — all pass, started cold with nothing on ports 3000 or 1234.

Do not commit `apps/web/next-env.d.ts` if the build rewrote it.

- [ ] **Step 4: Record what is built and what is not**

Append to `docs/design/glass-handoff.md`:

```markdown
---

## Implementation status

Plan 1 (`docs/superpowers/plans/2026-10-01-glass-foundation-and-shell.md`) built the
tokens, the painted canvas, the glass primitives, the sticky nav with document
tabs, and the sign-in, dashboard and workspace screens.

Still to come, each in its own plan:

- **Status pill, status popover, offline and syncing pills, toasts, presence
  avatars in the nav, the tab "others are here" dot** — needs the sync server to
  expose a version sequence and a latency ping.
- **History button, history panel, version preview bar** — needs a snapshot list
  and fetch API, and authorship on updates.
- **Board restyle, card sheet, card peer rings** — needs `description` and an
  activity log on the card's `Y.Map`.
- **⌘K palette and share sheet** — the nav's search field and Share button are
  rendered but intentionally inert until then.
```

- [ ] **Step 5: Commit**

```bash
git add apps/web/e2e/auth-flow.spec.ts docs/design/glass-handoff.md
git commit -m "test: reconcile e2e with the Glass nav; record implementation status"
```

---

## Self-Review

**1. Spec coverage.** Of the spec's screens, this plan covers tokens, the painted canvas, the glass recipe, the sticky nav, the sliding tab indicator, sign-in, dashboard and workspace. Deliberately deferred, each listed in "What this plan does NOT build" with its owning plan: status pill and popover, offline/syncing pills, toasts, nav presence avatars, the tab presence dot, history panel and preview bar, board and card sheet, ⌘K palette, share sheet. The spec's browser notes (paired `-webkit-backdrop-filter`, the `@supports` fallback) are in Task 1; reduced-motion gating is in Tasks 1, 2, 3, 4 and 5.

**2. Placeholder scan.** No "TBD", no "add error handling", no "similar to Task N". Task 6 describes two components (`CreateWorkspaceForm`, `CreateDocumentForm`, `MembersPanel`) by what to keep and what to change rather than quoting them whole, because the instruction there is *preserve this logic exactly* — quoting the handlers would invite retyping and introduce drift. Every new file is given in full.

**3. Type consistency.**
- `NavDocument` is defined and exported in `AppShell.tsx` (Task 4) and imported by `NavTabs.tsx` (Task 5). It matches the shape of the existing `workspace.documents` Prisma selection: `{ id, title, type }`.
- `AppShell`'s props are declared once in Task 4 — `user`, `workspace?`, `documents?`, `activeDocumentId?`, `children` — and Task 5 consumes exactly those names.
- `Button`'s variants change from `primary|secondary|danger` to `accent|glass|ghost|danger`. Task 3 Step 5 explicitly fixes every call site the typecheck surfaces; `UserMenu` (Task 4) and the login page (Task 6) use only the new names.
- `TextField` gains `hideLabel?: boolean`; used in Task 6, declared in Task 3.
- `SignOutButton` is deleted in Task 4 and nothing after it refers to the file; `data-testid="sign-out"` moves to `UserMenu`.

**4. Known, intended test breakage.** Task 4 knowingly breaks one assertion (`current-user` moving into a popover) and Task 7 fixes it. That is called out in Task 4 Step 7 so an executor does not treat it as a surprise, and Task 7 Step 2 states that *any other* failing test means a real regression.
