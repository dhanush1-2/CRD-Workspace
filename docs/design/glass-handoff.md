# Handoff: CRDT Workspace, "Glass" redesign (Direction D)

## Overview
A full visual redesign of `apps/web` covering sign-in, dashboard, workspace, Kanban board, rich-text document, viewer (read-only) state and offline / reconnecting state. It adds a sticky glass top nav with document tabs, a ⌘K search palette, presence avatars, a status popover, a version-history panel, a card detail sheet and a share / invite sheet.

Look: a soft neutral "painted canvas" background, frosted liquid-glass surfaces, one indigo-violet accent and the system font. Motion is a smooth Apple-style ease.

## About the design files
`Workspace D - Glass.dc.html` is an **HTML design reference**: a working prototype with mocked data, not production code. Recreate it in the existing stack: Next.js App Router, React, CSS Modules plus `globals.css` custom properties, and Yjs / y-websocket / y-prosemirror. Follow the repo's patterns (server components for data, `'use client'` islands, `components/ui/*`).

To view it, open the file in a browser with `support.js` beside it. Tweak props: `canvas` (`neutral|dusk|ocean|meadow|sunset|stone`), `role` (`owner|editor|viewer`), `startScreen` (`login|dashboard|workspace|board|doc`) and `peers`.

## Fidelity
High fidelity. Match the colors, radii, blur values and easing exactly.

## Codebase mapping
| Design | Files |
|---|---|
| Tokens, fonts, body background, keyframes | `app/globals.css`, `app/layout.tsx` |
| Painted canvas background | new `components/CanvasBackground.tsx` (+ `.module.css`), mounted once in `layout.tsx` |
| Sticky glass nav (replaces the sidebar) | `components/AppShell.tsx`, `app-shell.module.css` |
| Doc tabs + sliding glass indicator | new `components/NavTabs.tsx` (client) |
| ⌘K palette | new `components/CommandPalette.tsx` (client) |
| Status pill + popover | new `components/SyncStatus.tsx` (client; reads provider status) |
| Buttons / inputs / sheets | `components/ui/*` |
| Sign-in | `app/(auth)/login/page.tsx`, signup |
| Dashboard | dashboard route + CSS |
| Workspace | `app/workspaces/[id]/page.tsx`, `workspace.module.css`, `CreateDocumentForm.tsx`, `MembersPanel.tsx` |
| Board + card sheet | `components/Board.tsx` (+ new `CardSheet.tsx`) |
| Document | `app/documents/[id]/DocumentClient.tsx` + editor |
| History panel | new `HistoryPanel.tsx` + snapshot API route |
| Share sheet | new `ShareSheet.tsx`, wired to the existing members actions |

## Design tokens (put these in `:root`)
```css
/* surfaces */
--canvas-base: #f1f1ef;
--text: #1c1d1b; --text-2: #3d403b; --text-muted: #5f625d; --text-faint: #6c6f6a; --icon-faint: #a3a6a0;
--danger: #c4372b;

/* accent: indigo-violet */
--accent: oklch(0.42 0.11 285);
--accent-hover: oklch(0.37 0.11 285);
--accent-text: oklch(0.38 0.1 285);
--accent-tint: oklch(0.95 0.02 285);
--accent-shadow: oklch(0.42 0.11 285 / .22);
--accent-ring: oklch(0.42 0.11 285 / .1);

/* status */
--ok: oklch(0.62 0.13 150); --warn: oklch(0.72 0.15 65); --sync: oklch(0.42 0.11 285);

/* glass */
--glass-bg: rgba(255,255,255,.55);
--glass-bg-strong: rgba(255,255,255,.72);
--glass-bg-sheet: rgba(255,255,255,.82);
--glass-border: rgba(255,255,255,.85);
--glass-blur: blur(28px) saturate(190%);
--glass-highlight: inset 0 1px 0 rgba(255,255,255,.95);
--field-bg: rgba(240,240,244,.9);
--field-border: rgba(40,40,60,.12);

/* motion */
--ease: cubic-bezier(.32,.72,0,1);   /* used everywhere */
--dur-fast: .3s; --dur: .55s; --dur-slow: .7s;

/* radii */
--r-pill: 999px; --r-card: 18px; --r-tile: 24px; --r-column: 26px; --r-sheet: 30px; --r-panel: 28px;
```
User colors (unchanged, from `lib/color.ts`): `#e11d48 #0ea5e9 #16a34a #f59e0b #8b5cf6 #14b8a6`.

Font: `-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", system-ui, sans-serif`. Base size **16px** (raised from 15 by the owner on 2026-10-04), line-height 1.47,
letter-spacing −0.01em, antialiased. Only text without a size of its own inherits it:
the nav, tabs, meta lines and chips all set their own and were deliberately left.
- Page H1: 32px / 600 / −0.025em
- Section H2: 21px / 600 / −0.02em
- Card title: 18px / 600
- Body: 16px; small text 13–13.5px

## Painted canvas background
A fixed, full-viewport layer (`pointer-events:none; z-index:0`) behind everything, with bg `var(--canvas-base)`:
- **5 blobs.** Each is `position:absolute; filter: blur(90px); opacity:.55`, with an organic border-radius `42% 58% 63% 37% / 41% 44% 56% 59%` and the animation `g-paint {52|60|68|76|84}s ease-in-out infinite` (alternate blobs reversed).
  - Sizes and positions: 620×520 at left −140 / top −160; 520×460 at right −120 / top −60; 480×420 at right 18% / bottom −180; 520×440 at left 12% / bottom −200; 360×320 at left 44% / top 22%.
  - Neutral palette, in blob order: `oklch(0.86 0.012 260)`, `oklch(0.9 0.015 80)`, `oklch(0.83 0.01 240)`, `oklch(0.92 0.012 60)`, `oklch(0.88 0.008 200)`.
- **Canvas weave overlay**, with `mix-blend-mode:multiply`:
  `repeating-linear-gradient(0deg,rgba(60,50,30,.018) 0 1px,transparent 1px 3px), repeating-linear-gradient(90deg,rgba(60,50,30,.015) 0 1px,transparent 1px 4px)`
- **Keyframes:**
```css
@keyframes g-paint{
  0%,100%{transform:translate(0,0) rotate(0) scale(1);border-radius:42% 58% 63% 37%/41% 44% 56% 59%}
  33%{transform:translate(50px,-30px) rotate(12deg) scale(1.08);border-radius:63% 37% 44% 56%/55% 62% 38% 45%}
  66%{transform:translate(-30px,40px) rotate(-8deg) scale(.95);border-radius:38% 62% 56% 44%/48% 36% 64% 52%}}
```
- Respect `prefers-reduced-motion`: pause the blob animation.
- Other palettes (optional theme setting) are listed in `CANVAS` in the prototype logic.

## Glass recipe (shared)
```css
background: var(--glass-bg);
backdrop-filter: var(--glass-blur); -webkit-backdrop-filter: var(--glass-blur);
border: 1px solid var(--glass-border);
box-shadow: var(--glass-highlight), 0 10px 30px rgba(30,45,40,.08);
```
Use it for the nav, workspace / doc tiles, board columns, the document page, the history panel, popovers, the palette, sheets and toasts (toasts use a dark variant: `rgba(28,29,27,.82)` + `blur(24px)`).

