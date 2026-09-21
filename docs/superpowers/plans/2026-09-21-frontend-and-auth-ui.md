# Frontend and Authentication UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the existing CRDT backend a real user interface — sign-up, sign-in, sign-out, a workspace dashboard, a document list, a member-management panel, and a document page with proper chrome — so a person can use the product end to end without a browser console.

**Architecture:** Next.js App Router. Server Components read data directly through Prisma and the existing `auth-guard` helpers (the pattern `app/documents/[id]/page.tsx` already uses); Client Components perform mutations by POSTing to the **already-built, already-tested** `/api/*` route handlers and then calling `router.refresh()` to re-render the server tree. Styling is CSS Custom Properties plus CSS Modules — native to Next with webpack, zero new build configuration. No backend rewrite: every mutation in this plan goes through an endpoint that exists today.

**Tech Stack:** Next.js 16.3.5 (App Router, forced `--webpack`), React 19.3.0, TypeScript 7.0.2, Prisma 7 via `@crdt/db`, CSS Modules, Vitest 5, Playwright 1.63.

**Spec:** `docs/superpowers/specs/2026-09-19-crdt-collaborative-engine-design.md`

This plan closes a gap the spec itself created. Spec §2 "Happy path" requires: *"User signs up, lands in a workspace they own. Creates a board... Invites a second user as `editor`."* The v1 build implemented every backend route for that flow but deliberately cut the UI, leaving `app/documents/[id]/page.tsx` rendering the literal text *"This build has no sign-in page; authenticate via the API directly."* This plan builds the missing UI. It adds no new capability the spec did not already require.

---

## Global Constraints

Copied verbatim or derived from the spec and the existing codebase. Every task's requirements implicitly include this section.

- **Do not modify any file under `apps/web/src/app/api/`** except where a task explicitly says so. Those handlers are covered by passing integration tests; breaking them breaks the backend contract. This plan modifies **zero** API routes.
- **Do not modify** `.env`, `.env.example`, `docker-compose.yml`, `docker-compose.override.yml`, `packages/db/prisma/schema.prisma`, or `packages/sync/`. No new database migration is required by this plan.
- **Add no new runtime dependencies.** No CSS framework, no component library, no form library, no state manager. Styling is CSS Modules + CSS Custom Properties, which Next 16 supports with no configuration.
- **`data-testid="status"` on the document page must keep rendering the connection status string as its exact and only text content** (`connecting` / `connected` / `disconnected` / `fatal`). `apps/web/e2e/collaboration.spec.ts` asserts `toHaveText('connected')`. Wrapping it, prefixing it, or appending to it breaks a passing test.
- **`data-testid="read-only"` must continue to render on the document page when, and only when, the viewer's role is `viewer`.** Same reason.
- **All `data-testid` attributes already present in `Board.tsx`, `Editor.tsx`, and `Presence.tsx` must survive unchanged.** `collaboration.spec.ts` depends on `add-column`, `column-<id>`, and `add-card-<id>`.
- **Next 16: `params` and `searchParams` are Promises** in Server Components and must be `await`ed.
- **Never call `redirect()` from `next/navigation` inside a `try` block whose `catch` swallows errors.** `redirect()` signals by throwing; a broad `catch` turns a redirect into a silently-rendered page.
- **Role vocabulary is exactly `owner` / `editor` / `viewer`** (`packages/shared/src/types.ts`). Import the type as `import type { Role } from '@crdt/shared/types'`.
- **Password minimum is 12 characters** — that is `POST /api/auth/signup`'s server-side rule (`z.string().min(12)`). Any client-side hint must state 12, not 8.
- **Relative imports inside `apps/web/src/lib/` carry a `.js` extension** (`./env.js`, `./session.js`) — the existing files do this and NodeNext resolution requires it. Imports through the `@/` alias do not.
- **Run commands from the repo root** (`/Users/dhanush/Desktop/Projects/CRDT`) unless a step says otherwise. Vitest: `pnpm test`. Typecheck: `pnpm typecheck`. Playwright: `pnpm --filter @crdt/web exec playwright test`.
- **Playwright needs Postgres up.** Postgres runs in Docker on host port **5433** (`docker-compose.override.yml`). Do not start, stop, or restart it — assume it is running. Do not touch the machine's native PostgreSQL on 5432; it is not ours.
- **Commit after every task.** Conventional-commit prefixes (`feat:`, `fix:`, `test:`, `refactor:`), matching existing history.

---

## File Structure

### New files

| File | Responsibility |
|---|---|
| `apps/web/src/lib/current-user.ts` | `getCurrentUser()` — the non-throwing counterpart to `requireUser()`. Returns the user or `null` for "not signed in", and rethrows everything else. |
| `apps/web/src/lib/safe-next.ts` | `safeNext()` — validates a `?next=` redirect target so the login page cannot be used as an open redirect. |
| `apps/web/src/components/ui/ui.module.css` | The shared visual vocabulary: button, input, field, panel, badge, error. One file so the primitives cannot drift apart. |
| `apps/web/src/components/ui/Button.tsx` | Client component. Three variants. |
| `apps/web/src/components/ui/TextField.tsx` | Client component. Label + input, wired by a generated id. |
| `apps/web/src/components/ui/Panel.tsx` | Server-safe. Titled card with an optional header action. |
| `apps/web/src/components/AppShell.tsx` | Server component. The signed-in frame: brand, breadcrumb, user identity, sign-out. |
| `apps/web/src/components/SignOutButton.tsx` | Client component. POSTs logout, then navigates. |
| `apps/web/src/components/app-shell.module.css` | Styles for `AppShell`. |
| `apps/web/src/app/(auth)/layout.tsx` | Centered single-card frame for the signed-out pages. |
| `apps/web/src/app/(auth)/auth.module.css` | Styles for the auth card and its forms. |
| `apps/web/src/app/(auth)/login/page.tsx` | `/login`. Redirects away if already signed in. |
| `apps/web/src/app/(auth)/login/LoginForm.tsx` | Client. POSTs `/api/auth/login`. |
| `apps/web/src/app/(auth)/signup/page.tsx` | `/signup`. |
| `apps/web/src/app/(auth)/signup/SignupForm.tsx` | Client. POSTs `/api/auth/signup`. |
| `apps/web/src/app/dashboard.module.css` | Styles for the workspace dashboard. |
| `apps/web/src/app/CreateWorkspaceForm.tsx` | Client. POSTs `/api/workspaces`. |
| `apps/web/src/app/workspaces/[id]/page.tsx` | `/workspaces/:id`. Documents and members for one workspace. |
| `apps/web/src/app/workspaces/[id]/CreateDocumentForm.tsx` | Client. POSTs `/api/workspaces/:id/documents`. |
| `apps/web/src/app/workspaces/[id]/MembersPanel.tsx` | Client. POSTs `/api/workspaces/:id/members`. |
| `apps/web/src/app/workspaces/[id]/workspace.module.css` | Styles for the workspace page. |
| `apps/web/src/app/documents/[id]/document.module.css` | Styles for the document header. |
| `apps/web/test/safe-next.test.ts` | Unit tests for the redirect guard. |
| `apps/web/test/current-user.test.ts` | Unit tests for the 401-vs-error distinction. |
| `apps/web/e2e/auth-flow.spec.ts` | Playwright coverage of sign-up → dashboard → workspace → document → sign-out. |

### Modified files

| File | Change |
|---|---|
| `apps/web/src/app/globals.css` | Add design tokens and a reset above the existing editor rules. Existing rules keep working unchanged. |
| `apps/web/src/app/layout.tsx` | Drop the inline `<body>` style now that `globals.css` owns it. |
| `apps/web/src/app/page.tsx` | Replace the placeholder with the real workspace dashboard. |
| `apps/web/src/app/documents/[id]/page.tsx` | Redirect to `/login?next=…` instead of rendering the "no sign-in page" message; pass title, workspace, and role down. |
| `apps/web/src/app/documents/[id]/DocumentClient.tsx` | Real header: back link, document title, role badge, styled status. |
| `apps/web/playwright.config.ts` | Add a `webServer` block so the suite can start its own dev server. |
| `apps/web/e2e/fixtures.ts` | Add `cleanupUser(email)` for the signup test, which creates a workspace `cleanup()` cannot find by label. |

### Why this shape

Pages own data-fetching and authorization; client components own one form each. A form component is small, has one endpoint, and one error surface — which is why each of them is its own file rather than a branch inside a larger component. `ui.module.css` is deliberately a single file: the primitives share tokens and spacing, and splitting them into four stylesheets is how a design system starts drifting.

---

## Task 1: Design tokens and UI primitives

**Files:**
- Modify: `apps/web/src/app/globals.css` (prepend tokens/reset; keep existing rules)
- Modify: `apps/web/src/app/layout.tsx`
- Modify: `apps/web/playwright.config.ts`
- Create: `apps/web/src/components/ui/ui.module.css`
- Create: `apps/web/src/components/ui/Button.tsx`
- Create: `apps/web/src/components/ui/TextField.tsx`
- Create: `apps/web/src/components/ui/Panel.tsx`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `Button` — `(props: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'danger' }) => JSX.Element`, from `@/components/ui/Button`. Client component.
  - `TextField` — `(props: InputHTMLAttributes<HTMLInputElement> & { label: string }) => JSX.Element`, from `@/components/ui/TextField`. Client component.
  - `Panel` — `({ title?: string; action?: ReactNode; children: ReactNode }) => JSX.Element`, from `@/components/ui/Panel`. Server-safe (no hooks).
  - CSS custom properties on `:root`: `--bg --surface --border --border-strong --text --text-muted --accent --accent-hover --accent-contrast --danger --radius --radius-sm --space-1 --space-2 --space-3 --space-4 --space-5 --space-6 --shadow --font`.

