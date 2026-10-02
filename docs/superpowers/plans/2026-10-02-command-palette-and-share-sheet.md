# Command Palette and Share Sheet Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the nav's two dead controls real — the ⌘K search field opens a command palette, the Share button opens a share/invite sheet — and build the overlay, sheet and toast primitives the rest of the design needs.

**Architecture:** Three new primitives in `components/ui` (`Sheet`, `Toast` + provider, and their CSS), then two features built on them (`CommandPalette`, `ShareSheet`), then the wiring in `AppShell`. The share sheet takes over invite and role editing from `MembersPanel`, which becomes the read-only People list the handoff describes. No new data fetching: the palette is driven entirely by props `AppShell` already receives, and the share sheet reuses the existing members route.

**Tech Stack:** Next.js 16 App Router (webpack, not Turbopack), React 19, CSS Modules, Playwright, Vitest.

**Spec:** `docs/design/glass-handoff.md` — the share sheet at lines ~199-210, the ⌘K palette at ~212-215, toasts at ~218, the viewer pill at ~217, the shared glass recipe at ~94-101 and the keyframes at ~221.

## Global Constraints

- **No backend changes.** No Prisma schema edits, no sync-server changes, no new or modified API routes. This was verified before planning: `POST /api/workspaces/[id]/members` already does `upsert` with `update: { role }`, so changing an existing member's role needs no new endpoint — post the member's email with the new role.
- Every colour, radius, duration and easing comes from a token in `apps/web/src/app/globals.css` where one exists. Raw values **only** where the handoff gives that literal, and then with a comment saying so.
- Pair every `backdrop-filter` with `-webkit-backdrop-filter`.
- All animation and transition inside `@media (prefers-reduced-motion: no-preference)`. A hover or selected colour is not motion and belongs outside it.
- `apps/web/test/css-tokens.test.ts` must keep passing: every `var(--x)` you write must be defined in `globals.css`.
- These `data-testid`s keep their meaning: `member-{id}`, `member-email`, `member-role`, `add-member`, `member-error`, `workspace-link`, `document-list`, `account-menu`, `sign-out`, `current-user`.
- Accessibility is part of done. Both overlays are modal dialogs: `role="dialog"`, `aria-modal="true"`, labelled by their title, Escape closes, backdrop click closes, focus moves in on open and returns to the invoking control on close, and Tab cycles inside. The palette's input/list is a combobox over a listbox with `aria-activedescendant` — not a `role="menu"`, and not a listbox with no owning combobox.
- Every test must be proven to discriminate: break the behaviour it covers, watch it fail, restore it. Commit before mutating so `git checkout --` actually restores.
- Full gate per task: `pnpm typecheck`, `pnpm --filter @crdt/web build` (there is no root build script), `pnpm test`, `pnpm --filter @crdt/web exec playwright test`. Baseline at the start of this plan: Vitest 236, Playwright 32. Revert `apps/web/next-env.d.ts` if the build rewrites it.

## Deliberately out of scope

- **The palette's "Go offline / Reconnect" items.** The handoff lists them, but they need the Yjs provider, which lives inside `DocumentClient` and is not reachable from the nav. Lifting provider state is the status-pill plan's job; these two items land there with it.
- **Everything else on the deferred list** — status pill and popover, offline/syncing pills, presence avatars in the nav, the tab presence dot, history, the board restyle and the card sheet. The toast primitive built here is what the offline/syncing work will reuse.

## File Structure

| File | Responsibility |
|---|---|
| `components/ui/Sheet.tsx` (new) | Modal overlay + sheet: focus trap, Escape, backdrop click, focus return. Used by `ShareSheet` now and the card sheet later. |
| `components/ui/Toast.tsx` (new) | `ToastProvider` + `useToast()`. Renders the dark glass pill, auto-hides after 3.2s. |
| `components/ui/sheet.module.css` (new) | Overlay and sheet surfaces, plus the toast pill. |
| `components/CommandPalette.tsx` (new) | The ⌘K palette: input, filtered item list, keyboard selection, navigation. |
| `components/command-palette.module.css` (new) | Palette sheet, 60px input, 46px item pills. |
| `components/ShareSheet.tsx` (new) | Share "{workspace}": invite field, member rows with role selects, errors, footnote, toasts. |
| `components/share-sheet.module.css` (new) | Invite pill container, member rows. |
| `app/layout.tsx` (modify) | Wrap the tree in `ToastProvider`. |
| `components/AppShell.tsx` (modify) | Search field becomes a button that opens the palette; Share opens the sheet; ⌘K/Ctrl+K handler; new `workspaces`, `members` and `role` props. |
| `app/page.tsx` (modify) | Pass the user's workspaces so the palette works on the dashboard. |
| `app/workspaces/[id]/page.tsx` (modify) | Pass members and role to `AppShell`; People panel header link. |
| `app/workspaces/[id]/MembersPanel.tsx` (modify) | Becomes the read-only People list plus the link that opens Share. |
| `app/documents/[id]/page.tsx` (modify) | Pass `role` so the viewer pill renders. |