## Layout
- The page itself scrolls (`height:100vh; overflow:auto`). There is **no sidebar**.
- **Sticky nav wrapper:** `position:sticky; top:0; z-index:30; padding:12px 16px 0`,
  plus `display:flex; flex-direction:column; align-items:center` so the bar and the
  floating pills beneath it are all centred.
- **Nav bar:** 56px high, pill radius, padding `0 8px 0 10px`, 10px gap, and
  `width:fit-content; max-width:100%` so it is a pill in the middle of the page rather
  than an edge-to-edge strip. Its width animates (`transition: width .55s var(--ease)`)
  and needs `interpolate-size: allow-keywords` on `:root` to interpolate against
  `fit-content`.
  - Background `rgba(255,255,255,.72)` + glass blur, border `1px solid rgba(40,40,60,.1)`.
  - Shadow `inset 0 1px 0 #fff, 0 12px 32px rgba(30,30,50,.12), 0 2px 6px rgba(30,30,50,.08)`.
  - Entrance animation: `g-pop .6s var(--ease)`.
- **Nav contents, left to right:**
  1. **Logo button:** a 36px accent circle (`aria-label="All workspaces"`). It goes to the dashboard. Hover: `rotate(-8deg) scale(1.05)`. Active: `scale(.92)`.
  2. **Workspace name button** (600 weight), which goes to the workspace overview, then a 1×22px divider.
  3. **Tabs strip:** Overview plus one tab per document. `flex:0 1 auto; min-width:120px; overflow-x:auto; scrollbar-width:none; padding:3px`. When it overflows, add a right-edge fade mask: `mask-image: linear-gradient(90deg,#000 82%,transparent)`.
     - Each tab is 32px high with `0 14px` padding and pill shape, 14px text. Active tab: 600 weight, `oklch(0.36 0.11 285)`. Inactive: 500 weight, `--text-muted`. A green 6px dot shows when others are in that document.
  4. **Search field:** 36px high, min-width 170px (no min-width below 1100px, where the label hides and only ⌘K shows).
     - Fill `--field-bg`, border `--field-border`, `inset 0 1px 2px rgba(30,30,50,.06)`, text `#55585f`.
     - ⌘K key chip: white, 1px border, 6px radius.
     - Hover: white fill and a darker border. Opens the palette.
  5. **On documents:**
     - Presence avatars: 28px, overlapping at −7px, white 2px ring; hover `translateY(-3px) scale(1.06)`; hidden below 1100px.
     - History button: field style; white when open.
  6. **Status pill:** field style, 8px dot plus label (`3 here` / `Synced` / `Offline` / `Syncing`). The label hides below 1100px. Clicking opens the status popover.
  7. **Share:** accent pill button, 36px high, padding 0 18px.
  8. **Avatar:** 36px, opens a user menu (name / email, All workspaces, Sign out in danger color).
- **Under the nav:** centered floating pills for the offline band and the version-preview bar (see below).

### Sliding tab indicator (liquid glass)
An absolutely positioned pill inside the tabs strip (top/bottom 3px). Its `transform:translateX(x)` and `width:w` are measured from the active tab's `offsetLeft` / `offsetWidth`. Transition: `transform .55s var(--ease), width .55s var(--ease), opacity .3s`. On the dashboard (no active tab) it goes to opacity 0.
```css
background: linear-gradient(180deg,rgba(255,255,255,.55) 0%,rgba(255,255,255,.08) 50%,rgba(255,255,255,.3) 100%), oklch(0.42 0.11 285 / .14);
backdrop-filter: blur(8px) saturate(220%);
border: 1px solid oklch(0.42 0.11 285 / .28);
box-shadow: inset 0 1px 0 rgba(255,255,255,.95), inset 0 -2px 6px rgba(255,255,255,.4),
  inset 0 2px 5px oklch(0.42 0.11 285 / .12), 0 2px 6px oklch(0.42 0.11 285 / .16), 0 6px 16px oklch(0.42 0.11 285 / .12);
pointer-events:none;
```
Re-measure on route change, resize and tab-strip scroll (`ResizeObserver` is ideal). Keep the active tab visible by setting `scrollLeft`; don't use `scrollIntoView`.

## Screens
Every screen root enters with `g-in .7s var(--ease)` (fade + 14px rise + 6px blur → none).

**Sign-in.** A centered glass card: max-width 400, padding 44/40, radius 28, gap 28, text centered, entrance `g-sheet`.
- A 52px accent rounded square as the mark.
- H1 "Sign in" (30px) and "Sign in to your workspaces."
- Two 50px pill buttons: GitHub (accent) and Google (glass white).
- Footnote 13px: "New here? Signing in creates your account and a workspace of your own."

**Dashboard.** Max-width 960, padding `40px 16px 64px`. H1 "Workspaces".
- Grid `repeat(auto-fill,minmax(250px,1fr))`, 16px gap.
- Tile: glass, radius 24, padding 22, 32px gap. It holds a 44px accent initial square (radius 14), the name (18/600) and "N documents · N people".
- Tile hover: `translateY(-2px)` + `0 10px 28px rgba(30,45,40,.08)`. Active: `scale(.98)`.
- The last tile is the create tile: `1.5px dashed rgba(40,40,60,.22)`, background `rgba(255,255,255,.7)` with `blur(20px) saturate(180%)`, shadow `inset 0 1px 0 rgba(255,255,255,.9), 0 4px 16px rgba(30,45,40,.06)`. Its pill input is `#fff` with `1px solid rgba(40,40,60,.14)` and the placeholder "Name it, then press Enter".
- Tile text column (name and meta): `gap:4px; width:100%; min-width:0`, children `display:block`. Name `line-height:1.3; text-wrap:pretty`; meta `line-height:1.35`.

**Workspace.** H1 = workspace name, then `N documents · N people` on its own frosted pill: `align-self:flex-start; padding:5px 14px`, pill radius, `rgba(255,255,255,.75)` with `blur(16px) saturate(180%)`, `1px solid rgba(255,255,255,.9)`, `0 2px 8px rgba(30,45,40,.06)`; text `--text-2`, 14px, 500. Any small text sitting directly on the painted background gets this pill; large headings stay bare.
- **Documents:** tiles (minmax 230) with a kind chip (`Board` / `Page`: accent-tint bg, accent-text, pill) and the title plus "updated" line.
- **Create tile** (editors only):
  - Same create-tile surface as the dashboard (dashed border, `.7` frosted fill); pill input `#fff` with `1px solid rgba(40,40,60,.14)`.
  - Page/Board segmented control: track `rgba(40,40,60,.08)`; the selected segment is white with `0 1px 3px rgba(30,45,40,.14)`.
  - Create button (accent).
  - Enter submits.
- **People:** a glass list (radius 22) with rows of a 34px avatar, name, email and role ("Owner / Can edit / Can view"). The header link "Manage" (owner) or "See who has access" opens Share.