**Why there is no unit test in this task:** this repo has no jsdom environment and no React Testing Library (`apps/web/vitest.config.ts` sets `environment: 'node'`), and these components carry no logic worth asserting — they are markup and class names. The honest verification is that they compile and that a production build resolves the CSS Modules. Tasks 3 onward exercise them through Playwright, which is the real test surface for rendered UI. Do not add a test that renders nothing and asserts nothing.

- [ ] **Step 1: Write the design tokens and reset into `globals.css`**

Prepend this **above** the existing `.editor .ProseMirror` and `.collaboration-carets__*` rules. Do not delete or edit those — they style the Tiptap editor and are load-bearing.

```css
:root {
  --bg: #fafafa;
  --surface: #ffffff;
  --border: #e4e4e7;
  --border-strong: #d4d4d8;
  --text: #18181b;
  --text-muted: #71717a;
  --accent: #4f46e5;
  --accent-hover: #4338ca;
  --accent-contrast: #ffffff;
  --danger: #dc2626;
  --radius: 10px;
  --radius-sm: 6px;
  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-5: 24px;
  --space-6: 32px;
  --shadow: 0 1px 2px rgb(0 0 0 / 0.06), 0 4px 12px rgb(0 0 0 / 0.04);
  --font: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
}

*,
*::before,
*::after {
  box-sizing: border-box;
}

html,
body {
  height: 100%;
}

body {
  margin: 0;
  background: var(--bg);
  color: var(--text);
  font-family: var(--font);
  font-size: 15px;
  line-height: 1.5;
  -webkit-font-smoothing: antialiased;
}

h1,
h2,
h3 {
  margin: 0;
  font-weight: 600;
  letter-spacing: -0.01em;
}

h1 {
  font-size: 22px;
}

h2 {
  font-size: 16px;
}

h3 {
  font-size: 14px;
}

p {
  margin: 0;
}

a {
  color: var(--accent);
  text-decoration: none;
}

a:hover {
  text-decoration: underline;
}

button,
input,
select {
  font: inherit;
  color: inherit;
}

:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}
```

- [ ] **Step 2: Drop the now-duplicated inline body style from `layout.tsx`**

Replace the whole file with:

```tsx
import './globals.css'

import type { ReactNode } from 'react'

export const metadata = { title: 'CRDT Workspace' }

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
```

- [ ] **Step 3: Write `ui.module.css`**

```css
.button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-2);
  padding: 8px 14px;
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: background 120ms ease, border-color 120ms ease;
  white-space: nowrap;
}

.button:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.primary {
  background: var(--accent);
  color: var(--accent-contrast);
}

.primary:not(:disabled):hover {
  background: var(--accent-hover);
}

.secondary {
  background: var(--surface);
  border-color: var(--border-strong);
  color: var(--text);
}

.secondary:not(:disabled):hover {
  background: var(--bg);
}

.danger {
  background: var(--surface);
  border-color: var(--danger);
  color: var(--danger);
}

.field {
  display: grid;
  gap: var(--space-1);
}

.label {
  font-size: 13px;
  font-weight: 500;
  color: var(--text-muted);
}

.input {
  width: 100%;
  padding: 9px 12px;
  background: var(--surface);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-sm);
  font-size: 14px;
}

.input::placeholder {
  color: var(--text-muted);
}

.panel {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  box-shadow: var(--shadow);
  overflow: hidden;
}

.panelHeader {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  padding: var(--space-3) var(--space-4);
  border-bottom: 1px solid var(--border);
}

.panelBody {
  padding: var(--space-4);
}

.badge {
  display: inline-block;
  padding: 2px 8px;
  border: 1px solid var(--border-strong);
  border-radius: 999px;
  font-size: 12px;
  color: var(--text-muted);
  text-transform: lowercase;
}

.error {
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--danger);
  border-radius: var(--radius-sm);
  color: var(--danger);
  font-size: 13px;
}

.empty {
  color: var(--text-muted);
  font-size: 14px;
}
```

- [ ] **Step 4: Write `Button.tsx`**

```tsx
'use client'

import type { ButtonHTMLAttributes } from 'react'
import styles from './ui.module.css'

type Variant = 'primary' | 'secondary' | 'danger'

export function Button({
  variant = 'primary',
  className,
  type = 'button',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      {...props}
      type={type}
      className={[styles.button, styles[variant], className].filter(Boolean).join(' ')}
    />
  )
}
```

`type` defaults to `'button'` deliberately. HTML's default is `'submit'`, which makes any button dropped inside a form submit it by accident; the forms in later tasks pass `type="submit"` explicitly.

- [ ] **Step 5: Write `TextField.tsx`**

```tsx
'use client'

import { useId, type InputHTMLAttributes } from 'react'
import styles from './ui.module.css'

export function TextField({
  label,
  className,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  const id = useId()
  return (
    <div className={styles.field}>
      <label className={styles.label} htmlFor={id}>
        {label}
      </label>
      <input {...props} id={id} className={[styles.input, className].filter(Boolean).join(' ')} />
    </div>
  )
}
```

- [ ] **Step 6: Write `Panel.tsx`**

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
    <section className={styles.panel}>
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

No `'use client'` here — `Panel` uses no hooks, so it stays a Server Component and can be rendered directly by pages. Client components passed as `action` still work.

- [ ] **Step 7: Give Playwright its own dev server**

Replace the `defineConfig` call in `apps/web/playwright.config.ts` (leave the `process.loadEnvFile` block at the top of the file exactly as it is):

```ts
export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  expect: { timeout: 10_000 },
  use: { baseURL: 'http://localhost:3000' },
  // One worker: these tests share a Postgres database and a sync server.
  workers: 1,
  // Start the Next dev server if one is not already listening. Without this every
  // run required a separately-started server, and a forgotten one turned every
  // assertion into an ECONNREFUSED. reuseExistingServer keeps a developer's own
  // `pnpm dev` in charge when they have one running.
  //
  // This starts the web server only. collaboration.spec.ts additionally needs the
  // sync server (`pnpm --filter @crdt/sync dev`) running on port 1234; that is
  // unchanged from before and still started by hand.
  webServer: {
    command: 'pnpm run dev',
    url: 'http://localhost:3000',
    reuseExistingServer: true,
    timeout: 120_000,
  },
})
```

- [ ] **Step 8: Verify it compiles and the CSS Modules resolve**

Run: `pnpm typecheck`
Expected: PASS, no errors.

Run: `pnpm --filter @crdt/web build`
Expected: build completes. This is the step that proves CSS Modules resolve under the forced-webpack configuration; a typecheck alone would not.

- [ ] **Step 9: Commit**

```bash
git add apps/web/src/app/globals.css apps/web/src/app/layout.tsx apps/web/src/components/ui apps/web/playwright.config.ts
git commit -m "feat: add design tokens, UI primitives, and a Playwright dev server"
```

---

## Task 2: Session helpers — `getCurrentUser` and `safeNext`

**Files:**
- Create: `apps/web/src/lib/current-user.ts`
- Create: `apps/web/src/lib/safe-next.ts`
- Test: `apps/web/test/current-user.test.ts`
- Test: `apps/web/test/safe-next.test.ts`

**Interfaces:**
- Consumes: `requireUser`, `HttpError` from `apps/web/src/lib/auth-guard.ts` (existing).
- Produces:
  - `getCurrentUser(): Promise<{ id: string; email: string; name: string } | null>` from `@/lib/current-user`
  - `SessionUser` type alias, same shape, exported from `@/lib/current-user`
  - `safeNext(next: string | null | undefined, fallback?: string): string` from `@/lib/safe-next` (default `fallback` is `'/'`)

**Why this task exists:** every page in this plan asks the same question — "is someone signed in, and if not where do I send them?" `requireUser()` answers it by throwing an `HttpError`, which is right for an API route and wrong for a page. Wrapping it at each call site with a bare `try/catch` would swallow database outages as "signed out" and show a login page for a server fault. One helper, one rule, tested once.

- [ ] **Step 1: Write the failing test for `safeNext`**

Create `apps/web/test/safe-next.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { safeNext } from '../src/lib/safe-next.js'

describe('safeNext', () => {
  it('passes through an ordinary in-app path', () => {
    expect(safeNext('/workspaces/abc123')).toBe('/workspaces/abc123')
  })

  it('keeps a query string on an in-app path', () => {
    expect(safeNext('/documents/abc?nobc=1')).toBe('/documents/abc?nobc=1')
  })

  it('falls back when there is no target', () => {
    expect(safeNext(undefined)).toBe('/')
    expect(safeNext(null)).toBe('/')
    expect(safeNext('')).toBe('/')
  })

  it('honours an explicit fallback', () => {
    expect(safeNext(undefined, '/login')).toBe('/login')
  })

  it('rejects an absolute URL to another origin', () => {
    expect(safeNext('https://evil.example/steal')).toBe('/')
  })

  it('rejects a protocol-relative URL, which the browser resolves off-origin', () => {
    // '//evil.example' starts with '/', so a naive startsWith('/') check lets it
    // through — and the browser then navigates to https://evil.example. This is
    // the open-redirect case the helper exists for.
    expect(safeNext('//evil.example/steal')).toBe('/')
  })

  it('rejects a backslash-escaped protocol-relative URL', () => {
    // Browsers normalise '\' to '/' in URL paths, so '/\evil.example' resolves the
    // same way '//evil.example' does.
    expect(safeNext('/\\evil.example/steal')).toBe('/')
  })

  it('rejects a scheme that is not http, such as javascript:', () => {
    expect(safeNext('javascript:alert(1)')).toBe('/')
  })
})
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `pnpm test safe-next`
Expected: FAIL — cannot resolve `../src/lib/safe-next.js`.

- [ ] **Step 3: Implement `safe-next.ts`**

Create `apps/web/src/lib/safe-next.ts`:

```ts
/**
 * Validate a `?next=` redirect target.
 *
 * The login page sends the user wherever `?next=` points after a successful
 * sign-in. Without a check, anyone can hand out a link to our own login page
 * that lands the user on a site they control — with our domain in the address
 * bar right up until the redirect fires. Only same-origin absolute paths are
 * allowed through; everything else falls back.
 *
 * Rejects, specifically:
 *   - anything not starting with '/' (absolute URLs, `javascript:`, bare paths)
 *   - '//host' and '/\host', which start with '/' but resolve to another origin
 */