---

### Task 1: The Sheet primitive

**Files:**
- Create: `apps/web/src/components/ui/Sheet.tsx`, `apps/web/src/components/ui/sheet.module.css`
- Test: `apps/web/e2e/sheet.spec.ts`

**Interfaces:**
- Consumes: tokens and keyframes from `globals.css` (`g-fade`, `g-sheet`, `--glass-bg-sheet`, `--glass-border`, `--glass-highlight`, `--glass-blur`, `--r-sheet`, `--ease`, `--dur`, `--dur-slow`).
- Produces: `Sheet` — `({ title, onClose, labelledBy, maxWidth, children }: { title: string; onClose: () => void; labelledBy?: string; maxWidth?: number; children: ReactNode }) => JSX.Element`. Client component. Renders `role="dialog" aria-modal="true"` with `data-testid="sheet"` on the sheet and `data-testid="sheet-overlay"` on the backdrop. The caller controls mounting; `Sheet` assumes it is only rendered while open.

- [ ] **Step 1: Write the stylesheet**

Create `apps/web/src/components/ui/sheet.module.css`:

```css
/*
  Overlay and sheet, shared by the share sheet now and the card sheet later.
  The handoff specifies these literals: overlay rgba(30,40,35,.16) + blur(8px),
  sheet shadow 0 40px 90px rgba(30,45,40,.22).
*/
.overlay {
  position: fixed;
  inset: 0;
  z-index: 50;
  display: grid;
  place-items: start center;
  padding: 72px 16px 16px;
  overflow-y: auto;
  background: rgba(30, 40, 35, 0.16);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
}

.sheet {
  width: 100%;
  border-radius: var(--r-sheet);
  padding: 26px 26px 22px;
  background: var(--glass-bg-sheet);
  backdrop-filter: var(--glass-blur);
  -webkit-backdrop-filter: var(--glass-blur);
  border: 1px solid var(--glass-border);
  box-shadow: var(--glass-highlight), 0 40px 90px rgba(30, 45, 40, 0.22);
}

@media (prefers-reduced-motion: no-preference) {
  .overlay {
    animation: g-fade 0.35s var(--ease);
  }
  .sheet {
    animation: g-sheet var(--dur-slow) var(--ease);
  }
}

.title {
  margin: 0 0 18px;
  font-size: 21px;
  font-weight: 600;
  letter-spacing: -0.02em;
}

/* Dark variant per the handoff: rgba(28,29,27,.82) + blur(24px). */
.toastWrap {
  position: fixed;
  left: 50%;
  bottom: 28px;
  z-index: 60;
  display: grid;
  gap: 8px;
  justify-items: center;
  transform: translateX(-50%);
  pointer-events: none;
}

.toast {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 18px;
  border-radius: var(--r-pill);
  background: rgba(28, 29, 27, 0.82);
  backdrop-filter: blur(24px);
  -webkit-backdrop-filter: blur(24px);
  color: #fff;
  font-size: 14px;
  font-weight: 500;
}

.toastDot {
  flex: none;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: oklch(0.78 0.12 300);
}

@media (prefers-reduced-motion: no-preference) {
  .toast {
    animation: g-up 0.55s var(--ease);
  }
}
```

- [ ] **Step 2: Write `Sheet.tsx`**

```tsx
'use client'

import { useEffect, useId, useRef, type ReactNode } from 'react'
import styles from './sheet.module.css'

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

export function Sheet({
  title,
  onClose,
  maxWidth = 510,
  children,
}: {
  title: string
  onClose: () => void
  maxWidth?: number
  children: ReactNode
}) {
  const sheet = useRef<HTMLDivElement>(null)
  const titleId = useId()

  useEffect(() => {
    // Remember what opened the sheet. Without this, closing drops focus to
    // <body> and a keyboard user restarts from the top of the document.
    const opener = document.activeElement as HTMLElement | null
    sheet.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus()

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        onClose()
        return
      }
      if (event.key !== 'Tab') return
      // Cycle focus inside the dialog: a modal that lets Tab walk into the page
      // behind it is a modal only visually.
      const items = [...(sheet.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [])]
      if (items.length === 0) return
      const first = items[0]!
      const last = items[items.length - 1]!
      if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      }
    }

    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      opener?.focus()
    }
  }, [onClose])

  return (
    <div
      className={styles.overlay}
      data-testid="sheet-overlay"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div
        className={styles.sheet}
        style={{ maxWidth }}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-testid="sheet"
        ref={sheet}
      >
        <h2 className={styles.title} id={titleId}>
          {title}
        </h2>
        {children}
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Write the failing e2e test**

The sheet has no caller yet, so test it through a throwaway harness is NOT the approach — instead this task's test is deferred to Task 3, where `ShareSheet` gives it a real caller. Write no test in this task; Task 3's tests cover the trap, Escape, backdrop and focus return. Note this in your report so the reviewer does not read it as a missing test.

- [ ] **Step 4: Verify**

Run: `pnpm typecheck` — clean. Run: `pnpm --filter @crdt/web build` — succeeds. Run: `pnpm test` — 236 pass (the token test must still pass; every `var()` above is defined).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/ui/Sheet.tsx apps/web/src/components/ui/sheet.module.css
git commit -m "feat(ui): add the modal sheet primitive with a focus trap"
```