**Board.** A horizontal scroller with **44px** top padding and 16px gutters, centred
with `width:fit-content; max-width:100%; margin:0 auto` so the columns sit in the
middle when they fit and still scroll when they do not.
- **Column:** 290px wide, radius 26, glass `rgba(255,255,255,.42)`; drag-over bg `rgba(255,255,255,.75)` + `inset 0 0 0 2px var(--accent)`. Header: title 15/600 and a count chip (22px pill, `rgba(0,0,0,.05)`).
- **Card:**
  - Base: `rgba(255,255,255,.92)`, radius 18, padding 14/16, title 14.5px. Shadow `0 0 0 1px #fff, 0 2px 8px rgba(30,45,40,.06)`.
  - Hover: `translateY(-3px) scale(1.01)` + `0 14px 30px rgba(30,45,40,.12)`. Active: `scale(.98)`. Entrance: `g-in .5s`.
  - Being dragged: opacity .4.
  - Selected: `0 0 0 2px var(--accent)`.
  - A remote peer on the card: `0 0 0 2px #0ea5e9, 0 4px 14px rgba(14,165,233,.18)` plus a peer chip (avatar + name, `rgba(14,165,233,.1)`, text `#0b6e99`).
  - "Has notes" meta when there is a description. A delete × (24px circle) for editors.
- **"+ Add a card":** a ghost pill — fill `rgba(255,255,255,.55)`, `inset 0 0 0 1px rgba(40,40,60,.08)`, text `#3d403b` (= `--text-2`) at weight 500, hover fill `rgba(255,255,255,.9)`.
- **"+ Add a list":** a 230×54 dashed pill — `1.5px dashed rgba(40,40,60,.22)`, fill `rgba(255,255,255,.7)` with `blur(20px) saturate(180%)`, shadow `inset 0 1px 0 rgba(255,255,255,.9), 0 4px 16px rgba(30,45,40,.06)`, text `#3d403b` at weight 500, hover fill `rgba(255,255,255,.92)`, pressed `scale(.97)`.

**Card sheet.** A fixed overlay `rgba(30,40,35,.16)` + `blur(8px)`, `g-fade .35s`.
- Sheet: max-width 580, radius 30, `--glass-bg-sheet`, shadow `0 40px 90px rgba(30,45,40,.22)`, entrance `g-sheet .6s`.
- **Top row:** column select (pill, `rgba(0,0,0,.05)`), "Grace is here too" with a pulsing dot, and a close button (30px circle).
- **Body:**
  - Title textarea, 26/600.
  - Notes textarea: radius 20, white glass. On focus: white fill + `0 0 0 1px accent, 0 0 0 5px var(--accent-ring)`.
  - Activity list: 24px avatars and "**Who** what", with the time on the right.
- **Footer:** "Delete card" (danger text) and "Done" (accent pill).
- Esc or a backdrop click closes it. Viewers get read-only fields.

**Document.** Max-width 780, centered.
- The page is a glass sheet: radius 30, padding 56/56/96, `rgba(255,255,255,.78)`.
- Text: H1 32/600; H2 21/600; paragraphs **18px** (raised from 17 with the base),
  line-height 1.65, color `--text-2`; caret color accent. At the 668px measure that is
  about 71–75 characters a line, down from 75–80.
- Remote cursor: a 2px bar in the peer color, with the label in a pill above it (11px / 500, `0 4px 10px` shadow). It moves with `left/top .7s var(--ease)`.

**History.** A fixed panel at `top:84px; right:16px; bottom:16px`, 330px wide, radius 28, glass, entrance `g-side .6s` (slides in from 28px right).
- Header "History" (18/600) + close.
- Range slider (accent color) with "Earliest … Now" labels.
- List, newest first. Each row: a 32px author avatar, the description and "Author · time". Row radius 18; the selected row is `rgba(255,255,255,.85)`.

**Version preview.** A dark floating pill under the nav: `rgba(28,29,27,.82)` + blur, white text "Ada · Sep 27, 14:20" (ellipsis), "Restore" (white pill, editors only) and "Back to now" (white 16% pill). Keep `max-width:100%; min-width:0`. While preview is active the content is read-only.

**Offline / syncing.** A glass floating pill under the nav containing a status dot (the syncing dot pulses), the message, and a "Reconnect" dark pill when offline.
- Offline copy: "You're offline. Keep working, your changes are saved on this device." With queued changes: "You're offline. N changes saved on this device will sync when you're back."
- Syncing copy: "Back online. Syncing your changes…"
- When it finishes, toast "Back online · N changes synced".

**Status popover.** 270px, radius 22, glass strong, origin top-right, `g-pop .45s`. Title ("Everything is up to date" / "Working offline" / "Catching up"), then a grid: People here, Response time, Waiting to sync, Version. Plus a "Go offline (simulate)" / "Reconnect now" button (dev only).

**Share sheet.** Same overlay and sheet style, max-width 510.
- Title: Share "{workspace}".
- Owner-only invite field: a pill container holding a borderless email input, a role select (Can view / Can edit / Owner) and an "Add" accent pill.
- Errors (danger, 13px): "We couldn't find {email}. Ask them to sign in once, then try again." / "{email} already has access."
- Member rows: 36px avatar, name, email, and a role select for the owner (others see text).
- Footnote: "People need to have signed in once before you can add them. Role changes apply the next time they connect."
- Toasts: "{name} added", "{name} can edit now".

**⌘K palette.** Overlay `rgba(30,40,35,.1)`, sheet at top 110px, max-width 580, radius 28, blur 36px.
- 60px input "Search documents and actions".
- Items are 46px pills; the selected one is accent bg with white text. Arrow keys move the selection, Enter runs it, Esc closes.
- Items: the workspace's documents, Overview, All workspaces, Share, Go offline / Reconnect.

**Viewer.** A "View only" pill next to the tabs. No create, add, delete, drag or restore. Read-only fields; the editor is not contentEditable.

**Toasts.** Dark glass pill, bottom-center 28px, 8px lavender dot (`oklch(0.78 0.12 300)`), `g-up .55s`, auto-hide after 3.2s.

## Keyframes
```css
@keyframes g-in{from{opacity:0;transform:translateY(14px);filter:blur(6px)}to{opacity:1;transform:none;filter:none}}
@keyframes g-pop{from{opacity:0;transform:translateY(-6px) scale(.96);filter:blur(4px)}to{opacity:1;transform:none;filter:none}}
@keyframes g-sheet{from{opacity:0;transform:translateY(24px) scale(.97)}to{opacity:1;transform:none}}
@keyframes g-side{from{opacity:0;transform:translateX(28px)}to{opacity:1;transform:none}}
@keyframes g-fade{from{opacity:0}to{opacity:1}}
@keyframes g-up{from{opacity:0;transform:translate(-50%,16px) scale(.96)}to{opacity:1;transform:translate(-50%,0)}}
@keyframes g-pulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.4;transform:scale(.8)}}
```
Buttons generally use `transition: transform .4s var(--ease), background .3s` and press with `:active{transform:scale(.95–.97)}`. Wrap all motion in `@media (prefers-reduced-motion: no-preference)`.

