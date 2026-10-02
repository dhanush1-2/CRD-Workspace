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

Font: `-apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", system-ui, sans-serif`. Base size 15px, line-height 1.47, letter-spacing −0.01em, antialiased.
- Page H1: 32px / 600 / −0.025em
- Section H2: 21px / 600 / −0.02em
- Card title: 18px / 600
- Body: 15px; small text 13–13.5px

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
- **Sticky nav wrapper:** `position:sticky; top:0; z-index:30; padding:12px 16px 0`.
- **Nav bar:** 56px high, pill radius, padding `0 8px 0 10px`, 10px gap.
  - Background `rgba(255,255,255,.72)` + glass blur, border `1px solid rgba(40,40,60,.1)`.
  - Shadow `inset 0 1px 0 #fff, 0 12px 32px rgba(30,30,50,.12), 0 2px 6px rgba(30,30,50,.08)`.
  - Entrance animation: `g-pop .6s var(--ease)`.
- **Nav contents, left to right:**
  1. **Logo button:** a 36px accent circle (`aria-label="All workspaces"`). It goes to the dashboard. Hover: `rotate(-8deg) scale(1.05)`. Active: `scale(.92)`.
  2. **Workspace name button** (600 weight), which goes to the workspace overview, then a 1×22px divider.
  3. **Tabs strip:** Overview plus one tab per document. `flex:1 1 auto; min-width:120px; overflow-x:auto; scrollbar-width:none; padding:3px`. When it overflows, add a right-edge fade mask: `mask-image: linear-gradient(90deg,#000 82%,transparent)`.
     - Each tab is 32px high with `0 14px` padding and pill shape, 14px text. Active tab: 600 weight, `--text`. Inactive: 500 weight, `--text-muted`. A green 6px dot shows when others are in that document.
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
background: linear-gradient(180deg,rgba(255,255,255,.35) 0%,rgba(255,255,255,0) 45%,rgba(255,255,255,0) 70%,rgba(255,255,255,.25) 100%), rgba(110,110,130,.07);
backdrop-filter: blur(6px) saturate(240%) contrast(1.05);
box-shadow: inset 0 1px 0 rgba(255,255,255,.95), inset 0 -1px 0 rgba(255,255,255,.6),
  inset 1px 0 0 rgba(255,255,255,.45), inset -1px 0 0 rgba(255,255,255,.45),
  inset 0 0 0 1px rgba(80,80,100,.08), inset 0 2px 6px rgba(80,80,100,.08),
  inset 0 -3px 8px rgba(255,255,255,.35), 0 1px 2px rgba(40,40,60,.06), 0 4px 14px rgba(40,40,60,.06);
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
- The last tile is dashed (`1.5px dashed rgba(0,0,0,.12)`) with a pill input "Name it, then press Enter".

**Workspace.** H1 = workspace name, then a muted line `N documents · N people`.
- **Documents:** tiles (minmax 230) with a kind chip (`Board` / `Page`: accent-tint bg, accent-text, pill) and the title plus "updated" line.
- **Create tile** (editors only):
  - Pill input.
  - Page/Board segmented control: track `rgba(0,0,0,.05)`; the selected segment is white with `0 1px 3px rgba(30,45,40,.14)`.
  - Create button (accent).
  - Enter submits.
- **People:** a glass list (radius 22) with rows of a 34px avatar, name, email and role ("Owner / Can edit / Can view"). The header link "Manage" (owner) or "See who has access" opens Share.

**Board.** A horizontal scroller with 28px top padding and 16px gutters.
- **Column:** 290px wide, radius 26, glass `rgba(255,255,255,.42)`; drag-over bg `rgba(255,255,255,.75)` + `inset 0 0 0 2px var(--accent)`. Header: title 15/600 and a count chip (22px pill, `rgba(0,0,0,.05)`).
- **Card:**
  - Base: `rgba(255,255,255,.92)`, radius 18, padding 14/16, title 14.5px. Shadow `0 0 0 1px #fff, 0 2px 8px rgba(30,45,40,.06)`.
  - Hover: `translateY(-3px) scale(1.01)` + `0 14px 30px rgba(30,45,40,.12)`. Active: `scale(.98)`. Entrance: `g-in .5s`.
  - Being dragged: opacity .4.
  - Selected: `0 0 0 2px var(--accent)`.
  - A remote peer on the card: `0 0 0 2px #0ea5e9, 0 4px 14px rgba(14,165,233,.18)` plus a peer chip (avatar + name, `rgba(14,165,233,.1)`, text `#0b6e99`).
  - "Has notes" meta when there is a description. A delete × (24px circle) for editors.
- "+ Add a card": a ghost pill. "+ Add a list": a 230×54 dashed pill.

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
- Text: H1 32/600; H2 21/600; paragraphs 17px, line-height 1.65, color `--text-2`; caret color accent.
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