---

### Task 2: Toasts

**Files:**
- Create: `apps/web/src/components/ui/Toast.tsx`
- Modify: `apps/web/src/app/layout.tsx`
- Test: `apps/web/test/toast.test.tsx` (if the repo has no React testing setup, skip the unit test and rely on Task 3's e2e — say which you did and why)

**Interfaces:**
- Consumes: `.toastWrap`, `.toast`, `.toastDot` from `sheet.module.css` (Task 1).
- Produces: `ToastProvider` — `({ children }: { children: ReactNode }) => JSX.Element`, and `useToast()` — `() => (message: string) => void`. Each toast carries `data-testid="toast"`.

- [ ] **Step 1: Write `Toast.tsx`**

```tsx
'use client'

import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react'
import styles from './sheet.module.css'

type Toast = { id: number; message: string }

const ToastContext = createContext<(message: string) => void>(() => {})

export function useToast(): (message: string) => void {
  return useContext(ToastContext)
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const nextId = useRef(0)

  // useCallback with an empty dep list: this value goes into a context, so a new
  // identity on every render would re-render every consumer on every render.
  const show = useCallback((message: string) => {
    const id = nextId.current++
    setToasts((current) => [...current, { id, message }])
    // 3.2s per the handoff. Filtering by id rather than shifting means two
    // toasts raised close together each get their full dwell time.
    setTimeout(() => setToasts((current) => current.filter((t) => t.id !== id)), 3200)
  }, [])

  return (
    <ToastContext.Provider value={show}>
      {children}
      {toasts.length > 0 && (
        <div className={styles.toastWrap} role="status" aria-live="polite">
          {toasts.map((toast) => (
            <div className={styles.toast} key={toast.id} data-testid="toast">
              <span className={styles.toastDot} aria-hidden="true" />
              {toast.message}
            </div>
          ))}
        </div>
      )}
    </ToastContext.Provider>
  )
}
```

- [ ] **Step 2: Mount the provider**

In `apps/web/src/app/layout.tsx`, import `ToastProvider` and wrap whatever currently renders inside `<body>` (keep `CanvasBackground` where it is — it must stay the first child so its stacking order is unchanged). A client component inside a server layout is fine.

- [ ] **Step 3: Verify**

Run: `pnpm typecheck` — clean. Run: `pnpm --filter @crdt/web build` — succeeds. Run: `pnpm --filter @crdt/web exec playwright test` — all 32 still pass. A `role="status"` region that renders nothing when empty must not change any existing assertion; if one breaks, that is a real finding — report it rather than editing the test.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/components/ui/Toast.tsx apps/web/src/app/layout.tsx
git commit -m "feat(ui): add toasts"
```

---

### Task 3: The share sheet

**Files:**
- Create: `apps/web/src/components/ShareSheet.tsx`, `apps/web/src/components/share-sheet.module.css`
- Test: `apps/web/e2e/share-sheet.spec.ts`

**Interfaces:**
- Consumes: `Sheet` (Task 1), `useToast` (Task 2), `WorkspaceMemberView` and `ROLE_LABEL` from the existing `MembersPanel.tsx` / `lib/role-label.ts`.
- Produces: `ShareSheet` — `({ workspaceId, workspaceName, members, canManage, onClose }: { workspaceId: string; workspaceName: string; members: WorkspaceMemberView[]; canManage: boolean; onClose: () => void }) => JSX.Element`.

Move `WorkspaceMemberView` out of `MembersPanel.tsx` into `apps/web/src/lib/members.ts` and re-export it from `MembersPanel` so existing imports keep working. Both files need the type and `MembersPanel` is about to shrink.

- [ ] **Step 1: Write the stylesheet**

Create `apps/web/src/components/share-sheet.module.css`:

```css
/* Invite row: one pill container holding a borderless input, a select and Add. */
.invite {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 4px 4px 14px;
  border-radius: var(--r-pill);
  background: #fff;
  border: 1px solid var(--field-border);
  box-shadow: inset 0 1px 2px rgba(30, 30, 50, 0.06);
}

.inviteInput {
  flex: 1 1 auto;
  min-width: 0;
  height: 34px;
  border: 0;
  background: transparent;
  font-size: 14.5px;
  color: var(--text);
}

.inviteInput:focus {
  outline: none;
}

.inviteRole {
  flex: none;
  height: 30px;
  border: 0;
  border-radius: var(--r-pill);
  background: rgba(0, 0, 0, 0.05);
  padding: 0 8px;
  font-size: 13.5px;
  color: var(--text-2);
}

.footnote {
  margin: 16px 0 0;
  font-size: 13px;
  color: var(--text-faint);
  line-height: 1.45;
}

.people {
  display: grid;
  gap: 2px;
  margin-top: 18px;
}

.row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 4px;
}