## State & data (production wiring)
- **Connection:** y-websocket `status` events (`connected` / `disconnected` / `connecting`) map to Synced / Offline / Syncing.
- **Queued count:** local `doc.on('update')` while disconnected; reset on `sync`.
- **Presence:** `provider.awareness`. Extend it with `{ user:{name,color}, cardId?, mode }` to drive avatars, card peer rings and the tab dot.
- **Version:** the server update sequence. **History:** a new API returning snapshot list + state; preview by applying a snapshot to a throwaway `Y.Doc`. Restore writes a **new** update.
- **Roles:** come from the session / JWT. The UI hides affordances; the sync server still enforces them.
- **⌘K:** a global `keydown` listener (Meta / Ctrl + K) in a client component.

## Browser notes
- Always pair `backdrop-filter` with `-webkit-backdrop-filter`.
- Provide a fallback for browsers without backdrop-filter: raise glass opacity to `.92` via `@supports not (backdrop-filter: blur(1px))`.

## Files
- `Workspace D - Glass.dc.html`: interactive prototype (source of truth)
- `support.js`: runtime needed to open it

---

## Implementation status

Six plans are complete:
`2026-10-01-glass-foundation-and-shell.md`, `2026-10-02-board-and-cards.md`,
`2026-10-02-paint-splatter.md`,
`2026-10-02-command-palette-and-share-sheet.md`,
`2026-10-02-document-page-and-nav-consolidation.md` and
`2026-10-02-glass-visual-corrections.md` (all under `docs/superpowers/plans/`).

**None of them changed the schema, the sync server, or any API route.** The first
three were visual only. The palette and share sheet plan added real behaviour —
two overlays, keyboard shortcuts, toasts, and moving invite and role editing out
of the People panel — but still reached for no new endpoint: it reuses the
existing members route, which already upserts, so a role change needs no new
backend. The document page and nav consolidation plan (below) likewise changed no
schema, route or sync-server code.

**Where this file and the prototype disagree, this file wins.**
`docs/design/glass-prototype.html` is stale. It still uses the old `--text-faint`
value `#7b7e78` throughout and predates the owner's other deltas below. Do not
treat it as the visual authority where this handoff is silent without checking
with the owner.

### Built

Design tokens and keyframes, the painted canvas background, the glass UI
primitives, the sticky glass nav, document tabs with a measured sliding
indicator, and the sign-in, dashboard and workspace screens. Plus the owner's
post-handoff deltas: tab indicator, create tiles, tile text, the faint-text
token and the background pill.

**Board restyle and card peer ring** (board plan). Glass columns, cards, delete
buttons, and the "+ Add a card" and "+ Add a list" controls, with the owner's
add-button values verified character by character against the stylesheet (no
drift). A remote peer on a card gets a ring and a named chip. Two small polish
fixes from the owner's audit:

- The GitHub sign-in button no longer darkens on hover; it lifts 1px
  (`translateY(-1px)`, inside the `prefers-reduced-motion: no-preference` block)
  with the fill unchanged. The Google button lifts the same way and keeps its
  existing fill brightening. A pressed button wins over the lift, so it still
  presses in under the pointer.
- Buttons press in over `0.4s`, as designed, not `0.3s`. `.button`, `.tile`,
  the sign-in provider buttons and the board add controls now all use the same
  duration. There is no `0.4s` token (`--dur` is `0.55s`, `--dur-fast` is
  `0.3s`), so it is a literal `0.4s`, matching the existing uses in
  `ui.module.css`.

**Test coverage note.** Card drag-and-drop had no test coverage before the board
plan. It now has three committed Playwright tests in `e2e/board.spec.ts`: a card
moves across columns, a card dropped on a sibling reorders within its column,
and a card is not left dimmed after a completed drop.

**Visual corrections** (`2026-10-02-glass-visual-corrections.md`), from the owner's
screenshot review:

- **Splats resized and the rays re-tapered.** Values and re-measured memory are in
  the Paint splatter section above; the taper was a real defect, not just a size.
- **Nav exclusion zone**, also in that section. Measured before the fix: 7,874 opaque
  pixels inside the top 90px. After: zero, with paint still present below — the half
  of the test that stops a canvas which never drew from passing.
- **Document page gap and title.** `.page` carries `margin: 28px auto 64px`; the
  board needed nothing, because it is not wrapped in `.page` and its scroller already
  has 28px of top padding, and the dashboard and workspace pages already had the
  review's 40px. The title is the **same** `<h1>` that was screen-reader-only, moved
  from `page.tsx` into `DocumentClient` so it sits inside `.page`, and styled by
  document type: visible on a document, still clipped on a board, where the design has
  no title slot but the page still needs an accessible name. `data-testid`
  `document-heading`; the sheet itself is `document-page`. Size, weight and
  letter-spacing come from the global `h1` rule, which already carries 32px / 600 /
  −0.025em — only the bottom margin, line-height and wrapping are local.
- **Tile and People-card glass raised to .7.** The `.55` the owner saw was never on
  `.tile`, which sets only radius and padding: it came from `--glass-bg` through
  `ui.glass`. **`--glass-bg` is deliberately unchanged at .55**, because the nav, the
  sign-in card, the sheets and the popovers all read it and none of them was asked to
  change; a test asserts the token's value for exactly that reason. The three surfaces
  named in the review carry their own fill instead: `.tile` (dashboard), `.docTile` and
  `.people` (workspace). The selectors are doubled (`.tile.tile`) to beat `ui.glass`
  deterministically — measured, a single class does win today, but the import graph
  decides that order and moving a route file is enough to change it. Contrast over the
  composited result: `--text-faint` 4.827 → 4.916:1, `--text-muted` 5.862 → 5.971:1.
- **The column drag-over outline was never broken.** The owner reported no violet
  outline when dragging over a column. Probed with a held mid-drag, the target column
  gains `oklch(0.42 0.11 285) 0px 0px 0px 2px inset` and the `columnOver` class, and
  loses both after the drop. None of the suspected causes applies: `.columnOver` is
  declared after `.column` in the same stylesheet so it wins on source order, and
  `dragover` bubbles from the cards so crossing a child does not strip the state. No
  code changed. It is now covered by a test, which it never was — `dragTo()` completes
  atomically and never exposes the state, which is why the report could stand
  unanswered.