export function safeNext(next: string | null | undefined, fallback = '/'): string {
  if (!next) return fallback
  if (!next.startsWith('/')) return fallback
  if (next.startsWith('//') || next.startsWith('/\\')) return fallback
  return next
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test safe-next`
Expected: PASS, 8 tests.

- [ ] **Step 5: Write the failing test for `getCurrentUser`**

Create `apps/web/test/current-user.test.ts`.

The mock replaces `auth-guard` entirely rather than using `importOriginal`, so this test never loads `next/headers`, `env.ts`, or Prisma. `HttpError` is redefined inside the mock factory; `current-user.ts` and this test then both see the same class, so `instanceof` behaves exactly as it does in production.

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('../src/lib/auth-guard.js', () => {
  class HttpError extends Error {
    constructor(
      readonly status: number,
      message: string,
    ) {
      super(message)
      this.name = 'HttpError'
    }
  }
  return { HttpError, requireUser: vi.fn() }
})

const { HttpError, requireUser } = await import('../src/lib/auth-guard.js')
const { getCurrentUser } = await import('../src/lib/current-user.js')

const mockedRequireUser = vi.mocked(requireUser)

beforeEach(() => {
  mockedRequireUser.mockReset()
})

describe('getCurrentUser', () => {
  it('returns the user when one is signed in', async () => {
    const user = { id: 'u1', email: 'a@b.test', name: 'Ada' }
    mockedRequireUser.mockResolvedValue(user)
    await expect(getCurrentUser()).resolves.toEqual(user)
  })

  it('returns null for a 401, which is the only "not signed in" signal', async () => {
    mockedRequireUser.mockRejectedValue(new HttpError(401, 'not authenticated'))
    await expect(getCurrentUser()).resolves.toBeNull()
  })

  it('rethrows a non-401 HttpError instead of reporting "signed out"', async () => {
    // A blanket try/catch would turn this into null, and the caller would show a
    // login page for a server fault — hiding the outage behind a plausible screen.
    mockedRequireUser.mockRejectedValue(new HttpError(500, 'internal error'))
    await expect(getCurrentUser()).rejects.toThrow('internal error')
  })

  it('rethrows an ordinary error, such as the database being unreachable', async () => {
    mockedRequireUser.mockRejectedValue(new Error('connect ECONNREFUSED 127.0.0.1:5433'))
    await expect(getCurrentUser()).rejects.toThrow('ECONNREFUSED')
  })
})
```

- [ ] **Step 6: Run it to make sure it fails**

Run: `pnpm test current-user`
Expected: FAIL — cannot resolve `../src/lib/current-user.js`.

- [ ] **Step 7: Implement `current-user.ts`**

Create `apps/web/src/lib/current-user.ts`:

```ts
import { HttpError, requireUser } from './auth-guard.js'

export type SessionUser = { id: string; email: string; name: string }

/**
 * The page-facing counterpart to requireUser().
 *
 * requireUser() throws for an API route to turn into a 401. A page wants a
 * question answered instead: is anyone signed in? Returns the user, or null
 * when — and only when — the session is genuinely absent or invalid.
 *
 * Everything else is rethrown on purpose. Catching broadly here would report a
 * database outage as "signed out" and render a login form on top of a real
 * server fault, which is both a worse experience and a much harder bug to find.
 */
export async function getCurrentUser(): Promise<SessionUser | null> {
  try {
    return await requireUser()
  } catch (error) {
    if (error instanceof HttpError && error.status === 401) return null
    throw error
  }
}
```

- [ ] **Step 8: Run the tests to verify they pass**

Run: `pnpm test current-user`
Expected: PASS, 4 tests.

Run: `pnpm test`
Expected: the full suite is green — nothing regressed.

- [ ] **Step 9: Commit**

```bash
git add apps/web/src/lib/current-user.ts apps/web/src/lib/safe-next.ts apps/web/test/current-user.test.ts apps/web/test/safe-next.test.ts
git commit -m "feat: add getCurrentUser and safeNext session helpers"
```

---

## Task 3: The sign-in page

**Files:**
- Create: `apps/web/src/app/(auth)/layout.tsx`
- Create: `apps/web/src/app/(auth)/auth.module.css`
- Create: `apps/web/src/app/(auth)/login/page.tsx`
- Create: `apps/web/src/app/(auth)/login/LoginForm.tsx`
- Create: `apps/web/e2e/auth-flow.spec.ts`

**Interfaces:**
- Consumes: `getCurrentUser` and `safeNext` (Task 2); `Button`, `TextField` (Task 1); the existing `POST /api/auth/login`; the existing `seedWorkspace`, `cleanup`, `E2E_PASSWORD` from `apps/web/e2e/fixtures.ts`.
- Produces: the route `/login`, accepting `?next=<path>`. `LoginForm` takes `{ next: string }` — an **already-validated** path; it does not validate again.

`(auth)` is a route group: the parentheses are stripped from the URL, so `(auth)/login/page.tsx` serves `/login`.

- [ ] **Step 1: Write the failing e2e test**

Create `apps/web/e2e/auth-flow.spec.ts`:

```ts
import { test, expect } from '@playwright/test'
import { cleanup, seedWorkspace, E2E_PASSWORD } from './fixtures.js'

const LABEL = 'e2e-auth'

test.afterAll(async () => {
  await cleanup(LABEL)
})

test('an unauthenticated visitor is sent to the sign-in page and can sign in', async ({ page }) => {
  const { owner } = await seedWorkspace(LABEL)

  await page.goto('/login')
  await page.getByLabel('Email').fill(owner.email)
  await page.getByLabel('Password').fill(E2E_PASSWORD)
  await page.getByTestId('submit').click()

  // Signing in lands on the dashboard, not back on the form.
  await expect(page).toHaveURL('/')
})

test('a wrong password shows an error and stays on the form', async ({ page }) => {
  const { owner } = await seedWorkspace(`${LABEL}-bad`)

  await page.goto('/login')
  await page.getByLabel('Email').fill(owner.email)
  await page.getByLabel('Password').fill('definitely-not-the-password')
  await page.getByTestId('submit').click()

  await expect(page.getByTestId('auth-error')).toHaveText('invalid credentials')
  await expect(page).toHaveURL('/login')
  await cleanup(`${LABEL}-bad`)
})
```

The first test asserts `toHaveURL('/')`, and `/` is still the placeholder page until Task 5. That is fine — the assertion is about *navigation*, and it is satisfied as soon as login works.

- [ ] **Step 2: Run it to make sure it fails**

Run: `pnpm --filter @crdt/web exec playwright test auth-flow`
Expected: FAIL — `/login` 404s, so `getByLabel('Email')` never resolves.

- [ ] **Step 3: Write the auth layout and its stylesheet**

`apps/web/src/app/(auth)/layout.tsx`:

```tsx
import type { ReactNode } from 'react'
import styles from './auth.module.css'

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main className={styles.shell}>
      <div className={styles.card}>
        <h1 className={styles.brand}>CRDT Workspace</h1>
        {children}
      </div>
    </main>
  )
}
```

`apps/web/src/app/(auth)/auth.module.css`:

```css
.shell {
  min-height: 100vh;
  display: grid;
  place-items: center;
  padding: var(--space-5);
}

.card {
  width: 100%;
  max-width: 380px;
  display: grid;
  gap: var(--space-4);
  padding: var(--space-6);
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  box-shadow: var(--shadow);
}

.brand {
  font-size: 20px;
}

.lede {
  color: var(--text-muted);
  font-size: 14px;
}

.form {
  display: grid;
  gap: var(--space-3);
}

.error {
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--danger);
  border-radius: var(--radius-sm);
  color: var(--danger);
  font-size: 13px;
}

.hint {
  color: var(--text-muted);
  font-size: 12px;
}

.alt {
  font-size: 14px;
  color: var(--text-muted);
}
```

- [ ] **Step 4: Write the login page**

`apps/web/src/app/(auth)/login/page.tsx`:

```tsx
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/current-user'
import { safeNext } from '@/lib/safe-next'
import { LoginForm } from './LoginForm'
import styles from '../auth.module.css'

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>
}) {
  const { next } = await searchParams
  // Validated once, here. LoginForm and the signup link both receive the
  // already-safe value, so there is exactly one place this check can be missed.
  const destination = safeNext(next)

  // redirect() signals by throwing — it is deliberately outside any try/catch.
  if (await getCurrentUser()) redirect(destination)

  return (
    <>
      <p className={styles.lede}>Sign in to your workspaces.</p>
      <LoginForm next={destination} />
      <p className={styles.alt}>
        No account?{' '}
        <Link href={`/signup?next=${encodeURIComponent(destination)}`}>Create one</Link>
      </p>
    </>
  )
}
```

- [ ] **Step 5: Write the login form**

`apps/web/src/app/(auth)/login/LoginForm.tsx`:

```tsx
'use client'

import { useRouter } from 'next/navigation'
import { useState, type FormEvent } from 'react'
import { Button } from '@/components/ui/Button'
import { TextField } from '@/components/ui/TextField'
import styles from '../auth.module.css'

export function LoginForm({ next }: { next: string }) {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    // Read the form before any await: React clears event.currentTarget once the
    // handler yields, so reaching for it after the fetch would throw.
    const form = new FormData(event.currentTarget)
    setError(null)
    setPending(true)

    const response = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: form.get('email'), password: form.get('password') }),
    })

    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { error?: string } | null
      // The API returns the same 'invalid credentials' for an unknown email and a
      // wrong password, on purpose — it must not be usable to discover which
      // addresses are registered. Show its message verbatim; do not "improve" it
      // into something more specific.
      setError(body?.error ?? 'Sign in failed')
      setPending(false)
      return
    }

    // The session cookie arrives on this response. refresh() re-renders the server
    // tree with it in hand before we navigate, so the destination never flashes
    // its signed-out state.
    router.refresh()
    router.push(next)
  }

  return (
    <form className={styles.form} onSubmit={onSubmit}>
      <TextField label="Email" name="email" type="email" autoComplete="email" required />
      <TextField
        label="Password"
        name="password"
        type="password"
        autoComplete="current-password"
        required
      />
      {error && (
        <p className={styles.error} data-testid="auth-error" role="alert">
          {error}
        </p>
      )}
      <Button type="submit" variant="primary" disabled={pending} data-testid="submit">
        {pending ? 'Signing in…' : 'Sign in'}
      </Button>
    </form>
  )
}
```

- [ ] **Step 6: Run the e2e test to verify it passes**

Run: `pnpm --filter @crdt/web exec playwright test auth-flow`
Expected: PASS, 2 tests.

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add "apps/web/src/app/(auth)" apps/web/e2e/auth-flow.spec.ts
git commit -m "feat: add the sign-in page"
```

---

## Task 4: The sign-up page

**Files:**
- Create: `apps/web/src/app/(auth)/signup/page.tsx`
- Create: `apps/web/src/app/(auth)/signup/SignupForm.tsx`
- Modify: `apps/web/e2e/fixtures.ts` (add `cleanupUser`)
- Modify: `apps/web/e2e/auth-flow.spec.ts` (add the signup test)

**Interfaces:**
- Consumes: `getCurrentUser`, `safeNext` (Task 2); `Button`, `TextField` (Task 1); the `(auth)` layout and `auth.module.css` (Task 3); the existing `POST /api/auth/signup`.
- Produces: the route `/signup`, accepting `?next=<path>`. `SignupForm` takes `{ next: string }`. `cleanupUser(email: string): Promise<void>` exported from `apps/web/e2e/fixtures.ts`.

- [ ] **Step 1: Add `cleanupUser` to the e2e fixtures**

Append to `apps/web/e2e/fixtures.ts`:

```ts
/**
 * Remove a user created through the signup UI, and the personal workspace signup
 * creates for them.
 *
 * cleanup(label) cannot do this: it finds workspaces by name, and signup names
 * the workspace after the person ("Ada's workspace"), not after the test label.
 * Workspace.ownerId is a plain string column rather than a relation, so deleting
 * the user does not cascade to it either — it has to go first, explicitly.
 */
export async function cleanupUser(email: string) {
  const user = await prisma.user.findUnique({ where: { email }, select: { id: true } })
  if (!user) return
  await prisma.workspace.deleteMany({ where: { ownerId: user.id } })
  await prisma.user.delete({ where: { id: user.id } })
}
```

- [ ] **Step 2: Write the failing e2e tests**

Append to `apps/web/e2e/auth-flow.spec.ts`, and add `cleanupUser` to the existing import from `./fixtures.js`:

```ts
const NEW_EMAIL = 'e2e-auth-signup@e2e.test'

test('a new visitor can create an account and lands on the dashboard', async ({ page }) => {
  await cleanupUser(NEW_EMAIL)

  await page.goto('/signup')
  await page.getByLabel('Name').fill('Ada Lovelace')
  await page.getByLabel('Email').fill(NEW_EMAIL)
  await page.getByLabel('Password').fill('correct-horse-battery')
  await page.getByTestId('submit').click()

  await expect(page).toHaveURL('/')
  await cleanupUser(NEW_EMAIL)
})

test('a password under 12 characters is refused', async ({ page }) => {
  await page.goto('/signup')
  await page.getByLabel('Name').fill('Too Short')
  await page.getByLabel('Email').fill('e2e-auth-short@e2e.test')
  await page.getByLabel('Password').fill('short')
  await page.getByTestId('submit').click()

  await expect(page.getByTestId('auth-error')).toBeVisible()
  await expect(page).toHaveURL('/signup')
})
```

The `minLength={12}` attribute on the input would let the browser block submission before any request is sent, which would make the second test assert nothing about our code. It is therefore **not** set — the constraint is enforced by the server, and the test proves the UI surfaces the server's refusal. Step 4 makes this explicit in the source.

- [ ] **Step 3: Run them to make sure they fail**

Run: `pnpm --filter @crdt/web exec playwright test auth-flow`
Expected: the two new tests FAIL — `/signup` 404s. The two Task 3 tests still pass.

- [ ] **Step 4: Write the signup page and form**

`apps/web/src/app/(auth)/signup/page.tsx`:

```tsx
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/current-user'
import { safeNext } from '@/lib/safe-next'
import { SignupForm } from './SignupForm'
import styles from '../auth.module.css'

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>
}) {
  const { next } = await searchParams
  const destination = safeNext(next)

  if (await getCurrentUser()) redirect(destination)

  return (
    <>
      <p className={styles.lede}>Create an account. You get a workspace of your own.</p>
      <SignupForm next={destination} />
      <p className={styles.alt}>
        Already have one?{' '}
        <Link href={`/login?next=${encodeURIComponent(destination)}`}>Sign in</Link>
      </p>
    </>
  )
}
```

`apps/web/src/app/(auth)/signup/SignupForm.tsx`:

```tsx
'use client'