.avatar {
  flex: none;
  display: grid;
  place-items: center;
  width: 36px;
  height: 36px;
  border-radius: 50%;
  color: #fff;
  font-size: 14px;
  font-weight: 600;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.35);
}

.text {
  display: grid;
  gap: 1px;
  min-width: 0;
  flex: 1 1 auto;
}

.name {
  font-weight: 500;
}

.email {
  font-size: 13px;
  color: var(--text-faint);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.rowRole {
  flex: none;
  font-size: 13px;
  color: var(--text-muted);
}
```

- [ ] **Step 2: Write `ShareSheet.tsx`**

Full component. The submit handler copies `MembersPanel`'s existing shape exactly — read the form before any `await`, narrow `try/catch` around `fetch` only, `setPending(false)` on every path, `router.refresh()` on success — because that logic is already correct and reviewed.

```tsx
'use client'

import { useRouter } from 'next/navigation'
import { useState, type FormEvent } from 'react'
import type { Role } from '@crdt/shared/types'
import { Button } from '@/components/ui/Button'
import { Sheet } from '@/components/ui/Sheet'
import { useToast } from '@/components/ui/Toast'
import { colorFor } from '@/lib/color'
import type { WorkspaceMemberView } from '@/lib/members'
import { ROLE_LABEL } from '@/lib/role-label'
import styles from './share-sheet.module.css'
import ui from '@/components/ui/ui.module.css'

export function ShareSheet({
  workspaceId,
  workspaceName,
  members,
  canManage,
  onClose,
}: {
  workspaceId: string
  workspaceName: string
  members: WorkspaceMemberView[]
  canManage: boolean
  onClose: () => void
}) {
  const router = useRouter()
  const toast = useToast()
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  async function post(email: string, role: Role, announce: string) {
    setError(null)
    setPending(true)
    let response: Response
    try {
      response = await fetch(`/api/workspaces/${workspaceId}/members`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, role }),
      })
    } catch {
      // fetch rejects, rather than resolving with an error status, when the request
      // never reaches the server. Without this the rejection escapes and pending
      // stays true, leaving the control disabled with nothing shown.
      setError('Could not reach the server. Check your connection and try again.')
      setPending(false)
      return
    }
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { error?: string } | null
      setError(
        response.status === 404
          ? `We couldn't find ${email}. Ask them to sign in once, then try again.`
          : response.status === 403
            ? 'Your role in this workspace changed. Reload the page.'
            : (body?.error ?? 'Could not update that member'),
      )
      setPending(false)
      return
    }
    setPending(false)
    toast(announce)
    router.refresh()
  }

  async function onInvite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    const data = new FormData(form)
    const email = String(data.get('email') ?? '').trim()
    if (!email) return
    // The members route upserts, so posting an existing member would silently
    // change their role instead of inviting anyone. Catch it here and say so;
    // role changes have their own control on the row.
    const existing = members.find((m) => m.email.toLowerCase() === email.toLowerCase())
    if (existing) {
      setError(`${email} already has access.`)
      return
    }
    const role = String(data.get('role') ?? 'editor') as Role
    await post(email, role, `${email} added`)
    form.reset()
  }

  return (
    <Sheet title={`Share "${workspaceName}"`} onClose={onClose}>
      {canManage && (
        <form className={styles.invite} onSubmit={onInvite}>
          <input
            className={styles.inviteInput}
            name="email"
            type="email"
            required
            placeholder="teammate@company.com"
            aria-label="Invite by email"
            data-testid="member-email"
          />
          <select
            className={styles.inviteRole}
            name="role"
            defaultValue="editor"
            aria-label="Role"
            data-testid="member-role"
          >
            <option value="viewer">{ROLE_LABEL.viewer}</option>
            <option value="editor">{ROLE_LABEL.editor}</option>
            <option value="owner">{ROLE_LABEL.owner}</option>
          </select>
          <Button type="submit" disabled={pending} data-testid="add-member">
            {pending ? 'Adding…' : 'Add'}
          </Button>
        </form>
      )}

      {error && (
        <p className={ui.error} role="alert" data-testid="member-error">
          {error}
        </p>
      )}

      <div className={styles.people}>
        {members.map((member) => (
          <div className={styles.row} key={member.id} data-testid={`member-${member.id}`}>
            <span
              className={styles.avatar}
              style={{ background: colorFor(member.id) }}
              aria-hidden="true"
            >
              {(member.name || member.email).slice(0, 1).toUpperCase()}
            </span>
            <span className={styles.text}>
              <span className={styles.name}>{member.name}</span>
              <span className={styles.email}>{member.email}</span>
            </span>
            {canManage ? (
              <select
                className={styles.inviteRole}
                value={member.role}
                aria-label={`Role for ${member.name}`}
                data-testid={`role-for-${member.id}`}
                disabled={pending}
                onChange={(event) =>
                  void post(
                    member.email,
                    event.target.value as Role,
                    event.target.value === 'editor'
                      ? `${member.name} can edit now`
                      : `${member.name} is now ${ROLE_LABEL[event.target.value as Role]}`,
                  )
                }
              >
                <option value="viewer">{ROLE_LABEL.viewer}</option>
                <option value="editor">{ROLE_LABEL.editor}</option>
                <option value="owner">{ROLE_LABEL.owner}</option>
              </select>
            ) : (
              <span className={styles.rowRole}>{ROLE_LABEL[member.role]}</span>
            )}
          </div>
        ))}
      </div>

      <p className={styles.footnote}>
        People need to have signed in once before you can add them. Role changes apply the next
        time they connect.
      </p>
    </Sheet>
  )
}
```

- [ ] **Step 3: Write the failing e2e tests**

Create `apps/web/e2e/share-sheet.spec.ts`. Follow the conventions in `glass-shell.spec.ts`: one `LABEL`, one import block from `./fixtures.js`, one `test.afterAll` cleanup. These tests need the Task 6 wiring to open the sheet, so until then open it directly by navigating with the sheet forced open is NOT possible — instead write these tests now, confirm they FAIL (the Share button is still disabled), and leave them failing until Task 6. Say so in your report; Task 6 is where they go green.

```ts
test('the share sheet traps focus, closes on Escape and returns focus', async ({ page }) => {
  const label = `${LABEL}-focus`
  const { owner, workspace } = await seedWorkspace(label)
  await signIn(page, owner.id)
  await page.goto(`/workspaces/${workspace.id}`)

  await page.getByTestId('share').click()
  await expect(page.getByTestId('sheet')).toBeVisible()
  // Focus must be inside the dialog, not left on the Share button.
  await expect(page.getByTestId('sheet')).toContainText('Share')
  const inside = await page
    .getByTestId('sheet')
    .evaluate((el) => el.contains(document.activeElement))
  expect(inside).toBe(true)

  await page.keyboard.press('Escape')
  await expect(page.getByTestId('sheet')).toHaveCount(0)
  await expect(page.getByTestId('share')).toBeFocused()
})