**Centred nav and board** (owner's 2026-10-04 nav spec, items 1–5). The wrapper is a
centred flex column; the bar is `fit-content` with `max-width:100%`; its width
transitions over `--dur` with `interpolate-size: allow-keywords` on `:root`; the tabs
strip and the dashboard's label slot both dropped from `flex:1 1 auto` to `0 1 auto`;
and the board's column row is centred at 44px below the nav.

- **`flex: 0 1 auto` on the strip and the slot is load-bearing, not tidying.** The bar
  sizes itself to that row, so a child that grows to fill the bar makes the bar grow to
  fill the window — each waiting on the other — and the centring is lost. A test
  asserts the bar is under 1200px wide at a 1600px viewport, which is what catches a
  revert to `1 1 auto`.
- **The dashboard's slot now carries a "Workspaces" label.** With a content-sized bar
  an unlabelled 120px spacer is a visible hole rather than slack, so this had to land
  with the pill rather than later.
- **`interpolate-size` is Chrome 129+ and Edge.** Elsewhere the width jumps to its new
  value, which is still correct and usable; only the animation is lost. Not verified in
  a browser that lacks it.
- **The width animation only plays for changes within a page** — the green dot
  appearing, the View only pill, the status label hiding below 1100px. It does not play
  across a navigation, because every page renders its own `AppShell` and the bar is a
  new node each time. The shared-layout restructure
  (`2026-10-03-shell-routing-and-nav.md`) is what fixes that, for the same reason it
  fixes the sliding indicator.
- **The board's `margin: 0 auto` needs `width: fit-content` to do anything**, since the
  scroller is otherwise full width. `justify-content: center` is the obvious
  alternative and is wrong: with overflow it leaves the first column unreachable.

**Motion continuity across a navigation** (2026-10-03). Both the sliding pill and the
bar's width used to start from nothing on every navigation, because every page renders
its own `AppShell` and the nav is therefore a new node. Each now remembers its previous
value in module scope and animates from it: `lastMetrics` in `NavTabs`, `lastNavWidth`
in `AppShell`. This is the owner's interim fix and the shared-layout restructure
removes the need for it.

- **Set-the-start-then-force-a-reflow does not work on a freshly inserted node.** A
  property's first resolved value on a new element is its initial value, not something
  to transition from, so the transition was swallowed and the width jumped — measured,
  not assumed. The start width is pinned with `transition: none`, painted for one
  frame, and changed inside a `requestAnimationFrame`.
- **The width effect needs its `animating` guard.** It has no dependency array, so it
  runs after every render; clearing the inline width to measure would snap the bar to
  its destination, and `scrollWidth` reports the inline width rather than the natural
  one while shrinking.
- **`AppShell` subscribes to the doc store for the re-render, not the values.** The
  green dot, the status label and the presence avatars all change the bar's width
  without changing a prop of `AppShell`.
- **Module scope is safe here**: both values are written only from layout effects,
  which do not run during SSR, so they are null on the server and every render agrees.
  `lastMetrics` can be stale across workspaces, in which case the pill slides from a
  slightly wrong place — still better than materialising from nothing.
- **Both tests had to be rewritten to discriminate.** The first version measured the
  pill's viewport x, which drifts as the centred bar resizes whether or not the pill is
  animating; the second asserted the first sample, which is the *old* page's pill. The
  property that actually distinguishes the fix is that the pill never leaves the span
  between the two tabs.

**Green dot, offline.** The dot now requires `status === 'connected'`, because it
asserts that other people are in this document right now and a disconnected tab cannot
know that — awareness goes stale rather than empty. **Not covered by a test, and the
reason matters:** y-websocket has no active close-on-offline behaviour, so `status` only
becomes `disconnected` when its dead-peer timer fires about thirty seconds later. A
test would have to wait that long and would be racing the retry. The prompt signal is
`navigator.onLine`, which arrives with
`2026-10-04-connection-states-and-telemetry.md`; the dot becomes promptly correct then.

### Paint splatter

Built, on branch `glass-features`: `components/PaintSplatter.tsx` (client island),
`lib/splatter/{random,geometry,paint}.ts`, tests in `test/splatter-*.test.ts` and
`e2e/glass-shell.spec.ts`. **This subsection is now the specification.** It was
written by the owner in a chat message on 2026-10-02 that is not in the repository;
what follows is that specification as built, plus the places the build differs from
it. Where this subsection and the code disagree, that is a defect in one of them.

**Placement and stacking.** One `<canvas data-testid="paint-splatter">`, `aria-hidden`,
absolutely positioned (`inset: 0`, 100% by 100%) inside the fixed, full-viewport
`.canvas` layer of `CanvasBackground` (`z-index: 0`, `pointer-events: none`,
`overflow: hidden`). Back to front: the five blobs, **the splatter**, the canvas weave
(`mix-blend-mode: multiply`), so the texture reads over the paint. It inherits
`pointer-events: none`, and a test reads it on the element itself. `CanvasBackground`
stays a server component; `PaintSplatter` is its only client child.

**Strength.** Layer opacity, set inline from one prop: `subtle` 0.32, `bold` 0.9,
`off` renders nothing. Production ships `subtle`. The owner lowered `subtle` from 0.5
to 0.32 in the 2026-10-02 review, in the same pass that resized the splats.

**Palettes** (raw hex, artwork rather than tokens, one exported constant `PALETTES` in
`lib/splatter/geometry.ts`). Each splat takes one colour from the chosen palette with
`random.pick`, and so does each speck.

```ts
purple: [
  '#7b3fe4', '#5b4ee8', '#9d5cf0', '#c13ea6', '#e8559b', '#3d8fdc',
  '#22b8c9', '#f0b429', '#f2843a', '#4cc38a', '#b794f6',
],
orange: [
  '#f2762e', '#f0b429', '#e2453c', '#f59e0b', '#2e8bd6', '#2aa58a',
  '#e8559b', '#7b3fe4', '#22b8c9',
],
```

The purple array is as supplied: eleven entries, all distinct. Violet is
over-represented by having three family members in it (`#7b3fe4`, `#9d5cf0`,
`#b794f6`, hues 262, 266 and 261), not by a repeated entry. The owner's note "violet
appears twice" describes that over-representation. Do not add a duplicate and do not
remove any of the three.

**OPEN QUESTION for the design owner.** The 2026-10-04 spec restates this as
"`#7b3fe4` (twice, so it appears more often)", which reads as an actual duplicate
entry rather than the family over-representation above. The two readings disagree and
only the owner can settle it. Nothing has been changed on a guess: duplicating the
entry would shift every `random.pick` after it and therefore change the seeded pattern
on every screen. A code comment in `geometry.ts` did claim violet appeared twice, which
was false of the array; it now describes what is actually there and points here.

**Per splat** (drawn once onto its own offscreen canvas, in splat-local coordinates,
origin at the centre, scale 0.7 to 1.4). **These magnitudes are the 2026-10-02
review's; the structure is unchanged from the original spec.**

- **Core:** 9 overlapping circles, radius 0.55 to 1.0 of an 11px base (times scale),
  centres within 0.45 of that base radius of the origin so they merge into one mass.
- **Rays:** 10 to 23, at random angles over the full circle. Each is a tapered streak
  of 1.5 to 5 core radii, **1.5 to 4px wide at the base and narrowing to 15% of that
  at the tip**, ending in a **tip blob** of 1 to 2.5px radius. **35%** of rays also
  carry a **drip** hanging straight down from the tip, 0.4 to 1.4 core radii long,
  drawn no wider than the tip blob and ending in a bulb of 0.75 of the tip radius.
  - The 15% taper is load-bearing and was a defect, not just a number. The tip
    half-width used to be derived from the tip blob's radius (`tipR * 0.6`), which
    left the tip at roughly 60% of the base with a blob as wide as the base on the
    end. That is the "spider legs" the owner reported, and resizing alone preserved
    the ratio. It is now derived from the ray's own width.
- **Droplets:** 40 to 90, scattered from one core radius out to about 5.2, **decreasing
  in size** along the list (radius from about 2.5px to 0.4px, times scale) and fading
  from alpha 1 to 0.7 so the spray thins at its edge.
- **Core drips:** 0 to 3, vertical, straight down from the core, 0.8 to 2.2 core radii
  long, 1 to 2.5px wide, with an end blob.

**Count and specks.** Splats on screen: `10 + 8 × √(W·H) / 1100`, rounded (18 at
1440×900, 20 at 1920×1080, 24 at 2560×1440). Plus **320 specks** scattered over the
viewport, each a small square (half-side 0.6 to 1.8px) in a palette colour, drawn
straight onto the visible canvas rather than through an offscreen canvas.

**Nav exclusion zone.** Nothing is painted in the **top 90px** of the viewport —
neither splats nor specks. Added in the 2026-10-02 review: splat colour read straight
through the nav's `backdrop-filter` as coloured streaks inside the bar. The zone is
viewport space, not document space, which is sound because the canvas is absolutely
positioned inside a fixed, full-viewport parent, so canvas y is viewport y. It is
sized for the **unshrunk** nav (12px gap + 56px bar = 68px, plus margin); a condensed
nav occupies less and is still inside it, and the splatter does not react to scroll.
A splat's y is drawn uniformly over the band below `90 + radius` rather than
rejection-sampled or clamped: it consumes one PRNG value as the unconstrained
placement did, cannot loop, and does not pile splats along the boundary. One constant,
`NAV_EXCLUSION_PX`.

**Animation.**

- **Frame rate:** about 30 fps (see deviations); every time below is wall-clock,
  derived from `performance.now()`, never from a frame count.
- **Landing:** 650ms. Scale runs from 0.35 to 1 along an **ease-out-back** curve
  (overshoots, then settles) while alpha ramps from 0 to 1.
- **Life:** 16 to 32 seconds per splat, chosen per splat. Start times are staggered
  inside each splat's own life so they do not all land together.
- **Drift:** linear over the splat's life, up to **±3px** on each axis.
- **Rotation:** a **fixed** rotation per splat, **±0.25 rad**, not animated.
- **Fade-out:** the last **2400ms** of life, alpha falling to 0. At the end of its life
  a splat is re-placed at a new random position and lands again, reusing the same
  offscreen canvas; nothing is rasterised again.
- **Speck shimmer:** alpha oscillates between **0.55 and 0.9** (a sine, 700ms per
  radian, so one cycle is about 4.4 seconds), with a random phase per speck.

**Seed.** A fixed constant, `0x5ca77e5`, never `Date.now()`. The initial pattern is
the same on every load.

**Device pixel ratio.** `min(devicePixelRatio, 1)`: an addition, see deviations. The
spec names a cap of 2. Offscreen canvases are painted at that ratio, so they are never
upscaled. A resize rebuilds everything, **debounced 150ms**, and only when the layer's
size or the device pixel ratio actually changed.

**Reduced motion.** With `prefers-reduced-motion: reduce`, or `motion="still"`, the
component draws **one static frame** (every splat landed and fully opaque, specks at
the middle of their shimmer) and **never calls `requestAnimationFrame`** or registers
a visibility listener. Verified by counting calls, below.

**Loop.** One `requestAnimationFrame` loop, redrawing at most about every 32ms
(about 30 fps). Per draw it clears, then does one `drawImage` per visible splat and one
`fillRect` per speck. No path construction, no gradients, no `shadowBlur` in the loop;
all of that happens once, at build time. Specks are `fillRect` squares for that reason:
an arc is path construction.

**Parameters.** `PaintSplatter` takes `strength` (`off | subtle | bold`), `palette`
(`purple | orange`) and `motion` (`live | still`).

#### Deviations from the owner's specification

1. **The three settings ship as parameters with fixed production defaults and no UI.**
   The design has them as three user settings. Production is fixed at `subtle`,
   `purple`, `live`. A toggle nobody can reach is dead weight; a parameterised
   component keeps the door open and costs nothing.
2. **The loop pauses on a hidden tab.** Not in the spec. A loop burning CPU on a tab
   nobody is looking at is a defect in anything shipped. On hide it cancels its frame;
   on show it shifts every splat's start time by the time spent away, so returning does
   not make every splat expire and land at the same instant.
3. **`splat.radius` carries 1px of margin.** The painter sizes each offscreen canvas
   from it. Without the margin the outermost blob is tangent to the canvas edge, so
   faint antialiased pixels touched the border on 7 of 200 splats at DPR 1 (1 of 200
   at DPR 2). Nothing visible was clipped, but a hard cut on a paint edge reads as a
   rendering bug and this sits behind every screen. Costs about 1.5% more memory.
4. **Splat scale is 0.7 to 1.4.** The 2026-10-02 review cut it to 0.6–1.2; the owner
   then asked on 2026-10-04 for the splats to be "a little" bigger and chose +17% from
   measured options, which returns the range to 0.7–1.4 — now sitting on the review's
   11px core rather than the original 30px one. It sets the memory figure below: the
   bounding radius runs from 45 to 91px, against 39–84 at 0.6–1.2 and 77–194 originally.
5. **Re-placed splat positions after the first cycle are not reproducible across
   loads.** The first placement is a pure function of the seed, which is what the spec
   asks for. After a splat's first life it is re-placed from a random stream that has
   consumed in the order splats happen to expire, which depends on when frames ran
   (and on time spent on a hidden tab), so the second pattern can differ between loads
   and between machines.
6. **Device pixel ratio is capped at 1, not 2.** The spec names 2. The splats sit at
   half opacity under the weave and behind translucent glass, so the sharpness is not
   visible; the memory and raster cost are. Measured at 1440×900 and DPR 2, **at the
   pre-2026-10-02 splat sizes**: splat canvases 29.0 to 16.3 MiB, visible canvas 19.8
   to 11.1 MiB, and the raster cost per draw in software fell from about 22 to about
   12 ms. The resize has since cut the splat side of that by roughly 85%, so these
   figures now overstate the cost of raising the cap — but not the conclusion. The cap lives in one named
   constant, `MAX_DPR`, with that reasoning beside it. Re-measure before raising it.
7. **The loop redraws at about 30 fps.** The spec names no frame rate. `requestAnimationFrame`
   is still the clock, so the browser's throttling and the hidden-tab pause still
   apply; a frame arriving less than 32ms after the last draw only reschedules. The
   fastest motion is the 650ms landing, which still gets about 20 frames, and drift
   and shimmer are slow. Unthrottled, the loop redrew at the display rate (60 to 145
   Hz). Without this and the DPR cap, software raster dropped 39% of frames at 60 Hz.

#### What it costs

Measured 2026-10-02 in Playwright Chromium 153 at 1440×900, with a device pixel ratio
of 2 on the device (so the 1.5 cap is what is exercised), on `/login`. The page-side
`requestAnimationFrame`, `drawImage`, `fillRect` and `clearRect` were instrumented from
a temporary spec (deleted; no component code was touched). Run twice: headed on an
Apple M4 Pro (Metal GPU raster), and headless (SwiftShader, **software raster**, which
is also what a machine with no hardware acceleration gets). "Before" is the same
measurement with a DPR cap of 2 and no throttle.

| | Headed, GPU | Headless, software |
|---|---|---|
| `drawImage` per draw | 28 (min 27) | 28 (min 26) |
| Speck `fillRect` per draw | 320 | 320 |
| Draws per second | 28.8 (display ticks at 144 Hz) | 30.0 (display ticks at 60 Hz) |
| JS in the callback on a draw, median / worst | 0.5 / 0.7 ms | 0.1 / 0.3 ms |
| JS in the callback on a skipped tick | 0.1 / 0.2 ms | 0.0 / 0.2 ms |
| Interval between draws, median / worst | 34.7 / 36.5 ms | 33.3 / 33.5 ms |
| Display ticks over 20ms (1800 ticks) | 0 (0%) | 0 (0%) |
| Draw intervals over 40ms | 0 | 0 |
| Same page, draw calls suppressed | 0 over 20ms | 0 over 20ms |
| Before: ticks over 20ms | 0 of 1500 | 581 of 1500 (39%), about 43 fps |

Software raster cost per draw, measured by forcing a readback after each draw (an
upper bound, since it includes the readback; an empty canvas reads back in 0.4ms):
median **12.3ms**, worst 13.2, against 21.9 before. At 30 draws a second that is about
370ms of raster work per second, **37% of the wall clock, on a machine with no GPU**.
Before it was about 22ms at 43 draws a second, which is the whole budget. On the GPU
the same readback reads 5.8ms, and the page holds a 144 Hz display with nothing dropped.

Read that as follows. The work per draw is a constant 28 composites and 320 fills; it
does not spike when a splat lands or is re-placed (before the levers, slow frames were
38% of landing-or-re-place frames and 40% of quiet frames headless, and 0 headed). The
JavaScript is negligible. The cost is raster. With both levers the layer no longer
makes the page miss a frame in software, but it is not free there: about a third of
the wall clock is raster for a background. If that matters on no-GPU machines, the
remaining levers are 20 fps, a smaller splat scale, or dropping the layer.

**Canvas memory** (`width × height × 4`, summed over every splat canvas). The design
owner later chose a DPR cap of **1** over 1.5, so these are the figures at cap 1,
obtained by replaying the real generator with the real fixed seed in Node — the geometry
is deterministic, so these are exact rather than sampled:

Re-measured after the 2026-10-02 resize, by the same method:

| Viewport | Splats | Splat canvases | Visible canvas | Layer total | At cap 1.5 | At cap 2 |
|---|---|---|---|---|---|---|
| 1440×900 | 18 | 1.3 MiB | 4.9 MiB | **6.3 MiB** | 14.1 MiB | 25.0 MiB |
| 1920×1080 | 20 | 1.4 | 7.9 | 9.3 | 21.0 | 37.3 |
| 2560×1440 | 24 | 1.7 | 14.1 | 15.7 | 35.4 | 62.9 |
| 3440×1440 | 26 | 1.8 | 18.9 | 20.7 | 46.5 | 82.7 |
| 3840×2160 | 31 | 2.1 | 31.6 | **33.8 MiB** | 76.0 | 135.1 |

Three figures for the same viewport, for scale: 1440×900 was 11.4 MiB originally, 5.9
after the 2026-10-02 resize, and 6.3 after the 2026-10-04 +17%. The splat canvases
alone went 6.4 → 1.0 → 1.3 MiB.

Canvas sides at cap 1, min / median / max: 90 / 134 / 182 CSS px at 1440×900 and
86 / 128 / 194 at 4K. **The median span is 134px**, which is above the "at most about
120px across" of the first review — that sentence described the 0.6–1.2 scale, and the
owner has since chosen +17% from measured options with these numbers in front of them,
so 134 is the figure that now stands. Budget was about 40 MB and **every size is still
inside it, including 4K** at 33.8 MiB. The splat canvases never exceed 2.1 MiB, so the
layer is dominated entirely by the **visible canvas**, which is unavoidable for any
viewport-sized layer. Anyone adding splats, widening the scale range or lifting the cap
is spending from this.

**Raster cost is projected, not measured, and the projection is now two steps old.**
Raster scales with pixel count, so the 12.3 ms per draw measured at cap 1.5 was
projected to roughly 5.5 ms at cap 1 — taking a no-GPU machine from about 37% of a
core to about 16%. The 2026-10-02 resize then cut the splat canvas area by about 80%
and the splat count by a third, and the 2026-10-04 +17% gave back a fifth of the area,
so the real figure should still be well below that.
**None of this has been verified in a browser**; the memory figures above have. Treat
the 5.5 ms as an upper bound at best and re-measure before relying on any of it.

**The loop stops.** Counted on a patched `window.requestAnimationFrame`, with the
caller of each call identified from its stack:

- **Reduced motion:** **0** calls to `requestAnimationFrame` from any caller in the 4
  seconds after load, none pending, and the canvas was not blank (24% of its pixels
  painted). The same instrumentation without reduced motion counted 125 calls in 2
  seconds headless (293 headed), every one from `PaintSplatter`.
- **Hidden tab:** after the visibility change, 0 pending frames, one cancel, and 0
  calls over the next 3 seconds. On return the loop resumed (50 calls in 0.8s
  headless, 118 headed). A tab that is hidden at load starts no loop: 0 calls over 2
  seconds. Caveat: the tab was hidden by overriding `document.hidden` and
  `document.visibilityState` and dispatching `visibilitychange`, because neither a
  second window nor minimising made Playwright's Chromium report hidden. That proves
  the component's handler; it does not test the browser's own background throttling.
- A Playwright test, `the splatter loop redraws at about 30 fps`, pins the throttle: it
  counts draws of the canvas over 2 seconds and requires more than 10 and fewer than
  36 a second. With the throttle removed it read 60.

### Command palette, share sheet and viewer pill

Built, on branch `glass-features` (the command palette and share sheet plan). No
schema, route or API change: the share sheet reuses the existing members routes.

- **⌘K palette.** Opens from Cmd or Ctrl+K and from the nav's search field, which is
  now a real `<button data-testid="search">`. Lists the workspace's documents, the
  user's workspaces (passed from the dashboard, where there is no current
  workspace), Overview, All workspaces and Share. Arrow keys, Enter and Escape work;
  it is a `combobox` over a `listbox` in a `dialog`, and never `role="menu"`. Focus
  returns to whatever held it before, or to the search button when that was `<body>`
  (the usual case after the shortcut), so a keyboard user's next Tab continues from
  the nav instead of restarting at the top of the document.