import { useRouter } from 'next/navigation'
import { useState, type FormEvent } from 'react'
import { Button } from '@/components/ui/Button'
import { TextField } from '@/components/ui/TextField'
import styles from '../auth.module.css'

export function SignupForm({ next }: { next: string }) {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    setError(null)
    setPending(true)

    const response = await fetch('/api/auth/signup', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: form.get('name'),
        email: form.get('email'),
        password: form.get('password'),
      }),
    })

    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { error?: string } | null
      // 409 is the one case worth rewording: 'email already registered' is the
      // API's wording for a machine, and a person needs to know what to do next.
      setError(
        response.status === 409
          ? 'That email is already registered — sign in instead.'
          : (body?.error ?? 'Sign up failed'),
      )
      setPending(false)
      return
    }

    router.refresh()
    router.push(next)
  }

  return (
    <form className={styles.form} onSubmit={onSubmit}>
      <TextField label="Name" name="name" autoComplete="name" required maxLength={80} />
      <TextField label="Email" name="email" type="email" autoComplete="email" required />
      {/*
        No minLength here on purpose. The 12-character rule belongs to the server
        (POST /api/auth/signup validates z.string().min(12)); a browser-side
        minLength would block submission before the request is sent, leaving the
        server rule untested and unproven from the outside.
      */}
      <TextField
        label="Password"
        name="password"
        type="password"
        autoComplete="new-password"
        required
      />
      <p className={styles.hint}>At least 12 characters.</p>
      {error && (
        <p className={styles.error} data-testid="auth-error" role="alert">
          {error}
        </p>
      )}
      <Button type="submit" variant="primary" disabled={pending} data-testid="submit">
        {pending ? 'Creating account…' : 'Create account'}
      </Button>
    </form>
  )
}
```

- [ ] **Step 5: Run the e2e tests to verify they pass**

Run: `pnpm --filter @crdt/web exec playwright test auth-flow`
Expected: PASS, 4 tests.

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add "apps/web/src/app/(auth)/signup" apps/web/e2e/fixtures.ts apps/web/e2e/auth-flow.spec.ts
git commit -m "feat: add the sign-up page"
```

---

## Task 5: App shell and the workspace dashboard

**Files:**
- Create: `apps/web/src/components/AppShell.tsx`
- Create: `apps/web/src/components/SignOutButton.tsx`
- Create: `apps/web/src/components/app-shell.module.css`
- Create: `apps/web/src/app/CreateWorkspaceForm.tsx`
- Create: `apps/web/src/app/dashboard.module.css`
- Modify: `apps/web/src/app/page.tsx` (replace the placeholder entirely)
- Modify: `apps/web/e2e/auth-flow.spec.ts` (add the dashboard test)

**Interfaces:**
- Consumes: `getCurrentUser` (Task 2); `Button`, `Panel` (Task 1); `colorFor` from `@/lib/color` (existing); `prisma` from `@crdt/db`; the existing `POST /api/workspaces` and `POST /api/auth/logout`.
- Produces:
  - `AppShell` — `({ user: SessionUser; breadcrumb?: ReactNode; children: ReactNode }) => JSX.Element`, from `@/components/AppShell`. Server component. Tasks 6 and 8 use it.
  - `SignOutButton` — `() => JSX.Element`, from `@/components/SignOutButton`. Client component.
  - `CreateWorkspaceForm` — `() => JSX.Element`, from `./CreateWorkspaceForm`.
  - The route `/`, rendering the signed-in dashboard.
  - Test ids: `current-user`, `sign-out`, `workspace-<id>`, `create-workspace`, `workspace-name`.