test('a backdrop click closes the sheet but a click inside does not', async ({ page }) => {
  const label = `${LABEL}-backdrop`
  const { owner, workspace } = await seedWorkspace(label)
  await signIn(page, owner.id)
  await page.goto(`/workspaces/${workspace.id}`)

  await page.getByTestId('share').click()
  await page.getByTestId('sheet').click({ position: { x: 10, y: 10 } })
  await expect(page.getByTestId('sheet')).toBeVisible()

  await page.getByTestId('sheet-overlay').click({ position: { x: 5, y: 5 } })
  await expect(page.getByTestId('sheet')).toHaveCount(0)
})

test('inviting someone who already has access explains instead of changing their role', async ({
  page,
}) => {
  const label = `${LABEL}-dupe`
  const { owner, workspace } = await seedWorkspace(label)
  await signIn(page, owner.id)
  await page.goto(`/workspaces/${workspace.id}`)

  await page.getByTestId('share').click()
  await page.getByTestId('member-email').fill(owner.email)
  await page.getByTestId('add-member').click()

  await expect(page.getByTestId('member-error')).toContainText('already has access')
  // The owner's own role must be untouched by a duplicate invite.
  await expect(page.getByTestId(`role-for-${owner.id}`)).toHaveValue('owner')
})
```

- [ ] **Step 4: Verify the new tests fail for the right reason**

Run: `pnpm --filter @crdt/web exec playwright test share-sheet`
Expected: all three FAIL because `data-testid="share"` is not clickable yet. Paste the actual failure text into your report. Do not add the wiring here — that is Task 6.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/ShareSheet.tsx apps/web/src/components/share-sheet.module.css apps/web/src/lib/members.ts apps/web/src/app/workspaces/\[id\]/MembersPanel.tsx apps/web/e2e/share-sheet.spec.ts
git commit -m "feat(share): add the share sheet"
```

---

### Task 4: `MembersPanel` becomes the read-only People list

**Files:**
- Modify: `apps/web/src/app/workspaces/[id]/MembersPanel.tsx`
- Modify: `apps/web/src/app/workspaces/[id]/page.tsx`
- Modify: `apps/web/e2e/auth-flow.spec.ts`

The handoff: *"**People:** a glass list (radius 22) with rows of a 34px avatar, name, email and role. The header link "Manage" (owner) or "See who has access" opens Share."* So the invite form and the role controls leave this panel; it keeps the list and gains the link.

- [ ] **Step 1: Strip the panel to the list plus a link**

In `MembersPanel.tsx`: delete the `onSubmit` handler, the `<form>`, the error paragraph, and the now-unused imports (`useRouter`, `useState`, `FormEvent`, `Button`, `TextField`, `ui`). Keep the member rows exactly as they are, including `data-testid={`member-${member.id}`}` and the `ROLE_LABEL` text. Add a new prop `onOpenShare: () => void` and render a header link:

```tsx
      <button type="button" className={styles.manageLink} onClick={onOpenShare} data-testid="open-share">
        {canManage ? 'Manage' : 'See who has access'}
      </button>
```

Add `.manageLink` to `workspace.module.css`: a borderless transparent button, `font-size: 13.5px`, `color: var(--accent-text)`, `font-weight: 500`, `cursor: pointer`, and `text-decoration: underline` on hover.

- [ ] **Step 2: Hold the sheet's open state on the workspace page**

`app/workspaces/[id]/page.tsx` is a server component and cannot hold state. Rather than converting it, lift the share sheet into `AppShell` (Task 6 does this — the Share button lives there), and have `MembersPanel`'s link reach it. The simplest wiring that avoids prop-drilling through a server component: Task 6 exposes a small client context, `ShareContext`, from `AppShell`, and `MembersPanel` consumes it via a `useShare()` hook instead of an `onOpenShare` prop.

Do that: in this task give `MembersPanel` a `useShare()` call, and in Task 6 provide it. Until Task 6 lands, `useShare()` returns a no-op and the link does nothing — note that in your report.

- [ ] **Step 3: Update the e2e flow that used the old form**

`auth-flow.spec.ts` drives `member-email`, `member-role` and `add-member` on the workspace page. Those controls now live inside the share sheet, so the test must open it first. Add `await page.getByTestId('share').click()` before the first of those interactions in that test, and leave every assertion identical. These will fail until Task 6 wires the button; report that rather than editing the assertions.

- [ ] **Step 4: Verify**

Run: `pnpm typecheck` — clean. Run: `pnpm test` — 236 pass.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/workspaces apps/web/e2e/auth-flow.spec.ts
git commit -m "refactor(members): the People panel becomes a read-only list with a Share link"
```

---

### Task 5: The command palette

**Files:**
- Create: `apps/web/src/components/CommandPalette.tsx`, `apps/web/src/components/command-palette.module.css`
- Test: `apps/web/e2e/command-palette.spec.ts`

**Interfaces:**
- Consumes: `NavDocument` from `AppShell`, the `.overlay` class from `sheet.module.css`.
- Produces: `CommandPalette` — `({ workspace, documents, workspaces, onClose, onOpenShare }: { workspace?: { id: string; name: string }; documents?: NavDocument[]; workspaces?: { id: string; name: string }[]; onClose: () => void; onOpenShare?: () => void }) => JSX.Element`.

- [ ] **Step 1: Write the stylesheet**

Create `apps/web/src/components/command-palette.module.css`. The handoff: overlay `rgba(30,40,35,.1)`, sheet at top 110px, max-width 580, radius 28, blur 36px; 60px input; 46px item pills; the selected item is accent background with white text.

```css
.overlay {
  position: fixed;
  inset: 0;
  z-index: 55;
  display: grid;
  place-items: start center;
  padding: 110px 16px 16px;
  background: rgba(30, 40, 35, 0.1);
}

.sheet {
  width: 100%;
  max-width: 580px;
  border-radius: 28px;
  overflow: hidden;
  background: var(--glass-bg-sheet);
  backdrop-filter: blur(36px) saturate(190%);
  -webkit-backdrop-filter: blur(36px) saturate(190%);
  border: 1px solid var(--glass-border);
  box-shadow: var(--glass-highlight), 0 40px 90px rgba(30, 45, 40, 0.22);
}

@media (prefers-reduced-motion: no-preference) {
  .overlay {
    animation: g-fade 0.35s var(--ease);
  }
  .sheet {
    animation: g-sheet var(--dur-slow) var(--ease);
  }
}

.input {
  width: 100%;
  height: 60px;
  padding: 0 22px;
  border: 0;
  border-bottom: 1px solid var(--field-border);
  background: transparent;
  font-size: 16px;
  color: var(--text);
}

.input:focus {
  outline: none;
}

.list {
  margin: 0;
  padding: 8px;
  list-style: none;
  max-height: 46vh;
  overflow-y: auto;
}

.item {
  display: flex;
  align-items: center;
  gap: 10px;
  height: 46px;
  padding: 0 14px;
  border-radius: var(--r-pill);
  font-size: 14.5px;
  color: var(--text-2);
  cursor: pointer;
}

.itemOn {
  background: var(--accent);
  color: #fff;
}

.kind {
  margin-left: auto;
  font-size: 12px;
  opacity: 0.7;
}

.empty {
  padding: 18px 22px;
  font-size: 14px;
  color: var(--text-muted);
}
```

- [ ] **Step 2: Write `CommandPalette.tsx`**

```tsx
'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { NavDocument } from './AppShell'
import styles from './command-palette.module.css'

type Item = { id: string; label: string; kind: string; run: () => void }