- **Share sheet.** The nav's Share button opens it, on the workspace and document
  pages. Invite by email and role, change roles (owner only), and the member list.
  **Invite and role editing live in the sheet only.**
- **People panel.** `MembersPanel` is now a read-only list. Its link ("Manage" for
  owners, "See who has access" for everyone else) opens the sheet. It no longer has
  any editing controls.
- **Toasts exist as a primitive** (`components/ui/Toast.tsx`: `ToastProvider` and
  `useToast()`). The offline and syncing pills in the status-pill plan can reuse it
  rather than building their own.
- **Viewer pill.** `AppShell` takes a `role` prop; when it is `viewer` a "View only"
  pill (`ui.chip`, `data-testid="view-only"`) renders after the tab strip. The
  workspace and document pages pass it; the dashboard does not, having no single
  role.

**Both overlays must render outside `<nav>`.** The nav has a `backdrop-filter`, and
that makes it the containing block for any `position: fixed` descendant. An overlay
rendered inside the nav is clipped to the nav's 56px bar instead of covering the
viewport. This cost real debugging time. `AppShell` renders the palette and the
sheet as siblings of `<main>`, with a comment saying why; anyone adding a third
overlay must do the same.

### Document page and nav consolidation

Built, on branch `glass-features`. No backend, route or schema change.