The shell has no deliverable of its own — it is the dashboard's frame — so it is built here rather than in a task of its own.

- [ ] **Step 1: Write the failing e2e test**

Append to `apps/web/e2e/auth-flow.spec.ts`:

```ts
test('the dashboard lists the workspaces you belong to and can create another', async ({
  page,
}) => {
  const label = `${LABEL}-dash`
  const { owner, workspace } = await seedWorkspace(label)

  await page.goto('/login')
  await page.getByLabel('Email').fill(owner.email)
  await page.getByLabel('Password').fill(E2E_PASSWORD)
  await page.getByTestId('submit').click()

  await expect(page).toHaveURL('/')
  await expect(page.getByTestId('current-user')).toHaveText('Owner')
  await expect(page.getByTestId(`workspace-${workspace.id}`)).toContainText(label)

  await page.getByTestId('workspace-name').fill(`${label}-second`)
  await page.getByTestId('create-workspace').click()
  await expect(page.getByText(`${label}-second`)).toBeVisible()

  await page.getByTestId('sign-out').click()
  await expect(page).toHaveURL('/login')

  await cleanup(label)
  await cleanup(`${label}-second`)
})

test('signing out, then visiting the dashboard, sends you back to sign-in', async ({ page }) => {
  await page.goto('/')
  await expect(page).toHaveURL(/\/login/)
})
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `pnpm --filter @crdt/web exec playwright test auth-flow`
Expected: the two new tests FAIL — `/` renders the "CRDT Workspace" placeholder, so `current-user` is absent and an unauthenticated visit does not redirect.

- [ ] **Step 3: Write `app-shell.module.css`**

```css
.shell {
  min-height: 100vh;
  display: grid;
  grid-template-rows: auto 1fr;
}

.header {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-3) var(--space-5);
  background: var(--surface);
  border-bottom: 1px solid var(--border);
}

.brand {
  font-weight: 600;
  color: var(--text);
}

.brand:hover {
  text-decoration: none;
  color: var(--accent);
}

.breadcrumb {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  color: var(--text-muted);
  font-size: 14px;
  min-width: 0;
}

.spacer {
  flex: 1;
}

.avatar {
  display: grid;
  place-items: center;
  width: 26px;
  height: 26px;
  border-radius: 999px;
  color: #fff;
  font-size: 12px;
  font-weight: 600;
}

.userName {
  font-size: 14px;
  color: var(--text-muted);
}

.content {
  padding: var(--space-5);
}
```

- [ ] **Step 4: Write `SignOutButton.tsx`**

```tsx
'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { Button } from './ui/Button'

export function SignOutButton() {
  const router = useRouter()
  const [pending, setPending] = useState(false)

  return (
    <Button
      variant="secondary"
      data-testid="sign-out"
      disabled={pending}
      onClick={async () => {
        setPending(true)
        // POST /api/auth/logout replies 204 with an expiring cookie. refresh()
        // drops the server tree that was rendered for the old session before we
        // navigate, so no signed-in data stays on screen after sign-out.
        await fetch('/api/auth/logout', { method: 'POST' })
        router.refresh()
        router.push('/login')
      }}
    >
      Sign out
    </Button>
  )
}
```

- [ ] **Step 5: Write `AppShell.tsx`**

```tsx
import Link from 'next/link'
import type { ReactNode } from 'react'
import { colorFor } from '@/lib/color'
import type { SessionUser } from '@/lib/current-user'
import { SignOutButton } from './SignOutButton'
import styles from './app-shell.module.css'

export function AppShell({
  user,
  breadcrumb,
  children,
}: {
  user: SessionUser
  breadcrumb?: ReactNode
  children: ReactNode
}) {
  return (
    <div className={styles.shell}>
      <header className={styles.header}>
        <Link className={styles.brand} href="/">
          CRDT Workspace
        </Link>
        {breadcrumb && <nav className={styles.breadcrumb}>{breadcrumb}</nav>}
        <div className={styles.spacer} />
        {/*
          colorFor is the same helper the presence cursors use, so the colour on
          your avatar here is the colour collaborators see next to your edits.
        */}
        <span
          className={styles.avatar}
          style={{ background: colorFor(user.id) }}
          aria-hidden="true"
        >
          {user.name.slice(0, 1).toUpperCase()}
        </span>
        <span className={styles.userName} data-testid="current-user">
          {user.name}
        </span>
        <SignOutButton />
      </header>
      <div className={styles.content}>{children}</div>
    </div>
  )
}
```

- [ ] **Step 6: Write `dashboard.module.css`**

```css
.page {
  max-width: 820px;
  margin: 0 auto;
  display: grid;
  gap: var(--space-5);
}

.list {
  display: grid;
  gap: var(--space-2);
}

.item {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-3);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  color: var(--text);
}

.item:hover {
  border-color: var(--border-strong);
  background: var(--bg);
  text-decoration: none;
}

.itemName {
  font-weight: 500;
}

.itemMeta {
  color: var(--text-muted);
  font-size: 13px;
}

.spacer {
  flex: 1;
}

.inlineForm {
  display: flex;
  align-items: end;
  gap: var(--space-2);
}

.inlineFormField {
  flex: 1;
}
```

- [ ] **Step 7: Write `CreateWorkspaceForm.tsx`**

```tsx
'use client'

import { useRouter } from 'next/navigation'
import { useState, type FormEvent } from 'react'
import { Button } from '@/components/ui/Button'
import { TextField } from '@/components/ui/TextField'
import styles from './dashboard.module.css'

export function CreateWorkspaceForm() {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    const name = String(new FormData(form).get('name') ?? '').trim()
    if (!name) return
    setError(null)
    setPending(true)

    const response = await fetch('/api/workspaces', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name }),
    })
    setPending(false)

    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { error?: string } | null
      setError(body?.error ?? 'Could not create that workspace')
      return
    }

    form.reset()
    // The list is server-rendered, so refresh() is what makes the new workspace
    // appear — there is no client-side copy of it to update.
    router.refresh()
  }

  return (
    <>
      <form className={styles.inlineForm} onSubmit={onSubmit}>
        <div className={styles.inlineFormField}>
          <TextField
            label="New workspace"
            name="name"
            placeholder="Design team"
            maxLength={120}
            required
            data-testid="workspace-name"
          />
        </div>
        <Button type="submit" disabled={pending} data-testid="create-workspace">
          {pending ? 'Creating…' : 'Create'}
        </Button>
      </form>
      {error && (
        <p role="alert" data-testid="workspace-error">
          {error}
        </p>
      )}
    </>
  )
}
```

- [ ] **Step 8: Replace `page.tsx` with the dashboard**

```tsx
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { prisma } from '@crdt/db'
import { getCurrentUser } from '@/lib/current-user'
import { AppShell } from '@/components/AppShell'
import { Panel } from '@/components/ui/Panel'
import { CreateWorkspaceForm } from './CreateWorkspaceForm'
import styles from './dashboard.module.css'
import ui from '@/components/ui/ui.module.css'

export default async function HomePage() {
  const user = await getCurrentUser()
  if (!user) redirect('/login')

  // Read through the membership table rather than listing workspaces and filtering:
  // a workspace you are not a member of is never loaded in the first place, which is
  // the same rule requireWorkspaceRole enforces on every API route.
  const memberships = await prisma.workspaceMember.findMany({
    where: { userId: user.id },
    select: {
      role: true,
      workspace: {
        select: { id: true, name: true, _count: { select: { documents: true } } },
      },
    },
    orderBy: { workspace: { name: 'asc' } },
  })

  return (
    <AppShell user={user}>
      <div className={styles.page}>
        <Panel title="Your workspaces">
          {memberships.length === 0 ? (
            <p className={ui.empty}>
              No workspaces yet. Create one below and it is yours to share.
            </p>
          ) : (
            <div className={styles.list}>
              {memberships.map(({ role, workspace }) => (
                <Link
                  key={workspace.id}
                  href={`/workspaces/${workspace.id}`}
                  className={styles.item}
                  data-testid={`workspace-${workspace.id}`}
                >
                  <span className={styles.itemName}>{workspace.name}</span>
                  <span className={styles.itemMeta}>
                    {workspace._count.documents}{' '}
                    {workspace._count.documents === 1 ? 'document' : 'documents'}
                  </span>
                  <span className={styles.spacer} />
                  <span className={ui.badge}>{role}</span>
                </Link>
              ))}
            </div>
          )}
        </Panel>

        <Panel title="Create a workspace">
          <CreateWorkspaceForm />
        </Panel>
      </div>
    </AppShell>
  )
}
```

- [ ] **Step 9: Run the e2e tests to verify they pass**

Run: `pnpm --filter @crdt/web exec playwright test auth-flow`
Expected: PASS, 6 tests.

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add apps/web/src/components apps/web/src/app/page.tsx apps/web/src/app/CreateWorkspaceForm.tsx apps/web/src/app/dashboard.module.css apps/web/e2e/auth-flow.spec.ts
git commit -m "feat: add the app shell and workspace dashboard"
```

---

## Task 6: Workspace detail page and document creation

**Files:**
- Create: `apps/web/src/app/workspaces/[id]/page.tsx`
- Create: `apps/web/src/app/workspaces/[id]/CreateDocumentForm.tsx`
- Create: `apps/web/src/app/workspaces/[id]/workspace.module.css`
- Modify: `apps/web/e2e/auth-flow.spec.ts`