export function CommandPalette({
  workspace,
  documents,
  workspaces,
  onClose,
  onOpenShare,
}: {
  workspace?: { id: string; name: string }
  documents?: NavDocument[]
  workspaces?: { id: string; name: string }[]
  onClose: () => void
  onOpenShare?: () => void
}) {
  const router = useRouter()
  const [query, setQuery] = useState('')
  const [index, setIndex] = useState(0)
  const input = useRef<HTMLInputElement>(null)

  const items = useMemo<Item[]>(() => {
    const go = (href: string) => () => {
      onClose()
      router.push(href)
    }
    const list: Item[] = []
    for (const document of documents ?? []) {
      list.push({
        id: `doc-${document.id}`,
        label: document.title,
        kind: document.type === 'board' ? 'Board' : 'Page',
        run: go(`/documents/${document.id}`),
      })
    }
    for (const entry of workspaces ?? []) {
      list.push({
        id: `ws-${entry.id}`,
        label: entry.name,
        kind: 'Workspace',
        run: go(`/workspaces/${entry.id}`),
      })
    }
    if (workspace) {
      list.push({ id: 'overview', label: 'Overview', kind: 'Go', run: go(`/workspaces/${workspace.id}`) })
    }
    list.push({ id: 'dashboard', label: 'All workspaces', kind: 'Go', run: go('/') })
    if (workspace && onOpenShare) {
      list.push({
        id: 'share',
        label: 'Share',
        kind: 'Action',
        run: () => {
          onClose()
          onOpenShare()
        },
      })
    }
    return list
  }, [documents, workspaces, workspace, onOpenShare, onClose, router])

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    return q ? items.filter((item) => item.label.toLowerCase().includes(q)) : items
  }, [items, query])

  // Clamp rather than reset: typing narrows the list, and an index past the end
  // would leave nothing selected and make Enter a no-op.
  const selected = Math.min(index, Math.max(shown.length - 1, 0))

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null
    input.current?.focus()
    return () => opener?.focus()
  }, [])

  return (
    <div
      className={styles.overlay}
      data-testid="palette-overlay"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div className={styles.sheet} role="dialog" aria-modal="true" aria-label="Search" data-testid="palette">
        <input
          className={styles.input}
          ref={input}
          value={query}
          placeholder="Search documents and actions"
          aria-label="Search documents and actions"
          role="combobox"
          aria-expanded="true"
          aria-controls="palette-list"
          aria-activedescendant={shown[selected] ? `palette-item-${shown[selected]!.id}` : undefined}
          data-testid="palette-input"
          onChange={(event) => {
            setQuery(event.target.value)
            setIndex(0)
          }}
          onKeyDown={(event) => {
            if (event.key === 'Escape') return onClose()
            if (event.key === 'ArrowDown') {
              event.preventDefault()
              setIndex((value) => (shown.length === 0 ? 0 : (value + 1) % shown.length))
            } else if (event.key === 'ArrowUp') {
              event.preventDefault()
              setIndex((value) => (shown.length === 0 ? 0 : (value - 1 + shown.length) % shown.length))
            } else if (event.key === 'Enter') {
              event.preventDefault()
              shown[selected]?.run()
            }
          }}
        />

        {shown.length === 0 ? (
          <p className={styles.empty}>No matches</p>
        ) : (
          <ul className={styles.list} id="palette-list" role="listbox" aria-label="Results">
            {shown.map((item, position) => (
              <li
                className={`${styles.item} ${position === selected ? styles.itemOn : ''}`}
                key={item.id}
                id={`palette-item-${item.id}`}
                role="option"
                aria-selected={position === selected}
                data-testid={`palette-item-${item.id}`}
                onPointerDown={(event) => {
                  event.preventDefault()
                  item.run()
                }}
              >
                {item.label}
                <span className={styles.kind}>{item.kind}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Write the failing e2e tests**

Create `apps/web/e2e/command-palette.spec.ts`, following the existing conventions. Cover: ⌘K opens it (use `Meta+k`, and also assert `Control+k` works, since the suite runs on Linux CI); typing filters; ArrowDown then Enter navigates to the selected document; Escape closes and returns focus to the search control. These depend on Task 6's wiring, so they fail until then — report that.

- [ ] **Step 4: Verify the failure reason**

Run: `pnpm --filter @crdt/web exec playwright test command-palette`. Expected: failures because nothing opens the palette yet. Paste the real text.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/CommandPalette.tsx apps/web/src/components/command-palette.module.css apps/web/e2e/command-palette.spec.ts
git commit -m "feat(palette): add the command palette"
```

---

### Task 6: Wire both into the nav

**Files:**
- Modify: `apps/web/src/components/AppShell.tsx`, `apps/web/src/components/app-shell.module.css`
- Modify: `apps/web/src/app/page.tsx`, `apps/web/src/app/workspaces/[id]/page.tsx`, `apps/web/src/app/documents/[id]/page.tsx`

This is the task that makes Tasks 3 and 5's tests go green.

- [ ] **Step 1: Make `AppShell` a client component that owns both overlays**

`AppShell` currently has no state. It needs `'use client'`, `useState` for which overlay is open, a `⌘K`/`Ctrl+K` key handler, and a context so `MembersPanel` can open Share.

- Add props: `workspaces?: { id: string; name: string }[]` (for the dashboard palette), `members?: WorkspaceMemberView[]` and `role?: Role` (for the sheet and the viewer pill).
- Export `ShareContext` and `useShare()`; provide `() => setOpen('share')`.
- Turn the inert search field into a real `<button type="button" data-testid="search">` that opens the palette, keeping its current classes and the ⌘K chip.
- Give the Share button `data-testid="share"`, remove `disabled` and `aria-disabled`, and have it open the sheet. Render it only when `workspace` is present.
- Render `{open === 'palette' && <CommandPalette … />}` and `{open === 'share' && workspace && members && <ShareSheet … />}`.
- The ⌘K handler: `useEffect` on mount, `keydown`, `(event.metaKey || event.ctrlKey) && event.key === 'k'` → `event.preventDefault()` and open the palette. Remove the listener on cleanup.

**Careful:** `AppShell` becoming a client component means every prop it receives must be serialisable. `members` is plain data, so this is fine — but check that nothing passes a Date or a function. The `documents` prop is already mapped to `{id,title,type}` for exactly this reason.

- [ ] **Step 2: The viewer pill**

The handoff: *"**Viewer.** A "View only" pill next to the tabs."* When `role === 'viewer'`, render a pill after the tab strip using the existing `ui.chip` class with `data-testid="view-only"` and the text `View only`.

- [ ] **Step 3: Pass the new props from all three pages**

- `app/page.tsx`: it already queries the user's workspaces — pass `workspaces={…}` mapped to `{id, name}`.
- `app/workspaces/[id]/page.tsx`: pass `members` (mapped to `WorkspaceMemberView`) and `role`.
- `app/documents/[id]/page.tsx`: pass `role` so the viewer pill shows there too. Do not pass `members` — the document page has no members query and must not gain one.

- [ ] **Step 4: Run every test that this unblocks**

Run: `pnpm --filter @crdt/web exec playwright test`
Expected: all of Task 3's and Task 5's tests now pass, plus the existing 32. If an existing test fails, that is a regression — diagnose it; do not edit the test.

- [ ] **Step 5: Prove the wiring discriminates**

Commit first. Then, one at a time: remove the `⌘K` handler and confirm the palette keyboard test fails; put the `disabled` attribute back on Share and confirm the share-sheet tests fail. Restore each with `git checkout --` and verify `git diff --exit-code`. Paste both failures.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/components apps/web/src/app
git commit -m "feat(nav): the search field opens the palette and Share opens the sheet"
```

---

### Task 7: Verify and record

**Files:**
- Modify: `docs/design/glass-handoff.md`

- [ ] **Step 1: Full gate**

- `pnpm typecheck` — clean.
- `pnpm test` — report the count.
- `pnpm --filter @crdt/web build` — succeeds, and the route list is unchanged (no new routes: this plan adds no API).
- `pnpm --filter @crdt/web exec playwright test` — all pass, started cold.
- Revert `apps/web/next-env.d.ts` if the build rewrote it.

- [ ] **Step 2: Update the implementation status section**

Move the ⌘K palette and share sheet out of "Deferred" and into "Built". Record, under the deferred list, that the palette's "Go offline / Reconnect" items were intentionally left out because they need provider state that the status-pill plan lifts. Add that toasts now exist as a primitive the offline/syncing work can reuse. Note that `MembersPanel` is now a read-only list and that invite plus role editing live in the share sheet.

- [ ] **Step 3: Commit**

```bash
git add docs/design/glass-handoff.md
git commit -m "docs: record the palette and share sheet as built"
```

---

## Self-Review

**1. Spec coverage.** Share sheet: overlay and sheet style (Task 1), title, owner-only invite field with email/role/Add, both error strings, member rows with role selects for the owner and text for others, footnote, toasts (Task 3). Palette: overlay, sheet geometry, 60px input and its placeholder, 46px item pills with the accent selected state, arrow/Enter/Escape, and the item list minus the two provider-dependent entries (Task 5), reachable by ⌘K and by the search field (Task 6). Viewer pill (Task 6). The People panel's "Manage" / "See who has access" link (Task 4).

**2. Placeholder scan.** No "TBD" and no "add error handling". Every new file is given in full. Tasks 4 and 6 describe edits to existing files by what to keep and what to change, because the instruction there is to preserve reviewed logic verbatim.

**3. Type consistency.** `WorkspaceMemberView` moves to `lib/members.ts` in Task 3 and is consumed by `ShareSheet`, `MembersPanel` and `AppShell`. `NavDocument` keeps its existing shape and source. `ShareContext`/`useShare()` is declared in Task 6 and consumed in Task 4 — Task 4 lands first and must tolerate the no-op, which Step 2 of that task states explicitly.

**4. Known ordering wrinkle.** Tasks 3, 4 and 5 deliberately leave tests red until Task 6 wires the controls. Each of those tasks says so and requires the failure text in the report, so a reviewer can tell an expected red from a regression. If a reviewer is dispatched per task, tell it this too.