- **Document glass sheet.** The page is a 780px centred sheet: radius 30
  (`--r-sheet`), padding 56/56/96, `rgba(255,255,255,.78)`, with the glass blur,
  `--glass-border` and the `--glass-highlight` inset. It lives in
  `app/documents/[id]/document.module.css` and is applied **only when `type ===
  'doc'`**: the board is a horizontal scroller with its own gutters and would be
  crushed into a 780px column. A test asserts both halves. The editor's temporary 24px
  padding (`.editor .ProseMirror` in `globals.css`) was removed, since the sheet owns
  the padding now.
- **Remote cursor pill.** The label is a pill (`--r-pill`); 11px/500 and the
  `0 4px 10px` shadow already matched. **There is no 0.7s glide**, and that is a
  finding, not an omission: `y-tiptap` renders a remote caret as an inline widget
  decoration (a `<span>` with `position: relative` and no offsets, label absolute
  inside it). When a peer moves, ProseMirror re-inserts the node elsewhere in the
  text flow; no `left` or `top` ever changes, so a transition on them would animate
  nothing. A real glide needs an overlay positioned from `coordsAtPos`.
- **Connection status pill** (`SyncStatus`), **nav presence avatars**
  (`NavPresence`) and the **tab presence dot** (`NavTabs`), all reading the
  document-state store (`lib/doc-state.ts`) that `DocumentClient` publishes to. The
  transitional header row is gone. `Presence.tsx`'s `Presence` export was deleted;
  **`CardPresence` remains** for the board's card rings.