**Interfaces:**
- Consumes: `getCurrentUser` (Task 2); `AppShell` (Task 5); `Panel`, `Button`, `TextField` (Task 1); `requireWorkspaceRole`, `HttpError` from `@/lib/auth-guard` (existing); the existing `POST /api/workspaces/:id/documents`.
- Produces:
  - The route `/workspaces/:id`.
  - `CreateDocumentForm` — `({ workspaceId }: { workspaceId: string }) => JSX.Element`.
  - Test ids: `document-<id>`, `document-title`, `document-type`, `create-document`.
  - The page renders a `MembersPanel` slot that Task 7 fills; this task leaves that area out entirely.

- [ ] **Step 1: Write the failing e2e test**

Append to `apps/web/e2e/auth-flow.spec.ts`. Add `createDocument` to the existing `./fixtures.js` import.

```ts
test('a workspace page lists its documents and can create a board', async ({ page }) => {
  const label = `${LABEL}-ws`
  const { owner, workspace } = await seedWorkspace(label)
  const existing = await createDocument(workspace.id, 'doc')

  await page.goto('/login')
  await page.getByLabel('Email').fill(owner.email)
  await page.getByLabel('Password').fill(E2E_PASSWORD)
  await page.getByTestId('submit').click()
  await expect(page).toHaveURL('/')

  await page.getByTestId(`workspace-${workspace.id}`).click()
  await expect(page).toHaveURL(`/workspaces/${workspace.id}`)
  await expect(page.getByTestId(`document-${existing.id}`)).toContainText('e2e doc')

  await page.getByTestId('document-title').fill('Launch board')
  await page.getByTestId('document-type').selectOption('board')
  await page.getByTestId('create-document').click()
  await expect(page.getByText('Launch board')).toBeVisible()

  await cleanup(label)
})

test('a workspace you are not a member of is not found, not forbidden', async ({ page }) => {
  const mine = `${LABEL}-mine`
  const theirs = `${LABEL}-theirs`
  const { owner } = await seedWorkspace(mine)
  const other = await seedWorkspace(theirs)

  await page.goto('/login')
  await page.getByLabel('Email').fill(owner.email)
  await page.getByLabel('Password').fill(E2E_PASSWORD)
  await page.getByTestId('submit').click()
  await expect(page).toHaveURL('/')

  // 404, never 403: a 403 would confirm the id exists to somebody with no access
  // to it, which is the rule requireWorkspaceRole already enforces on the API.
  const response = await page.goto(`/workspaces/${other.workspace.id}`)
  expect(response?.status()).toBe(404)

  await cleanup(mine)
  await cleanup(theirs)
})
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `pnpm --filter @crdt/web exec playwright test auth-flow`
Expected: the two new tests FAIL — `/workspaces/:id` 404s for every id, so the first test cannot find the document list. (The second test would pass for the wrong reason: everything 404s right now. Step 5 is what makes it meaningful, once the route exists and only non-members get a 404.)

- [ ] **Step 3: Write `workspace.module.css`**

```css
.page {
  max-width: 820px;
  margin: 0 auto;
  display: grid;
  gap: var(--space-5);
}

.list {
  display: grid;
  gap: var(--space-2);
}

.item {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-3);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
  color: var(--text);
}

.item:hover {
  border-color: var(--border-strong);
  background: var(--bg);
  text-decoration: none;
}

.itemName {
  font-weight: 500;
}

.spacer {
  flex: 1;
}

.form {
  display: flex;
  align-items: end;
  gap: var(--space-2);
}

.formField {
  flex: 1;
}

.select {
  padding: 9px 12px;
  background: var(--surface);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-sm);
  font-size: 14px;
}

.memberRow {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-2) 0;
  border-bottom: 1px solid var(--border);
}

.memberRow:last-child {
  border-bottom: none;
}

.memberEmail {
  color: var(--text-muted);
  font-size: 13px;
}
```

The `.member*` classes are written here so Task 7 does not have to reopen this stylesheet.

- [ ] **Step 4: Write `CreateDocumentForm.tsx`**

```tsx
'use client'

import { useRouter } from 'next/navigation'
import { useState, type FormEvent } from 'react'
import { Button } from '@/components/ui/Button'
import { TextField } from '@/components/ui/TextField'
import styles from './workspace.module.css'
import ui from '@/components/ui/ui.module.css'

export function CreateDocumentForm({ workspaceId }: { workspaceId: string }) {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    const data = new FormData(form)
    const title = String(data.get('title') ?? '').trim()
    if (!title) return
    setError(null)
    setPending(true)

    const response = await fetch(`/api/workspaces/${workspaceId}/documents`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title, type: data.get('type') }),
    })
    setPending(false)

    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { error?: string } | null
      setError(
        response.status === 403
          ? 'You need the editor role to create documents here.'
          : (body?.error ?? 'Could not create that document'),
      )
      return
    }

    form.reset()
    router.refresh()
  }

  return (
    <>
      <form className={styles.form} onSubmit={onSubmit}>
        <div className={styles.formField}>
          <TextField
            label="Title"
            name="title"
            placeholder="Q3 roadmap"
            maxLength={200}
            required
            data-testid="document-title"
          />
        </div>
        <select
          name="type"
          className={styles.select}
          defaultValue="doc"
          aria-label="Document type"
          data-testid="document-type"
        >
          <option value="doc">Document</option>
          <option value="board">Board</option>
        </select>
        <Button type="submit" disabled={pending} data-testid="create-document">
          {pending ? 'Creating…' : 'Create'}
        </Button>
      </form>
      {error && (
        <p className={ui.error} role="alert" data-testid="document-error">
          {error}
        </p>
      )}
    </>
  )
}
```

- [ ] **Step 5: Write the workspace page**

`apps/web/src/app/workspaces/[id]/page.tsx`:

```tsx
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { prisma } from '@crdt/db'
import type { Role } from '@crdt/shared/types'
import { getCurrentUser } from '@/lib/current-user'
import { HttpError, requireWorkspaceRole } from '@/lib/auth-guard'
import { AppShell } from '@/components/AppShell'
import { Panel } from '@/components/ui/Panel'
import { CreateDocumentForm } from './CreateDocumentForm'
import styles from './workspace.module.css'
import ui from '@/components/ui/ui.module.css'

export default async function WorkspacePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const user = await getCurrentUser()
  // Outside any try/catch — redirect() signals by throwing.
  if (!user) redirect(`/login?next=${encodeURIComponent(`/workspaces/${id}`)}`)

  let role: Role
  try {
    role = await requireWorkspaceRole(user.id, id, 'viewer')
  } catch (error) {
    // requireWorkspaceRole already returns 404 rather than 403 for a workspace the
    // caller cannot see, so a non-member and a nonexistent id are indistinguishable
    // from out here — which is the point.
    if (error instanceof HttpError && error.status === 404) notFound()
    throw error
  }

  const workspace = await prisma.workspace.findUnique({
    where: { id },
    select: {
      name: true,
      documents: {
        select: { id: true, title: true, type: true },
        orderBy: { createdAt: 'asc' },
      },
    },
  })
  if (!workspace) notFound()

  const canCreate = role === 'owner' || role === 'editor'

  return (
    <AppShell user={user} breadcrumb={<span>{workspace.name}</span>}>
      <div className={styles.page}>
        <Panel title="Documents" action={<span className={ui.badge}>{role}</span>}>
          {workspace.documents.length === 0 ? (
            <p className={ui.empty}>No documents yet.</p>
          ) : (
            <div className={styles.list}>
              {workspace.documents.map((document) => (
                <Link
                  key={document.id}
                  href={`/documents/${document.id}`}
                  className={styles.item}
                  data-testid={`document-${document.id}`}
                >
                  <span className={styles.itemName}>{document.title}</span>
                  <span className={styles.spacer} />
                  <span className={ui.badge}>{document.type}</span>
                </Link>
              ))}
            </div>
          )}
        </Panel>

        {canCreate && (
          <Panel title="New document">
            <CreateDocumentForm workspaceId={id} />
          </Panel>
        )}
      </div>
    </AppShell>
  )
}
```

The create panel is hidden for a `viewer` because the server would refuse the request anyway — hiding it is a courtesy, not the control. The control is `requireWorkspaceRole(user.id, workspaceId, 'editor')` inside the route handler, which this UI cannot bypass.

- [ ] **Step 6: Run the e2e tests to verify they pass**

Run: `pnpm --filter @crdt/web exec playwright test auth-flow`
Expected: PASS, 8 tests.

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add "apps/web/src/app/workspaces" apps/web/e2e/auth-flow.spec.ts
git commit -m "feat: add the workspace page with document creation"
```

---

## Task 7: Members panel

**Files:**
- Create: `apps/web/src/app/workspaces/[id]/MembersPanel.tsx`
- Modify: `apps/web/src/app/workspaces/[id]/page.tsx` (load members, render the panel)
- Modify: `apps/web/e2e/auth-flow.spec.ts`

**Interfaces:**
- Consumes: `Panel`, `Button`, `TextField` (Task 1); the workspace page (Task 6); the existing `POST /api/workspaces/:id/members`; `addMember` from `apps/web/e2e/fixtures.ts`.
- Produces:
  - `MembersPanel` — `({ workspaceId, members, canManage }: { workspaceId: string; members: Array<{ id: string; name: string; email: string; role: Role }>; canManage: boolean }) => JSX.Element`, from `./MembersPanel`.
  - Test ids: `member-<userId>`, `member-email`, `member-role`, `add-member`, `member-error`.

**Why members are rendered from the page's own query rather than a new `GET /api/…/members` route:** the page is already a Server Component holding an authorized Prisma connection, so a fetch route would be a second copy of the same authorization check with an extra network hop. The panel is a client component only because it owns a form. This closes the spec §2 happy-path step *"Invites a second user as `editor`."*