**The document-state store is a module singleton.** It is valid while one document is
open at a time, which is how the app works today. Alternatives rejected:

- *Move the provider into `AppShell`.* It relocates working sync code onto a new
  path, and couples the nav to Yjs on every page, including pages with no document.
- *A shared client layout above the document.* It is the same restructure as making
  the tab indicator glide across navigations, which is still an open question (see
  Known limitations). It should be decided once, not twice.

**Three assertions were deliberately retargeted** because their subjects were removed
by design. This was intent-preserving, not an accommodation to make tests pass:

- `read-only` text became the `view-only` pill (the viewer is still told they cannot
  edit, now in the nav).
- The owner's `role` badge became an assertion that **no** `view-only` pill exists
  (the design has no role indicator for owners).
- The `role` chip style guard (a CSS-module class that no longer resolves renders as
  bare text) now guards the document tile's type chip instead.

**Below 1100px the status label and the presence avatars are clipped, not
`display: none`**, so they stay in the accessibility tree. A test proves it by
asserting a bounding box of width <= 1: a `display: none` element has no box at all,
so a non-null box that is also that narrow can only be clipped.

**Known limitations of this plan:**

- **The tab dot appears only on the active tab.** The store holds state for the open
  document only, and the client subscribes to awareness for that document alone.
  Showing the dot on other tabs needs per-document awareness the client does not
  have. This is not a finished feature; it is the part the current data supports.
- **Avatar initials are white on the peer's awareness colour**, which is not
  guaranteed to have contrast for lighter palette entries (white on `#f59e0b` is
  roughly 2:1). The name is carried by `title` and `aria-label`, so the initials are
  decorative, but it is a real contrast shortfall.
- **The tab dot widens its tab**, and the strip's `ResizeObserver` does not fire for
  that (the strip does not change size, one tab inside it does). A layout effect in
  `NavTabs` therefore re-measures the sliding indicator when the dot appears or
  goes. Anyone touching the indicator must keep it, or the pill drifts off its tab.

### Deferred, each needing its own plan

- **Status popover, offline and syncing pills.** The status pill itself is built (see
  above). The **popover** is still deferred: its version sequence, queued-edit count
  and latency ping are not exposed by the sync server. The offline and syncing pills
  can reuse the toast primitive.
- **The palette's "Go offline" and "Reconnect" items.** Deliberately left out, not
  forgotten. They need the Yjs provider, which lives in `DocumentClient` and is not
  reachable from the nav: the store publishes status and peers, not the provider.
  They belong to a plan that exposes provider controls, likely with the popover.
- **History button, history panel, version preview bar.** Need a snapshot list
  and fetch API, and authorship on updates.
- **Card detail sheet.** Blocked on `description` and an activity log on the
  card's `Y.Map`; neither exists in the CRDT shape today, and adding them is a
  schema change this work barred. Two things were left ready or left out on
  purpose: `.cardSelected` exists in `board.module.css` but is unused, waiting for
  this sheet to give a card a selected state; and the "has notes" card meta was
  deliberately not added, because there is no `description` field to drive it.

### Known limitations

- **No phone layout.** At 375px the account avatar sits about 17px off screen, so
  the account menu, and therefore sign-out, is unreachable on a phone. The
  handoff defines one breakpoint (1100px) and nothing below it, so this is a
  design gap, not an implementation defect. The owner has decided to ship
  desktop-only for now. Candidate fixes: shed the workspace name and search field
  below about 700px (extends the pattern already used at 1100px), or let the nav
  scroll horizontally.
- **The tab indicator does not animate across navigations.** It is positioned
  correctly on every route and animates on resize, but each page renders its own
  `AppShell` and no layout sits above the dynamic segment, so the whole nav
  remounts on navigation and the pill appears at its destination. Measured:
  sampling its x after a document-to-document click gives the old position on the
  old node, then the destination on a new DOM node, with no intermediate values.
  Fixes: put `AppShell` in the root layout (it cannot see a deeper segment's
  params, so nav data would have to flow through a client store), or nest
  documents under workspaces as `/workspaces/[id]/documents/[docId]` with a layout
  at the workspace segment. The second is the better long-term shape, but it
  rewrites every document URL, every link, the OAuth `next=` targets and several
  tests.
- **The "updated" line on document tiles shows time only, with no author.** The
  prototype's mock reads "Grace · 2 min ago". Per-update authorship does not
  exist in the schema, so the author half waits for the history and authorship
  plan.
- **Last-activity query efficiency is planner-dependent.** It is a lateral join.
  Its normal plan is one index seek per document (EXPLAIN: Index Scan Backward on
  `DocumentUpdate_documentId_id_idx` inside the Limit, 0.040 ms). On heavily
  skewed data Postgres may instead pick a backward primary-key scan with a filter,
  measured at 11.9 ms per loop. Postgres has no query hints, so this cannot be
  forced. Durable fixes are a `(documentId, id DESC)` index or a denormalised
  `updatedAt` column on `Document`; both need schema changes this plan barred.
- **`@supports not (backdrop-filter)` fallbacks compile but have never been
  exercised** in a browser lacking backdrop-filter support.

### Deliberate deviation from the design

The nav's workspace name is capped at `max-width: 240px` with an ellipsis and a
`title` attribute. The design caps nothing, but without the cap a 120-character
workspace name forces the whole document to scroll horizontally.