- [ ] **Step 1: Write the failing e2e test**

Append to `apps/web/e2e/auth-flow.spec.ts`. Add `addMember` to the existing `./fixtures.js` import.

```ts
test('an owner sees the member list and can invite an existing user', async ({ page }) => {
  const label = `${LABEL}-members`
  const { owner, workspace } = await seedWorkspace(label)
  const invitee = await addMember(workspace.id, `${label}-pre`, 'viewer')
  // Someone who exists but is not yet in this workspace.
  const outsider = await seedWorkspace(`${label}-outsider`)

  await page.goto('/login')
  await page.getByLabel('Email').fill(owner.email)
  await page.getByLabel('Password').fill(E2E_PASSWORD)
  await page.getByTestId('submit').click()
  await page.goto(`/workspaces/${workspace.id}`)

  await expect(page.getByTestId(`member-${invitee.id}`)).toContainText('viewer')

  await page.getByTestId('member-email').fill(outsider.owner.email)
  await page.getByTestId('member-role').selectOption('editor')
  await page.getByTestId('add-member').click()

  await expect(page.getByTestId(`member-${outsider.owner.id}`)).toContainText('editor')

  await cleanup(label)
  await cleanup(`${label}-outsider`)
})

test('inviting an email with no account explains the problem', async ({ page }) => {
  const label = `${LABEL}-noaccount`
  const { owner, workspace } = await seedWorkspace(label)

  await page.goto('/login')
  await page.getByLabel('Email').fill(owner.email)
  await page.getByLabel('Password').fill(E2E_PASSWORD)
  await page.getByTestId('submit').click()
  await page.goto(`/workspaces/${workspace.id}`)

  await page.getByTestId('member-email').fill('nobody-at-all@e2e.test')
  await page.getByTestId('add-member').click()

  // The API returns a bare 404 here. Shown raw it reads as "page not found",
  // which is the wrong story entirely — the panel has to translate it.
  await expect(page.getByTestId('member-error')).toContainText('No account')

  await cleanup(label)
})
```

- [ ] **Step 2: Run them to make sure they fail**

Run: `pnpm --filter @crdt/web exec playwright test auth-flow`
Expected: the two new tests FAIL — there is no member list and no `member-email` field on the page.

- [ ] **Step 3: Write `MembersPanel.tsx`**

```tsx
'use client'

import { useRouter } from 'next/navigation'
import { useState, type FormEvent } from 'react'
import type { Role } from '@crdt/shared/types'
import { Button } from '@/components/ui/Button'
import { TextField } from '@/components/ui/TextField'
import styles from './workspace.module.css'
import ui from '@/components/ui/ui.module.css'

export type WorkspaceMemberView = { id: string; name: string; email: string; role: Role }

export function MembersPanel({
  workspaceId,
  members,
  canManage,
}: {
  workspaceId: string
  members: WorkspaceMemberView[]
  canManage: boolean
}) {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    const data = new FormData(form)
    const email = String(data.get('email') ?? '').trim()
    if (!email) return
    setError(null)
    setPending(true)

    const response = await fetch(`/api/workspaces/${workspaceId}/members`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, role: data.get('role') }),
    })
    setPending(false)

    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { error?: string } | null
      // 404 here means "no user with that email" — the route looks the invitee up
      // before touching the workspace. Rendering its literal 'not found' would read
      // as a missing page, so it gets translated. 400 is the last-owner guard, whose
      // own message is already clear enough to show as-is.
      setError(
        response.status === 404
          ? `No account is registered to ${email}. They need to sign up first.`
          : (body?.error ?? 'Could not update that member'),
      )
      return
    }

    form.reset()
    router.refresh()
  }

  return (
    <>
      <div>
        {members.map((member) => (
          <div key={member.id} className={styles.memberRow} data-testid={`member-${member.id}`}>
            <span className={styles.itemName}>{member.name}</span>
            <span className={styles.memberEmail}>{member.email}</span>
            <span className={styles.spacer} />
            <span className={ui.badge}>{member.role}</span>
          </div>
        ))}
      </div>

      {canManage && (
        <form className={styles.form} onSubmit={onSubmit} style={{ marginTop: 'var(--space-4)' }}>
          <div className={styles.formField}>
            <TextField
              label="Invite by email"
              name="email"
              type="email"
              placeholder="teammate@company.com"
              required
              data-testid="member-email"
            />
          </div>
          <select
            name="role"
            className={styles.select}
            defaultValue="editor"
            aria-label="Role"
            data-testid="member-role"
          >
            <option value="viewer">Viewer</option>
            <option value="editor">Editor</option>
            <option value="owner">Owner</option>
          </select>
          <Button type="submit" disabled={pending} data-testid="add-member">
            {pending ? 'Adding…' : 'Add'}
          </Button>
        </form>
      )}

      {error && (
        <p className={ui.error} role="alert" data-testid="member-error" style={{ marginTop: 'var(--space-3)' }}>
          {error}
        </p>
      )}
    </>
  )
}
```

The form submits an existing role for an existing member too — `POST /api/workspaces/:id/members` is an upsert, so inviting someone already present changes their role. That is the route's designed behaviour, not a workaround.

- [ ] **Step 4: Load members in the workspace page and render the panel**

In `apps/web/src/app/workspaces/[id]/page.tsx`:

Add the import:

```tsx
import { MembersPanel } from './MembersPanel'
```

Extend the `prisma.workspace.findUnique` `select` with the members relation:

```tsx
  const workspace = await prisma.workspace.findUnique({
    where: { id },
    select: {
      name: true,
      documents: {
        select: { id: true, title: true, type: true },
        orderBy: { createdAt: 'asc' },
      },
      members: {
        select: { role: true, user: { select: { id: true, name: true, email: true } } },
        orderBy: { user: { name: 'asc' } },
      },
    },
  })
```

Add the panel after the "New document" panel, inside `<div className={styles.page}>`:

```tsx
        <Panel title="Members">
          <MembersPanel
            workspaceId={id}
            members={workspace.members.map((member) => ({
              id: member.user.id,
              name: member.user.name,
              email: member.user.email,
              role: member.role,
            }))}
            canManage={role === 'owner'}
          />
        </Panel>
```

Every member sees the list; only an owner sees the invite form, matching the route's own `requireWorkspaceRole(user.id, workspaceId, 'owner')`.

- [ ] **Step 5: Run the e2e tests to verify they pass**

Run: `pnpm --filter @crdt/web exec playwright test auth-flow`
Expected: PASS, 10 tests.

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add "apps/web/src/app/workspaces" apps/web/e2e/auth-flow.spec.ts
git commit -m "feat: add the workspace members panel"
```

---

## Task 8: Document page chrome and the sign-in redirect

**Files:**
- Modify: `apps/web/src/app/documents/[id]/page.tsx`
- Modify: `apps/web/src/app/documents/[id]/DocumentClient.tsx`
- Create: `apps/web/src/app/documents/[id]/document.module.css`
- Modify: `apps/web/e2e/auth-flow.spec.ts`

**Interfaces:**
- Consumes: `getCurrentUser` (Task 2); `requireDocumentRole`, `HttpError`, `colorFor` (existing); `prisma`.
- Produces: `DocumentClient` gains three props — `title: string`, `workspace: { id: string; name: string }`, `role: Role` — alongside the existing `documentId`, `type`, `readOnly`, `user`.

**This task removes the message that started all of this.** `page.tsx` currently renders *"This build has no sign-in page; authenticate via the API directly (see README)."* There is a sign-in page now, so the page redirects to it.

**Read the Global Constraints again before touching `DocumentClient.tsx`.** `data-testid="status"` must keep rendering the status string as its exact and only text, and `data-testid="read-only"` must keep appearing only for a `viewer`. `apps/web/e2e/collaboration.spec.ts` asserts both, and it passes today.

- [ ] **Step 1: Write the failing e2e test**

Append to `apps/web/e2e/auth-flow.spec.ts`:

```ts
test('an unauthenticated visit to a document returns to it after signing in', async ({ page }) => {
  const label = `${LABEL}-doc`
  const { owner, workspace } = await seedWorkspace(label)
  const document = await createDocument(workspace.id, 'board')

  await page.goto(`/documents/${document.id}`)
  // Not a bare 404, and not a dead-end message — the login page, carrying the
  // destination so signing in lands back on the document that was asked for.
  await expect(page).toHaveURL(`/login?next=${encodeURIComponent(`/documents/${document.id}`)}`)

  await page.getByLabel('Email').fill(owner.email)
  await page.getByLabel('Password').fill(E2E_PASSWORD)
  await page.getByTestId('submit').click()

  await expect(page).toHaveURL(`/documents/${document.id}`)
  await expect(page.getByTestId('document-title')).toHaveText('e2e board')
  await expect(page.getByTestId('workspace-link')).toHaveText(label)
  await expect(page.getByTestId('role')).toHaveText('owner')

  await cleanup(label)
})
```

`document-title` is reused here as a heading test id; the create form in Task 6 uses the same id on its input, but the two never appear on the same page.

- [ ] **Step 2: Run it to make sure it fails**

Run: `pnpm --filter @crdt/web exec playwright test auth-flow`
Expected: FAIL — the document page renders the "no sign-in page" message instead of redirecting.

- [ ] **Step 3: Write `document.module.css`**

```css
.header {
  display: flex;
  align-items: center;
  gap: var(--space-3);
  padding: var(--space-3) var(--space-4);
  background: var(--surface);
  border-bottom: 1px solid var(--border);
}

.back {
  color: var(--text-muted);
  font-size: 14px;
}

.title {
  font-size: 16px;
  font-weight: 600;
}

.spacer {
  flex: 1;
}

.status {
  font-size: 13px;
  color: var(--text-muted);
}

.status[data-status='connected'] {
  color: #16a34a;
}

.status[data-status='disconnected'],
.status[data-status='fatal'] {
  color: var(--danger);
}

.readOnly {
  font-size: 13px;
  color: var(--danger);
}
```

- [ ] **Step 4: Rewrite `page.tsx`**

```tsx
import { notFound, redirect } from 'next/navigation'
import { prisma } from '@crdt/db'
import type { Role } from '@crdt/shared/types'
import { requireDocumentRole, HttpError } from '@/lib/auth-guard'
import { getCurrentUser } from '@/lib/current-user'
import { colorFor } from '@/lib/color'
import { DocumentClient } from './DocumentClient'

export default async function DocumentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const user = await getCurrentUser()
  // There is a sign-in page now, so send them to it with the destination attached
  // rather than rendering a dead end. Outside any try/catch: redirect() throws.
  if (!user) redirect(`/login?next=${encodeURIComponent(`/documents/${id}`)}`)

  // Declared with an explicit type: `let role, type` would be implicitly `any`
  // under this repo's strict compiler settings.
  let access: { role: Role; workspaceId: string; type: 'doc' | 'board' }
  try {
    access = await requireDocumentRole(user.id, id, 'viewer')
  } catch (error) {
    if (error instanceof HttpError && error.status === 404) notFound()
    throw error
  }
  const { role, type } = access

  // Display data only, and only after the role check has passed.
  const document = await prisma.document.findUnique({
    where: { id },
    select: { title: true, workspace: { select: { id: true, name: true } } },
  })
  if (!document) notFound()

  return (
    <DocumentClient
      documentId={id}
      type={type}
      role={role}
      readOnly={role === 'viewer'}
      title={document.title}
      workspace={document.workspace}
      user={{ name: user.name, color: colorFor(user.id) }}
    />
  )
}
```

- [ ] **Step 5: Rewrite `DocumentClient.tsx`**

```tsx
'use client'

import Link from 'next/link'
import type { Role } from '@crdt/shared/types'
import { useCollaborativeDoc } from '@/hooks/use-doc'
import { useAnnouncePresence, usePresence } from '@/hooks/use-presence'
import { Board } from '@/components/Board'
import { Editor } from '@/components/Editor'
import { Presence } from '@/components/Presence'
import styles from './document.module.css'
import ui from '@/components/ui/ui.module.css'

export function DocumentClient({
  documentId,
  type,
  role,
  readOnly,
  title,
  workspace,
  user,
}: {
  documentId: string
  type: 'doc' | 'board'
  role: Role
  readOnly: boolean
  title: string
  workspace: { id: string; name: string }
  user: { name: string; color: string }
}) {
  const { doc, provider, status } = useCollaborativeDoc(documentId)
  const presence = usePresence(provider)
  useAnnouncePresence(provider, user)

  return (
    <main>
      <header className={styles.header}>
        <Link className={styles.back} href={`/workspaces/${workspace.id}`} data-testid="workspace-link">
          {workspace.name}
        </Link>
        <h1 className={styles.title} data-testid="document-title">
          {title}
        </h1>
        <span className={ui.badge} data-testid="role">
          {role}
        </span>
        <div className={styles.spacer} />
        <Presence users={presence} />
        {/*
          collaboration.spec.ts asserts getByTestId('status') toHaveText('connected').
          The status string stays this element's entire text content — the colour
          comes from the data-status attribute, not from any extra markup.
        */}
        <span className={styles.status} data-status={status} data-testid="status">
          {status}
        </span>
        {readOnly && (
          <strong className={styles.readOnly} data-testid="read-only">
            read only
          </strong>
        )}
      </header>

      {doc && provider && type === 'doc' && (
        <Editor doc={doc} provider={provider} user={user} readOnly={readOnly} />
      )}
      {doc && type === 'board' && <Board doc={doc} provider={provider} readOnly={readOnly} />}
    </main>
  )
}
```

- [ ] **Step 6: Run the e2e test to verify it passes**

Run: `pnpm --filter @crdt/web exec playwright test auth-flow`
Expected: PASS, 11 tests.

- [ ] **Step 7: Verify the collaboration suite did not regress**

Start the sync server in a second terminal first — `collaboration.spec.ts` needs it, and Playwright's `webServer` block only starts the web app:

```bash
pnpm --filter @crdt/sync dev
```

Run: `pnpm --filter @crdt/web exec playwright test collaboration`
Expected: PASS, 4 tests — the same 4 that passed before this plan started. If `status` or `read-only` broke, this is where it shows.

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add "apps/web/src/app/documents" apps/web/e2e/auth-flow.spec.ts
git commit -m "feat: give the document page real chrome and a sign-in redirect"
```

---

## Task 9: Full-suite verification and README update

**Files:**
- Modify: `README.md`

**Interfaces:**
- Consumes: everything above.
- Produces: nothing importable.

The README currently tells a reader to authenticate by hand against the API, because that was the only way in. It is now wrong, and a wrong README is worse than none.

- [ ] **Step 1: Run the entire Vitest suite**

Run: `pnpm test`
Expected: PASS — the pre-existing tests plus the 12 added in Task 2.

- [ ] **Step 2: Run the entire Playwright suite**

With the sync server running (`pnpm --filter @crdt/sync dev`):

Run: `pnpm --filter @crdt/web exec playwright test`
Expected: PASS — 4 collaboration tests plus 11 auth-flow tests.

- [ ] **Step 3: Typecheck and production build**

Run: `pnpm typecheck`
Expected: PASS.

Run: `pnpm --filter @crdt/web build`
Expected: build completes with the new routes listed — `/`, `/login`, `/signup`, `/workspaces/[id]`, `/documents/[id]`.

- [ ] **Step 4: Correct the README**

Two passages are now false. Fix both.

**4a.** Around `README.md:18`, replace this paragraph:

```markdown
There is currently no sign-in *form* — see [What I deliberately did not
build](#what-i-deliberately-did-not-build) — so exercising the demo today means
either using the seeded demo credentials against the API directly, or running it
locally where the Playwright fixtures set a session cookie for you.
```

with:

```markdown
### Using the app

1. Start Postgres, the sync server, and the web app (above).
2. Open <http://localhost:3000>. You will be sent to the sign-in page.
3. Choose **Create one** to sign up. Passwords must be at least 12 characters.
   Signing up gives you a workspace of your own.
4. From the dashboard, open your workspace, create a document or a board, and
   open it.
5. To collaborate, invite a teammate from the workspace's **Members** panel.
   They must have signed up first — invitations are by email address of an
   existing account, and there is no invitation email.

Roles are `owner`, `editor`, and `viewer`. A viewer's edits are rejected at the
sync server, not just hidden in the UI.
```

**4b.** In the **"What I deliberately did not build"** section (around `README.md:134`), delete the entire **"A sign-in form."** bullet — it is no longer a cut. Leave every other bullet in that section untouched; update-log pruning, member removal, and the rest are all still genuinely unbuilt.

- [ ] **Step 5: Commit**

```bash
git add README.md
git commit -m "docs: replace the API sign-in workaround with the real sign-in flow"
```

---

## Self-Review

**1. Spec coverage.** Spec §2's happy path, step by step: *"User signs up, lands in a workspace they own"* — Task 4 plus the existing signup route's nested workspace create. *"Creates a board"* — Task 6. *"Invites a second user as `editor`"* — Task 7. *"Both open the board"* — Task 8's redirect plus the existing document page. Steps 4–6 (sub-200ms propagation, presence, offline merge) were built in the original plan and are untouched here; Task 8 Step 7 re-runs `collaboration.spec.ts` to prove it. The spec's out-of-scope list is respected: no SSO, no password reset, no email verification, no version-history UI, no mobile work beyond a max-width container.

**2. Placeholder scan.** No "TBD", no "add appropriate error handling", no "similar to Task N". Every code step carries the literal content to write. Task 9 Step 4 says "find the passage and replace it" rather than quoting the current README verbatim — the replacement text is given in full, and there is a stated fallback if the passage is absent.

**3. Type consistency.**
- `SessionUser` is defined in Task 2 and consumed by `AppShell` (Task 5). Same shape as `requireUser`'s return: `{ id, email, name }`.
- `safeNext(next, fallback = '/')` — Tasks 3 and 4 call the one-argument form; the two-argument form is only exercised by its own test. Consistent.
- `Button` takes `variant?: 'primary' | 'secondary' | 'danger'`; `'danger'` is defined and styled but unused by any task. Kept: it costs four CSS lines and the member-removal route this project has parked will want it. If a reviewer objects, deleting it is a one-line change.
- `Panel` takes `{ title?, action?, children }`. Every call site passes `title`; Tasks 6 and 7 also pass `action`. Consistent.
- `DocumentClient`'s prop list is extended in exactly one place (Task 8) and both its definition and its single call site change in the same task.
- Prisma relation names used — `Workspace.documents`, `Workspace.members`, `WorkspaceMember.user`, `Workspace._count.documents` — all verified against `packages/db/prisma/schema.prisma`.
- `Role` is imported from `@crdt/shared/types` in Tasks 6, 7, and 8, matching the existing convention in `auth-guard.ts` and the members route.
- Test ids: `submit` and `auth-error` are shared by the login and signup forms, which never render together. `document-title` is a form input in Task 6 and a heading in Task 8, also never together.

**4. Ordering.** Each task's e2e test passes at the end of that task. The one exception is Task 3's first test asserting `toHaveURL('/')` while `/` is still a placeholder — that assertion is about navigation and is satisfied from Task 3 onward, then strengthened by Task 5.
