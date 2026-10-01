# GitHub/Google Sign-In and Public Deployment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace email/password sign-in with GitHub and Google OAuth, then make the app deployable for free on Render (web + sync) with Neon Postgres, so real people can use it.

**Architecture:** A hand-rolled OAuth 2.0 authorization-code flow with PKCE and an HMAC-signed `state` cookie, served by two new route handlers. On success they issue the **existing** session cookie, so everything downstream (`requireUser`, doc tokens, the sync server's JWT contract) is untouched. Deployment adds a Render Blueprint, fixes a build-time bug in the web Dockerfile, and adds a sync-server wake-up ping for free-tier cold starts.

**Tech Stack:** Next.js 16.3.5 App Router (forced `--webpack`), React 19.3, TypeScript 7, Prisma 7 + `@prisma/adapter-pg`, `node:crypto`, global `fetch`, Vitest 5, Playwright 1.63, Render (Docker, free plan), Neon Postgres (free plan).

**Spec:** `docs/superpowers/specs/2026-09-19-crdt-collaborative-engine-design.md` is the parent design. There is no separate spec for this change: the decisions agreed during brainstorming are recorded in **Decisions** below, and that section is binding on every task.

---

## Decisions (agreed in brainstorming — binding)

1. **Sign-in is GitHub or Google only.** Email/password is removed entirely, not hidden. Its API routes are deleted: if `POST /api/auth/signup` stayed live, anyone could still create an account for an email they don't own with `curl`, and invites (which go by email) could be hijacked.
2. **Hand-rolled OAuth, no auth library.** Arctic was deprecated in July 2026. Auth.js and Better Auth both want to own sessions, which would mean replacing the reviewed session system. The flow here issues the existing `crdt_session` cookie.
3. **Only provider-verified emails are trusted.** GitHub: the address in `/user/emails` that is both `primary` and `verified`. Google: `email_verified === true` (the boolean). Otherwise sign-in is refused.
4. **Three linking rules, in order:** (1) a known provider identity signs into its user, even if the email changed; (2) otherwise link to the user who already has this email; (3) otherwise create a user, the identity, and a personal workspace together.
5. **Hosting:** two Render free web services from the existing Dockerfiles, plus Neon free Postgres. Render's free Postgres is not used: per Render's docs it is deleted 30 days after creation (plus 14 days' grace) with no backups.
6. **Minimal backend change.** See the footprint table below. The sync server is not touched at all.
7. **`User.passwordHash` becomes nullable, not dropped.** Five existing test files create users with `passwordHash: 'x'`; nullable keeps them all valid unchanged, and the migration stays non-destructive (nothing is lost on rollback).

## Backend footprint — what changes and what deliberately does not

| Area | Change |
|---|---|
| `apps/sync/` | **None.** Not one line. `/healthz` already exists and serves both Render's health check and the wake-up ping. |
| `packages/db` | One additive migration: `AuthProvider` enum, `Account` table, `passwordHash` → nullable. |
| `apps/web/src/app/api/` | **+2** OAuth routes. **−2** (`auth/login`, `auth/signup`) deleted. Members route: **one line** (email normalization). Nothing else. |
| `requireUser`, `auth-guard.ts`, doc-token route, `doc-session.ts`, session JWT functions | **None.** |
| `apps/web/Dockerfile` | One `ARG` plus a guard, fixing a real bug (see Task 9). |
| `apps/sync/Dockerfile` | None. |

---

## Global Constraints

- **Do not modify anything under `apps/sync/`.**
- **Do not modify** `apps/web/src/lib/auth-guard.ts`, `apps/web/src/lib/current-user.ts`, `apps/web/src/lib/safe-next.ts`, `apps/web/src/lib/doc-session.ts`, `apps/web/src/app/api/documents/`, `apps/web/src/app/api/workspaces/route.ts`, `apps/web/src/app/api/workspaces/[id]/documents/route.ts`, or `apps/web/src/app/api/me/route.ts`.
- **The only permitted change to `apps/web/src/app/api/workspaces/[id]/members/route.ts` is the email-normalization line in Task 7.**
- **Do not modify `.env`.** It holds the user's real secrets. `.env.example` is updated in Task 9 with **placeholders only**.
- **Do not modify** `docker-compose.yml`, `docker-compose.override.yml`, or the existing migration `packages/db/prisma/migrations/20260920070205_init/`.
- **Add no new runtime or dev dependencies.** Use global `fetch`, `node:crypto`, and what is already installed.
- **Never log** an authorization code, an access token, a PKCE verifier, a client secret, or the OAuth flow cookie.
- **Never render text taken from the query string** on the login page. `?error=` selects one of a fixed set of messages; it is never displayed.
- **OAuth redirect URIs are built from `APP_URL`, never from the request's `Host` header.**
- **Emails are trimmed and lowercased** everywhere they enter the system (sign-in, invites).
- **The OAuth flow cookie is `SameSite=Lax`, not `Strict`.** The provider sends the browser back with a cross-site top-level GET; a `Strict` cookie would be withheld and every sign-in would fail with `state_mismatch`.
- **Never declare a Docker `ARG` for a secret.** Render passes every env var as a build arg, and a declared `ARG` can end up in the image. Only `NEXT_PUBLIC_SYNC_URL` (a public URL) is declared.
- **`redirect()` from `next/navigation` must never sit inside a `try` whose `catch` swallows errors.** It signals by throwing.
- **Next 16:** `params` and `searchParams` are Promises and must be awaited. **`searchParams` values can be arrays** (`?next=a&next=b`) — narrow with `typeof x === 'string'` before use.
- **Relative imports inside `apps/web/src/lib/` carry a `.js` extension** (`./errors.js`). Imports through `@/` do not.
- **Route handlers read cookies from `request.headers.get('cookie')`**, not `next/headers`, and set them with `Set-Cookie` headers — the pattern the existing auth routes use, and it keeps them testable without mocks.
- **`data-testid="status"` and `data-testid="read-only"` on the document page must keep behaving exactly as today.** `collaboration.spec.ts` depends on them. No task in this plan should touch those files.
- **Postgres runs in Docker on port 5433 and is shared with the user's main checkout.** Never start, stop, or restart it.
- **Never run any `fly`, `render`, `neonctl`, or cloud CLI command, and never create accounts or enter credentials.** Deployment is performed by the user (see **Going live**).
- **Test discrimination is required.** For every test you add, prove it can fail: break the property, watch the test fail, restore, watch it pass. Report both observations with real output.
- **Do not commit `apps/web/next-env.d.ts`** (Next rewrites it when dev and build alternate).
- Commit after every task with a conventional-commit prefix.

---

## Edge cases, and where each is handled

| # | Edge case | Handling | Task · test |
|---|---|---|---|
| 1 | Login CSRF (attacker's code delivered to victim) | Random `state` in an HMAC-signed cookie, compared in constant time before any network call | 3, 5 · `state mismatch` tests; `fetch` not called |
| 2 | Cookie planted by a sibling subdomain | `onrender.com` is on the Public Suffix List, so browsers block it; the flow cookie is also HMAC-signed, which covers a future custom domain | 3 · tampered / wrong-secret tests |
| 3 | Authorization code intercepted | PKCE S256 on both providers (GitHub supports it since July 2025) | 3 · RFC 7636 vector; 5 · verifier matches challenge |
| 4 | Flow cookie replayed or stale | Single use (cleared on every callback outcome); rejected after 10 minutes server-side; future-dated rejected | 3 · expired / future tests; 5 · cookie cleared |
| 5 | Sign-in started in two tabs | Second start overwrites the cookie; first tab's callback gets a clear "started in another tab" message | 2 · message; 5 · mismatch |
| 6 | Flow started for GitHub, callback hit for Google | Provider is bound into the cookie and checked | 5 · provider-mismatch test |
| 7 | User clicks **Cancel** at the provider | `?error=access_denied` → "Sign-in was cancelled." | 5 · access_denied test |
| 8 | Unverified email | Refused with a specific message; no user created | 2 · profile tests; 5 · no_verified_email test |
| 9 | GitHub public email is spoofable free text | Only `/user/emails` primary+verified is used; a verified *secondary* is not | 2 · secondary-verified test |
| 10 | Google `email_verified` as string `"true"` | Strict boolean check | 2 · string-true test |
| 11 | GitHub failed exchange returns HTTP 200 + `error` | Checks for `access_token`, not status | 2, 5 · bad_verification_code tests |
| 12 | GitHub API rejects requests with no `User-Agent` | Sent explicitly | 2 · header assertion |
| 13 | Provider slow or down | 10 s timeout; any unexpected error → generic "something went wrong" | 2 · non-2xx; 5 · network failure test |
| 14 | Email case differs across providers or when inviting | Lowercased and trimmed on sign-in and on invite | 2 · normalization; 7 · mixed-case invite |
| 15 | Provider email changed after first sign-in | Identity id wins over email (rule 1) | 4 · changed-email test |
| 16 | Same person, both providers | Rule 2 links the second identity | 4 · second-provider test |
| 17 | Double-click / two tabs racing on first sign-in | Unique constraint + one retry that takes the "already linked" path | 4 · concurrent test |
| 18 | Crash midway through creating a new user | User, identity and workspace in one transaction | 4 · creation test |
| 19 | GitHub `name` is null / name absurdly long | Falls back to `login` (Google: email local part); truncated to 80 | 2 · name tests |
| 20 | Open redirect via `?next=` | `safeNext` on the login page, the start route, **and** the callback | 5 · forged-cookie test; 6 · e2e hostile next |
| 21 | `?next=a&next=b` (array) crashes the page | Narrowed to string before `safeNext` | 6 · e2e repeated-next test |
| 22 | `?error=__proto__` / `toString` reads an inherited property | `Object.hasOwn` lookup | 2 · prototype-key tests |
| 23 | Attacker-chosen text on the login page (phishing) | Unknown error codes show one generic string | 6 · e2e raw-text test |
| 24 | Old password endpoints still reachable by `curl` | Deleted; e2e asserts 404 | 6 · endpoints-gone test |
| 25 | Old `/signup` links and bookmarks | Redirect to `/login`, keeping `next` | 6 · e2e signup-redirect test |
| 26 | Provider not configured (e.g. Google skipped locally) | Button hidden; start route redirects with `provider_unavailable` | 2, 5, 6 |
| 27 | `APP_URL` missing, malformed, or with a trailing slash | Validated; normalized to its origin | 2 · env tests |
| 28 | Production bundle falls back to `ws://localhost:1234` | Dockerfile `ARG` + guard that fails the build if unset | 9 · docker build checks |
| 29 | Free-tier cold start: sync server asleep | Every page pings `/healthz`, so web and sync wake in parallel | 8 · unit + e2e |
| 30 | Sync server sleeps with unflushed writes | Not possible: it only sleeps after 15 min with no WebSocket traffic, long after the 500 ms queue flushed | Documented (10) |
| 31 | Running the production migration against the local DB by mistake | An explicit `DATABASE_URL=` beats `.env` (verified); `migrate status` prints the target host first | 10 · runbook |
| 32 | Collaboration e2e fails when the sync server isn't running | Playwright starts it | 10 · collaboration with nothing on 1234 |

---

## File Structure

### New files

| File | Responsibility |
|---|---|
| `packages/db/prisma/migrations/20260921120000_oauth_accounts/migration.sql` | The additive migration. |
| `packages/db/test/account.test.ts` | Schema-level guarantees for `Account`. |
| `apps/web/src/lib/oauth/errors.ts` | `OAuthError`, the fixed set of error codes, and their user-facing messages. |
| `apps/web/src/lib/oauth/providers.ts` | Provider endpoints and scopes, credential lookup, token exchange, and turning provider responses into a validated `OAuthProfile`. |
| `apps/web/src/lib/oauth/flow.ts` | PKCE, the signed short-lived flow cookie, constant-time comparison. |
| `apps/web/src/lib/oauth/http.ts` | Redirect responses that can carry cookies; login-error and callback URLs. |
| `apps/web/src/lib/oauth/resolve-user.ts` | The three linking rules. The only OAuth file that touches the database. |
| `apps/web/src/app/api/auth/oauth/[provider]/route.ts` | `GET` — starts the flow. |
| `apps/web/src/app/api/auth/oauth/[provider]/callback/route.ts` | `GET` — finishes it. |
| `apps/web/src/lib/sync-url.ts` | The sync URL constant and its health-check URL. |
| `apps/web/src/components/WarmSync.tsx` | Fire-and-forget wake-up ping. |
| `render.yaml` | Render Blueprint for both services. |
| Tests: `apps/web/test/oauth-providers.test.ts`, `oauth-flow.test.ts`, `oauth-resolve-user.integration.test.ts`, `oauth-routes.integration.test.ts`, `sync-url.test.ts`; `apps/web/e2e/warm-sync.spec.ts` | |

### Modified files

| File | Change |
|---|---|
| `packages/db/prisma/schema.prisma` | Enum, `Account`, `User.accounts`, nullable `passwordHash`. |
| `apps/web/src/lib/env.ts` | Adds `env.appUrl`. |
| `apps/web/src/lib/session.ts` | Password hashing removed; session JWT functions untouched. |
| `apps/web/src/app/(auth)/login/page.tsx` | Provider buttons and error messages. |
| `apps/web/src/app/(auth)/signup/page.tsx` | Becomes a redirect to `/login`. |
| `apps/web/src/app/(auth)/auth.module.css` | Form styles out, provider-button styles in. |
| `apps/web/src/app/api/workspaces/[id]/members/route.ts` | One line: normalize the invited email. |
| `apps/web/src/app/workspaces/[id]/MembersPanel.tsx` | Copy: "sign in once with GitHub or Google". |
| `apps/web/src/app/layout.tsx` | Renders `<WarmSync />`. |
| `apps/web/src/hooks/use-doc.ts` | Imports `SYNC_URL` from `@/lib/sync-url`. |
| `apps/web/e2e/fixtures.ts`, `apps/web/e2e/auth-flow.spec.ts` | Sign in by session cookie; OAuth UI tests. |
| `apps/web/test/session.test.ts`, `env.test.ts`, `workspace-routes.integration.test.ts` | Trimmed / extended. |
| `apps/web/playwright.config.ts` | Test env for OAuth; starts the sync server too. |
| `apps/web/Dockerfile` | `ARG NEXT_PUBLIC_SYNC_URL` + guard. |
| `scripts/seed-demo.ts` | Owner by email instead of a password. |
| `.env.example`, `README.md` | Documentation. |

### Deleted files

`apps/web/src/app/api/auth/login/route.ts`, `apps/web/src/app/api/auth/signup/route.ts`, `apps/web/src/app/(auth)/login/LoginForm.tsx`, `apps/web/src/app/(auth)/signup/SignupForm.tsx`, `apps/web/test/auth-routes.integration.test.ts`.

The coverage `auth-routes.integration.test.ts` provided for "signup creates a user and an owned workspace atomically" moves to Task 4's creation test.

---

## Task 1: Schema and migration

**Files:**
- Modify: `packages/db/prisma/schema.prisma`
- Create: `packages/db/prisma/migrations/20260921120000_oauth_accounts/migration.sql`
- Test: `packages/db/test/account.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: Prisma model `Account { id, userId, provider: AuthProvider, providerAccountId, createdAt }` with compound unique `provider_providerAccountId`; enum `AuthProvider = 'github' | 'google'` (importable as `import type { AuthProvider } from '@crdt/db'`, since `@crdt/db` re-exports `@prisma/client`); relation `User.accounts`; `User.passwordHash: string | null`.

- [ ] **Step 1: Write the failing test**

Create `packages/db/test/account.test.ts`:

```ts
import { describe, it, expect, afterAll } from 'vitest'
import { prisma } from '../src/index.js'

// A per-run suffix keeps ids and emails unique, so a crashed earlier run that
// skipped cleanup cannot make this run fail on a unique constraint.
const RUN = Date.now().toString(36)
const email = (label: string) => `account-schema-${label}-${RUN}@example.com`
const id = (label: string) => `${label}-${RUN}`

afterAll(async () => {
  await prisma.user.deleteMany({ where: { email: { endsWith: `-${RUN}@example.com` } } })
  await prisma.$disconnect()
})

describe('Account', () => {
  it('lets a user exist with no password at all', async () => {
    const user = await prisma.user.create({ data: { email: email('nopass'), name: 'No Password' } })
    expect(user.passwordHash).toBeNull()
  })

  it('links more than one provider identity to the same user', async () => {
    const user = await prisma.user.create({
      data: {
        email: email('both'),
        name: 'Both',
        accounts: {
          create: [
            { provider: 'github', providerAccountId: id('gh-both') },
            { provider: 'google', providerAccountId: id('gg-both') },
          ],
        },
      },
      include: { accounts: true },
    })
    expect(user.accounts.map((account) => account.provider).sort()).toEqual(['github', 'google'])
  })

  it('refuses to link the same provider identity twice', async () => {
    await prisma.user.create({
      data: {
        email: email('first'),
        name: 'First',
        accounts: { create: { provider: 'github', providerAccountId: id('gh-dup') } },
      },
    })
    await expect(
      prisma.user.create({
        data: {
          email: email('second'),
          name: 'Second',
          accounts: { create: { provider: 'github', providerAccountId: id('gh-dup') } },
        },
      }),
    ).rejects.toMatchObject({ code: 'P2002' })
  })

  it('allows the same account id string under different providers', async () => {
    // Ids are stored as text. Nothing stops a GitHub id and a Google id from
    // being the same string, and they must not collide.
    await prisma.user.create({
      data: {
        email: email('gh-shared'),
        name: 'GH',
        accounts: { create: { provider: 'github', providerAccountId: id('shared') } },
      },
    })
    await expect(
      prisma.user.create({
        data: {
          email: email('gg-shared'),
          name: 'GG',
          accounts: { create: { provider: 'google', providerAccountId: id('shared') } },
        },
      }),
    ).resolves.toBeTruthy()
  })

  it('deletes linked identities when the user is deleted', async () => {
    const user = await prisma.user.create({
      data: {
        email: email('doomed'),
        name: 'Doomed',
        accounts: { create: { provider: 'google', providerAccountId: id('gg-doomed') } },
      },
    })
    await prisma.user.delete({ where: { id: user.id } })
    expect(await prisma.account.count({ where: { userId: user.id } })).toBe(0)
  })
})
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `pnpm test account.test`
Expected: FAIL — `prisma.account` does not exist, and `passwordHash` is required on `user.create`.

- [ ] **Step 3: Update the schema**

In `packages/db/prisma/schema.prisma`:

Change `passwordHash String` to `passwordHash String?` in `model User`, and add the relation as the last field of `User`:

```prisma
model User {
  id           String            @id @default(cuid())
  email        String            @unique
  name         String
  passwordHash String?
  createdAt    DateTime          @default(now())
  memberships  WorkspaceMember[]
  accounts     Account[]
}
```

Add this enum directly above `enum DocumentType` (one value per line — Prisma 7 requires it):

```prisma
enum AuthProvider {
  github
  google
}
```

Append this model at the end of the file:

```prisma
model Account {
  id                String       @id @default(cuid())
  userId            String
  provider          AuthProvider
  providerAccountId String
  createdAt         DateTime     @default(now())
  user              User         @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([provider, providerAccountId])
  @@index([userId])
}
```

- [ ] **Step 4: Write the migration**

Create `packages/db/prisma/migrations/20260921120000_oauth_accounts/migration.sql` with exactly this content. It was generated with `prisma migrate diff` from the old schema to the new one, so it matches what Prisma expects byte for byte:

```sql
-- CreateEnum
CREATE TYPE "AuthProvider" AS ENUM ('github', 'google');

-- AlterTable
ALTER TABLE "User" ALTER COLUMN "passwordHash" DROP NOT NULL;

-- CreateTable
CREATE TABLE "Account" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" "AuthProvider" NOT NULL,
    "providerAccountId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Account_userId_idx" ON "Account"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Account_provider_providerAccountId_key" ON "Account"("provider", "providerAccountId");

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
```

Nothing in it destroys data: one `DROP NOT NULL`, everything else additive.

- [ ] **Step 5: Apply it and regenerate the client**

The local database is shared with the user's main checkout. That is safe: the migration is non-destructive.

```bash
pnpm --filter @crdt/db exec prisma migrate deploy
pnpm --filter @crdt/db run generate
```

Expected: `migrate deploy` reports `20260921120000_oauth_accounts` applied.

- [ ] **Step 6: Confirm the database matches the schema exactly**

```bash
cd packages/db && pnpm exec prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script
```

Expected: an empty migration (`-- This is an empty migration.`). Any SQL here means the migration file and the schema disagree — fix the migration, never the database by hand.

- [ ] **Step 7: Run the tests**

Run: `pnpm test account.test` — Expected: PASS, 5 tests.
Run: `pnpm test` — Expected: everything green (the existing tests that pass `passwordHash: 'x'` are unaffected, because a nullable field still accepts a value).
Run: `pnpm typecheck` — Expected: clean.

- [ ] **Step 8: Commit**

```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations/20260921120000_oauth_accounts packages/db/test/account.test.ts
git commit -m "feat(db): add Account table for OAuth identities; make passwordHash nullable"
```

---

## Task 2: Error codes, provider definitions, and `APP_URL`

**Files:**
- Create: `apps/web/src/lib/oauth/errors.ts`
- Create: `apps/web/src/lib/oauth/providers.ts`
- Modify: `apps/web/src/lib/env.ts`
- Test: `apps/web/test/oauth-providers.test.ts`
- Test: `apps/web/test/env.test.ts` (append)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `type OAuthErrorCode = 'access_denied' | 'state_mismatch' | 'no_verified_email' | 'provider_unavailable' | 'provider_error'`
  - `class OAuthError extends Error { readonly code: OAuthErrorCode }` — `new OAuthError(code, message)`
  - `oauthErrorMessage(code: unknown): string | null` and `GENERIC_SIGNIN_ERROR: string`
  - `type ProviderId = 'github' | 'google'`, `PROVIDER_IDS`, `isProviderId(value: string): value is ProviderId`
  - `type OAuthProfile = { providerAccountId: string; email: string; name: string }`
  - `type OAuthClient = { clientId: string; clientSecret: string }`
  - `PROVIDERS: Record<ProviderId, { label; authorizeUrl; tokenUrl; scope; envPrefix; extraAuthorizeParams }>`
  - `NAME_MAX = 80`
  - `oauthClient(provider): OAuthClient | null`, `availableProviders(): ProviderId[]`
  - `githubProfile(user: unknown, emails: unknown): OAuthProfile`, `googleProfile(info: unknown): OAuthProfile`
  - `exchangeCode(provider, client, code, verifier, redirectUri): Promise<string>` (the access token)
  - `fetchProfile(provider, accessToken): Promise<OAuthProfile>`
  - `env.appUrl: string` — the validated origin, no trailing slash

- [ ] **Step 1: Write the failing provider tests**

Create `apps/web/test/oauth-providers.test.ts`:

```ts
import { describe, it, expect, afterEach, vi } from 'vitest'
import { OAuthError, oauthErrorMessage, GENERIC_SIGNIN_ERROR } from '../src/lib/oauth/errors.js'
import {
  availableProviders,
  exchangeCode,
  fetchProfile,
  githubProfile,
  googleProfile,
  isProviderId,
  oauthClient,
  NAME_MAX,
} from '../src/lib/oauth/providers.js'

const ENV_KEYS = ['GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET']
const saved = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]))

afterEach(() => {
  vi.unstubAllGlobals()
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key]
    else process.env[key] = saved[key]
  }
})

function expectCode(fn: () => unknown, code: string) {
  try {
    fn()
  } catch (error) {
    expect(error).toBeInstanceOf(OAuthError)
    expect((error as OAuthError).code).toBe(code)
    return
  }
  throw new Error(`expected OAuthError(${code}) but nothing was thrown`)
}

describe('isProviderId', () => {
  it('accepts exactly the supported providers', () => {
    expect(isProviderId('github')).toBe(true)
    expect(isProviderId('google')).toBe(true)
    expect(isProviderId('facebook')).toBe(false)
    expect(isProviderId('GitHub')).toBe(false)
  })
})

describe('githubProfile', () => {
  const user = { id: 583231, login: 'octocat', name: 'The Octocat' }

  it('uses the primary, verified address, trimmed and lowercased', () => {
    const profile = githubProfile(user, [
      { email: 'old@example.com', primary: false, verified: true },
      { email: '  Octo@Example.COM ', primary: true, verified: true },
    ])
    expect(profile).toEqual({ providerAccountId: '583231', email: 'octo@example.com', name: 'The Octocat' })
  })

  it('refuses a primary address GitHub has not verified', () => {
    expectCode(() => githubProfile(user, [{ email: 'octo@example.com', primary: true, verified: false }]), 'no_verified_email')
  })

  it('does not fall back to a verified secondary address', () => {
    // The primary is the address the person chose; a verified secondary is not a substitute.
    expectCode(
      () =>
        githubProfile(user, [
          { email: 'primary@example.com', primary: true, verified: false },
          { email: 'secondary@example.com', primary: false, verified: true },
        ]),
      'no_verified_email',
    )
  })

  it('refuses an account with no email addresses at all', () => {
    expectCode(() => githubProfile(user, []), 'no_verified_email')
  })

  it('falls back to the login when the display name is null or blank', () => {
    const emails = [{ email: 'octo@example.com', primary: true, verified: true }]
    expect(githubProfile({ ...user, name: null }, emails).name).toBe('octocat')
    expect(githubProfile({ ...user, name: '   ' }, emails).name).toBe('octocat')
  })

  it('truncates an absurdly long display name', () => {
    const emails = [{ email: 'octo@example.com', primary: true, verified: true }]
    expect(githubProfile({ ...user, name: 'x'.repeat(500) }, emails).name).toHaveLength(NAME_MAX)
  })

  it('treats a malformed response as a provider error, not a crash', () => {
    expectCode(() => githubProfile(null, []), 'provider_error')
    expectCode(() => githubProfile({ login: 'no-id' }, []), 'provider_error')
    expectCode(() => githubProfile(user, { not: 'a list' }), 'provider_error')
  })
})

describe('googleProfile', () => {
  it('accepts a verified email and normalizes it', () => {
    expect(googleProfile({ sub: '1098', email: 'Ada@Gmail.com', email_verified: true, name: 'Ada' })).toEqual({
      providerAccountId: '1098',
      email: 'ada@gmail.com',
      name: 'Ada',
    })
  })

  it('refuses an unverified email', () => {
    expectCode(() => googleProfile({ sub: '1', email: 'a@b.com', email_verified: false }), 'no_verified_email')
  })

  it('refuses email_verified sent as the string "true"', () => {
    expectCode(() => googleProfile({ sub: '1', email: 'a@b.com', email_verified: 'true' }), 'no_verified_email')
  })

  it('falls back to the email local part when there is no name', () => {
    expect(googleProfile({ sub: '1', email: 'grace@example.com', email_verified: true }).name).toBe('grace')
  })

  it('treats a missing subject as a provider error', () => {
    expectCode(() => googleProfile({ email: 'a@b.com', email_verified: true }), 'provider_error')
  })
})

describe('oauthClient and availableProviders', () => {
  it('returns trimmed credentials only when both halves are present', () => {
    process.env.GITHUB_CLIENT_ID = '  gh-id  '
    process.env.GITHUB_CLIENT_SECRET = 'gh-secret'
    delete process.env.GOOGLE_CLIENT_ID
    process.env.GOOGLE_CLIENT_SECRET = 'orphan-secret'

    expect(oauthClient('github')).toEqual({ clientId: 'gh-id', clientSecret: 'gh-secret' })
    expect(oauthClient('google')).toBeNull()
    expect(availableProviders()).toEqual(['github'])
  })

  it('treats a blank value as missing', () => {
    process.env.GITHUB_CLIENT_ID = '   '
    process.env.GITHUB_CLIENT_SECRET = 'gh-secret'
    expect(oauthClient('github')).toBeNull()
  })
})

describe('oauthErrorMessage', () => {
  it('returns null when there is no error', () => {
    expect(oauthErrorMessage(undefined)).toBeNull()
    expect(oauthErrorMessage('')).toBeNull()
  })

  it('maps a known code to its fixed message', () => {
    expect(oauthErrorMessage('access_denied')).toBe('Sign-in was cancelled.')
  })

  it('shows one generic message for anything else, never the raw value', () => {
    expect(oauthErrorMessage('Call 555-0100 to verify')).toBe(GENERIC_SIGNIN_ERROR)
    expect(oauthErrorMessage(['a', 'b'])).toBe(GENERIC_SIGNIN_ERROR)
  })

  it('is not fooled by keys inherited from Object.prototype', () => {
    // A naive MESSAGES[code] lookup returns a function for these.
    expect(oauthErrorMessage('toString')).toBe(GENERIC_SIGNIN_ERROR)
    expect(oauthErrorMessage('__proto__')).toBe(GENERIC_SIGNIN_ERROR)
    expect(oauthErrorMessage('constructor')).toBe(GENERIC_SIGNIN_ERROR)
  })
})

describe('exchangeCode', () => {
  const client = { clientId: 'cid', clientSecret: 'csecret' }

  it('posts the code, verifier and redirect URI and returns the access token', async () => {
    const fetchMock = vi.fn(async () => Response.json({ access_token: 'tok-123', token_type: 'bearer' }))
    vi.stubGlobal('fetch', fetchMock)

    const token = await exchangeCode('github', client, 'the-code', 'the-verifier', 'http://localhost:3000/cb')

    expect(token).toBe('tok-123')
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://github.com/login/oauth/access_token')
    expect((init.headers as Record<string, string>).accept).toBe('application/json')
    const body = new URLSearchParams(String(init.body))
    expect(body.get('grant_type')).toBe('authorization_code')
    expect(body.get('code')).toBe('the-code')
    expect(body.get('code_verifier')).toBe('the-verifier')
    expect(body.get('redirect_uri')).toBe('http://localhost:3000/cb')
    expect(body.get('client_id')).toBe('cid')
  })

  it('treats GitHub\'s HTTP-200-with-error response as a failure', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: 'bad_verification_code' })))
    await expect(exchangeCode('github', client, 'reused', 'v', 'http://x/cb')).rejects.toMatchObject({
      code: 'provider_error',
    })
  })

  it('treats a non-2xx response as a failure', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 401 })))
    await expect(exchangeCode('google', client, 'c', 'v', 'http://x/cb')).rejects.toMatchObject({
      code: 'provider_error',
    })
  })
})

describe('fetchProfile', () => {
  it('reads GitHub /user and /user/emails with a bearer token and a User-Agent', async () => {
    const fetchMock = vi.fn(async (url: string) =>
      url.endsWith('/user/emails')
        ? Response.json([{ email: 'octo@example.com', primary: true, verified: true }])
        : Response.json({ id: 1, login: 'octocat', name: null }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const profile = await fetchProfile('github', 'tok')

    expect(profile).toEqual({ providerAccountId: '1', email: 'octo@example.com', name: 'octocat' })
    for (const call of fetchMock.mock.calls as unknown as [string, RequestInit][]) {
      const headers = call[1].headers as Record<string, string>
      expect(headers.authorization).toBe('Bearer tok')
      // GitHub's REST API rejects requests with no User-Agent.
      expect(headers['user-agent']).toBeTruthy()
    }
  })

  it('reads the Google OpenID userinfo endpoint', async () => {
    const fetchMock = vi.fn(async () => Response.json({ sub: '77', email: 'g@example.com', email_verified: true }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(fetchProfile('google', 'tok')).resolves.toEqual({
      providerAccountId: '77',
      email: 'g@example.com',
      name: 'g',
    })
    expect((fetchMock.mock.calls[0] as unknown as [string])[0]).toBe(
      'https://openidconnect.googleapis.com/v1/userinfo',
    )
  })
})
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `pnpm test oauth-providers`
Expected: FAIL — cannot resolve `../src/lib/oauth/errors.js`.

- [ ] **Step 3: Implement `errors.ts`**

Create `apps/web/src/lib/oauth/errors.ts`:

```ts
export type OAuthErrorCode =
  | 'access_denied'
  | 'state_mismatch'
  | 'no_verified_email'
  | 'provider_unavailable'
  | 'provider_error'

export class OAuthError extends Error {
  constructor(
    readonly code: OAuthErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'OAuthError'
  }
}

const MESSAGES: Record<OAuthErrorCode, string> = {
  access_denied: 'Sign-in was cancelled.',
  state_mismatch: 'That sign-in attempt expired or was started in another tab. Please try again.',
  no_verified_email:
    'We need a verified email address from your account. Verify one with the provider, then try again.',
  provider_unavailable: 'That sign-in option is not available right now.',
  provider_error: 'Something went wrong while signing you in. Please try again.',
}

export const GENERIC_SIGNIN_ERROR = 'Sign-in failed. Please try again.'

/**
 * The message for a `?error=` value on the login page, or null when there is none.
 *
 * The value only ever SELECTS one of the fixed strings above; it is never shown.
 * Rendering it would let anyone put text of their choosing on our real login page
 * ("call this number to verify your account") with our domain in the address bar.
 */
export function oauthErrorMessage(code: unknown): string | null {
  if (code === undefined || code === null || code === '') return null
  if (typeof code !== 'string') return GENERIC_SIGNIN_ERROR
  // Object.hasOwn rather than MESSAGES[code]: ?error=toString or ?error=__proto__
  // would otherwise read an inherited property off the object.
  return Object.hasOwn(MESSAGES, code) ? MESSAGES[code as OAuthErrorCode] : GENERIC_SIGNIN_ERROR
}
```

- [ ] **Step 4: Implement `providers.ts`**

Create `apps/web/src/lib/oauth/providers.ts`:

```ts
import { OAuthError } from './errors.js'

export type ProviderId = 'github' | 'google'

export const PROVIDER_IDS: readonly ProviderId[] = ['github', 'google']

export function isProviderId(value: string): value is ProviderId {
  return (PROVIDER_IDS as readonly string[]).includes(value)
}

/** What a provider tells us about a person, already validated and normalized. */
export type OAuthProfile = {
  /** The provider's stable id for this person. Unlike the email, it never changes. */
  providerAccountId: string
  /** Provider-verified, trimmed, lowercased. */
  email: string
  /** Never empty, at most NAME_MAX characters. */
  name: string
}

export type OAuthClient = { clientId: string; clientSecret: string }

type ProviderSpec = {
  label: string
  authorizeUrl: string
  tokenUrl: string
  scope: string
  envPrefix: string
  extraAuthorizeParams: Readonly<Record<string, string>>
}

export const PROVIDERS: Readonly<Record<ProviderId, ProviderSpec>> = {
  github: {
    label: 'GitHub',
    authorizeUrl: 'https://github.com/login/oauth/authorize',
    tokenUrl: 'https://github.com/login/oauth/access_token',
    // user:email is what grants access to /user/emails and its `verified` flags.
    scope: 'read:user user:email',
    envPrefix: 'GITHUB',
    extraAuthorizeParams: {},
  },
  google: {
    label: 'Google',
    authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    scope: 'openid email profile',
    envPrefix: 'GOOGLE',
    // Lets someone signed into several Google accounts pick one, instead of
    // silently getting whichever the browser chooses.
    extraAuthorizeParams: { prompt: 'select_account' },
  },
}

export const NAME_MAX = 80
const REQUEST_TIMEOUT_MS = 10_000

/** The configured credentials for a provider, or null if either half is missing. */
export function oauthClient(provider: ProviderId): OAuthClient | null {
  const prefix = PROVIDERS[provider].envPrefix
  const clientId = process.env[`${prefix}_CLIENT_ID`]?.trim()
  const clientSecret = process.env[`${prefix}_CLIENT_SECRET`]?.trim()
  return clientId && clientSecret ? { clientId, clientSecret } : null
}

/** Providers with credentials set. Only these get a button on the login page. */
export function availableProviders(): ProviderId[] {
  return PROVIDER_IDS.filter((id) => oauthClient(id) !== null)
}

function normalizeEmail(raw: string): string | null {
  const email = raw.trim().toLowerCase()
  return email.includes('@') ? email : null
}

function displayName(raw: unknown, fallback: string): string {
  const name = typeof raw === 'string' ? raw.trim() : ''
  return (name || fallback).slice(0, NAME_MAX)
}

function asRecord(value: unknown, what: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new OAuthError('provider_error', `${what} was not an object`)
  }
  return value as Record<string, unknown>
}

export function githubProfile(user: unknown, emails: unknown): OAuthProfile {
  const u = asRecord(user, 'GitHub /user response')
  if ((typeof u.id !== 'number' && typeof u.id !== 'string') || typeof u.login !== 'string') {
    throw new OAuthError('provider_error', 'GitHub /user response is missing id or login')
  }
  if (!Array.isArray(emails)) {
    throw new OAuthError('provider_error', 'GitHub /user/emails response was not a list')
  }

  // Only the primary address, and only if GitHub has verified it. The profile's
  // public email is free text anyone can set to anything, and a verified
  // secondary address is not the one the person chose to be known by.
  const primary = emails
    .filter((entry): entry is Record<string, unknown> => typeof entry === 'object' && entry !== null)
    .find((entry) => entry.primary === true && entry.verified === true && typeof entry.email === 'string')
  const email = primary ? normalizeEmail(primary.email as string) : null
  if (!email) throw new OAuthError('no_verified_email', 'GitHub account has no verified primary email')

  return { providerAccountId: String(u.id), email, name: displayName(u.name, u.login) }
}

export function googleProfile(info: unknown): OAuthProfile {
  const i = asRecord(info, 'Google userinfo response')
  if (typeof i.sub !== 'string' || i.sub === '') {
    throw new OAuthError('provider_error', 'Google userinfo response is missing sub')
  }

  // Strictly the boolean true: a string "true" or a missing field is not proof.
  const email =
    i.email_verified === true && typeof i.email === 'string' ? normalizeEmail(i.email) : null
  if (!email) throw new OAuthError('no_verified_email', 'Google account email is not verified')

  return { providerAccountId: i.sub, email, name: displayName(i.name, email.split('@')[0]!) }
}

async function getJson(url: string, init: RequestInit): Promise<unknown> {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) })
  if (!response.ok) throw new OAuthError('provider_error', `${url} responded ${response.status}`)
  return response.json()
}

/** Trades an authorization code for an access token. Returns the token. */
export async function exchangeCode(
  provider: ProviderId,
  client: OAuthClient,
  code: string,
  verifier: string,
  redirectUri: string,
): Promise<string> {
  const json = await getJson(PROVIDERS[provider].tokenUrl, {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      client_id: client.clientId,
      client_secret: client.clientSecret,
      code_verifier: verifier,
    }),
  })

  // GitHub reports a failed exchange (a bad, expired or reused code) with HTTP 200
  // and an `error` field, so a successful status alone proves nothing.
  const token =
    typeof json === 'object' && json !== null ? (json as { access_token?: unknown }).access_token : undefined
  if (typeof token !== 'string' || token === '') {
    throw new OAuthError('provider_error', `${provider} token exchange returned no access_token`)
  }
  return token
}

const GITHUB_API_HEADERS = {
  accept: 'application/vnd.github+json',
  // GitHub's REST API rejects requests that carry no User-Agent.
  'user-agent': 'crdt-workspace',
  'x-github-api-version': '2022-11-28',
}

export async function fetchProfile(provider: ProviderId, accessToken: string): Promise<OAuthProfile> {
  if (provider === 'github') {
    const headers = { ...GITHUB_API_HEADERS, authorization: `Bearer ${accessToken}` }
    const [user, emails] = await Promise.all([
      getJson('https://api.github.com/user', { headers }),
      getJson('https://api.github.com/user/emails', { headers }),
    ])
    return githubProfile(user, emails)
  }

  const info = await getJson('https://openidconnect.googleapis.com/v1/userinfo', {
    headers: { authorization: `Bearer ${accessToken}` },
  })
  return googleProfile(info)
}
```

- [ ] **Step 5: Run the provider tests to verify they pass**

Run: `pnpm test oauth-providers`
Expected: PASS.

- [ ] **Step 6: Write the failing `APP_URL` tests**

Append to `apps/web/test/env.test.ts`:

```ts
describe('env.appUrl', () => {
  const ORIGINAL_APP_URL = process.env.APP_URL

  afterEach(() => {
    restore('APP_URL', ORIGINAL_APP_URL)
  })

  it('returns the origin, dropping any trailing slash or path', () => {
    process.env.APP_URL = 'https://crdt-web.onrender.com/'
    expect(env.appUrl).toBe('https://crdt-web.onrender.com')
    process.env.APP_URL = 'https://crdt-web.onrender.com/some/path?x=1'
    expect(env.appUrl).toBe('https://crdt-web.onrender.com')
  })

  it('accepts http for local development', () => {
    process.env.APP_URL = 'http://localhost:3000'
    expect(env.appUrl).toBe('http://localhost:3000')
  })

  it('throws when missing or blank', () => {
    delete process.env.APP_URL
    expect(() => env.appUrl).toThrow(/APP_URL must be set/)
    process.env.APP_URL = '   '
    expect(() => env.appUrl).toThrow(/APP_URL must be set/)
  })

  it('throws on something that is not a URL', () => {
    process.env.APP_URL = 'crdt-web.onrender.com'
    expect(() => env.appUrl).toThrow(/not a valid URL/)
  })

  it('throws on a non-http scheme', () => {
    process.env.APP_URL = 'ftp://example.com'
    expect(() => env.appUrl).toThrow(/http or https/)
  })
})
```

- [ ] **Step 7: Run it to make sure it fails**

Run: `pnpm test env.test`
Expected: FAIL — `env.appUrl` is undefined.

- [ ] **Step 8: Implement `env.appUrl`**

In `apps/web/src/lib/env.ts`, add this getter inside the `env` object, after `syncJwtSecret`:

```ts
  get appUrl() {
    const value = process.env.APP_URL?.trim()
    if (!value) {
      throw new Error('APP_URL must be set to the public origin, e.g. https://crdt-web.onrender.com')
    }
    let url: URL
    try {
      url = new URL(value)
    } catch {
      throw new Error(`APP_URL is not a valid URL: ${value}`)
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
      throw new Error(`APP_URL must be an http or https URL: ${value}`)
    }
    // The origin drops any path, query or trailing slash, so redirect URIs built
    // from it are always exactly <origin>/api/auth/oauth/<provider>/callback —
    // the form registered with each provider, which they match character for character.
    return url.origin
  },
```

- [ ] **Step 9: Run the tests**

Run: `pnpm test env.test oauth-providers` — Expected: PASS.
Run: `pnpm typecheck` — Expected: clean.

- [ ] **Step 10: Prove the tests discriminate, then restore**

1. In `githubProfile`, delete `entry.primary === true &&`. Run `pnpm test oauth-providers`. Expected: `does not fall back to a verified secondary address` FAILS.
2. In `googleProfile`, change `i.email_verified === true` to `i.email_verified`. Expected: `refuses email_verified sent as the string "true"` FAILS.
3. In `oauthErrorMessage`, replace the `Object.hasOwn(...)` expression with `(MESSAGES as Record<string, string>)[code] ?? GENERIC_SIGNIN_ERROR`. Expected: the Object.prototype test FAILS.
4. In `exchangeCode`, replace the token check with `return (json as { access_token: string }).access_token`. Expected: the HTTP-200-with-error test FAILS.

Restore each with `git checkout -- <file>` or by undoing the edit; re-run and confirm green. Report the observed failures.

- [ ] **Step 11: Commit**

```bash
git add apps/web/src/lib/oauth/errors.ts apps/web/src/lib/oauth/providers.ts apps/web/src/lib/env.ts apps/web/test/oauth-providers.test.ts apps/web/test/env.test.ts
git commit -m "feat(auth): add OAuth provider definitions, profile validation, and APP_URL"
```

---

## Task 3: PKCE and the signed flow cookie

**Files:**
- Create: `apps/web/src/lib/oauth/flow.ts`
- Create: `apps/web/src/lib/oauth/http.ts`
- Test: `apps/web/test/oauth-flow.test.ts`

**Interfaces:**
- Consumes: `isProviderId`, `ProviderId` from `./providers.js`; `OAuthErrorCode` from `./errors.js` (Task 2).
- Produces:
  - `OAUTH_COOKIE = 'crdt_oauth'`, `FLOW_TTL_SECONDS = 600`
  - `type FlowState = { provider: ProviderId; state: string; verifier: string; next: string; issuedAt: number }`
  - `newFlow(provider: ProviderId, next: string, now?: number): FlowState`
  - `pkceChallenge(verifier: string): string`
  - `flowCookie(flow: FlowState, secret: string): string` — a full `Set-Cookie` value
  - `clearFlowCookie(): string`
  - `readFlowCookie(cookieHeader: string | null, secret: string, now?: number): FlowState | null`
  - `statesMatch(expected: string, received: string): boolean`
  - `redirectResponse(location: string | URL, cookies?: readonly string[]): Response` (302)
  - `callbackUrl(appUrl: string, provider: ProviderId): string`
  - `loginErrorUrl(appUrl: string, code: OAuthErrorCode, next: string): string`

- [ ] **Step 1: Write the failing test**

Create `apps/web/test/oauth-flow.test.ts`:

```ts
import { describe, it, expect, afterEach, vi } from 'vitest'
import {
  FLOW_TTL_SECONDS,
  OAUTH_COOKIE,
  clearFlowCookie,
  flowCookie,
  newFlow,
  pkceChallenge,
  readFlowCookie,
  statesMatch,
} from '../src/lib/oauth/flow.js'
import { callbackUrl, loginErrorUrl, redirectResponse } from '../src/lib/oauth/http.js'

const SECRET = 'flow-cookie-test-secret-long-enough!!'
const NOW = 1_800_000_000_000

afterEach(() => {
  vi.unstubAllEnvs()
})

/** "crdt_oauth=<value>; Path=...; ..." -> "crdt_oauth=<value>", as a browser would send it back. */
const asRequestCookie = (setCookie: string) => setCookie.split(';')[0]!

describe('pkceChallenge', () => {
  it('matches the RFC 7636 Appendix B test vector', () => {
    expect(pkceChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe(
      'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
    )
  })
})

describe('newFlow', () => {
  it('makes a fresh, URL-safe state and a verifier of legal PKCE length each time', () => {
    const a = newFlow('github', '/', NOW)
    const b = newFlow('github', '/', NOW)
    expect(a.state).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(a.verifier).toMatch(/^[A-Za-z0-9_-]{43,128}$/)
    expect(a.state).not.toBe(b.state)
    expect(a.verifier).not.toBe(b.verifier)
    expect(a.issuedAt).toBe(Math.floor(NOW / 1000))
  })
})

describe('flow cookie', () => {
  it('round-trips', () => {
    const flow = newFlow('google', '/workspaces/abc', NOW)
    const cookie = asRequestCookie(flowCookie(flow, SECRET))
    expect(readFlowCookie(cookie, SECRET, NOW)).toEqual(flow)
  })

  it('is found among other cookies', () => {
    const flow = newFlow('github', '/', NOW)
    const header = `crdt_session=abc; ${asRequestCookie(flowCookie(flow, SECRET))}; theme=dark`
    expect(readFlowCookie(header, SECRET, NOW)).toEqual(flow)
  })

  it('is HttpOnly, SameSite=Lax, scoped to the OAuth routes, and short-lived', () => {
    const cookie = flowCookie(newFlow('github', '/', NOW), SECRET)
    expect(cookie).toContain('HttpOnly')
    // Lax, not Strict: the provider returns the browser with a cross-site
    // top-level GET, and a Strict cookie would be withheld from it.
    expect(cookie).toContain('SameSite=Lax')
    expect(cookie).toContain('Path=/api/auth/oauth')
    expect(cookie).toContain(`Max-Age=${FLOW_TTL_SECONDS}`)
    expect(cookie).not.toContain('Secure')
  })

  it('is Secure in production', () => {
    vi.stubEnv('NODE_ENV', 'production')
    expect(flowCookie(newFlow('github', '/', NOW), SECRET)).toContain('Secure')
  })

  it('rejects a cookie whose payload was edited', () => {
    const flow = newFlow('github', '/', NOW)
    const [name, value] = asRequestCookie(flowCookie(flow, SECRET)).split('=') as [string, string]
    const [, signature] = value.split('.')
    const forged = Buffer.from(JSON.stringify({ ...flow, next: '//evil.example' })).toString('base64url')
    expect(readFlowCookie(`${name}=${forged}.${signature}`, SECRET, NOW)).toBeNull()
  })

  it('rejects a cookie signed with a different secret', () => {
    const cookie = asRequestCookie(flowCookie(newFlow('github', '/', NOW), 'another-secret-entirely-long-enough'))
    expect(readFlowCookie(cookie, SECRET, NOW)).toBeNull()
  })

  it('rejects a cookie older than its lifetime', () => {
    const cookie = asRequestCookie(flowCookie(newFlow('github', '/', NOW), SECRET))
    expect(readFlowCookie(cookie, SECRET, NOW + (FLOW_TTL_SECONDS + 1) * 1000)).toBeNull()
    expect(readFlowCookie(cookie, SECRET, NOW + FLOW_TTL_SECONDS * 1000)).not.toBeNull()
  })

  it('rejects a cookie issued in the future', () => {
    const cookie = asRequestCookie(flowCookie(newFlow('github', '/', NOW + 60_000), SECRET))
    expect(readFlowCookie(cookie, SECRET, NOW)).toBeNull()
  })

  it('returns null, never throws, on missing or garbage input', () => {
    expect(readFlowCookie(null, SECRET, NOW)).toBeNull()
    expect(readFlowCookie('', SECRET, NOW)).toBeNull()
    expect(readFlowCookie('theme=dark', SECRET, NOW)).toBeNull()
    expect(readFlowCookie(`${OAUTH_COOKIE}=%%%`, SECRET, NOW)).toBeNull()
    expect(readFlowCookie(`${OAUTH_COOKIE}=a.b.c`, SECRET, NOW)).toBeNull()
    expect(readFlowCookie(`${OAUTH_COOKIE}=onlyonepart`, SECRET, NOW)).toBeNull()
  })

  it('is cleared with the same Path, which is the only way a browser will remove it', () => {
    const cleared = clearFlowCookie()
    expect(cleared).toMatch(new RegExp(`^${OAUTH_COOKIE}=;`))
    expect(cleared).toContain('Max-Age=0')
    expect(cleared).toContain('Path=/api/auth/oauth')
  })
})

describe('statesMatch', () => {
  it('compares exactly, and treats a length mismatch as unequal instead of throwing', () => {
    expect(statesMatch('abc', 'abc')).toBe(true)
    expect(statesMatch('abc', 'abd')).toBe(false)
    expect(statesMatch('abc', 'abcd')).toBe(false)
    expect(statesMatch('abc', '')).toBe(false)
  })
})

describe('http helpers', () => {
  it('builds a 302 that can carry more than one cookie', () => {
    const response = redirectResponse('http://localhost:3000/', ['a=1; Path=/', 'b=2; Path=/'])
    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toBe('http://localhost:3000/')
    expect(response.headers.getSetCookie()).toEqual(['a=1; Path=/', 'b=2; Path=/'])
  })

  it('builds the callback URL registered with the provider', () => {
    expect(callbackUrl('https://crdt-web.onrender.com', 'google')).toBe(
      'https://crdt-web.onrender.com/api/auth/oauth/google/callback',
    )
  })

  it('builds a login error URL, omitting next when it is just the default', () => {
    expect(loginErrorUrl('http://localhost:3000', 'access_denied', '/')).toBe(
      'http://localhost:3000/login?error=access_denied',
    )
    expect(loginErrorUrl('http://localhost:3000', 'state_mismatch', '/workspaces/abc')).toBe(
      'http://localhost:3000/login?error=state_mismatch&next=%2Fworkspaces%2Fabc',
    )
  })
})
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `pnpm test oauth-flow`
Expected: FAIL — cannot resolve `../src/lib/oauth/flow.js`.

- [ ] **Step 3: Implement `flow.ts`**

Create `apps/web/src/lib/oauth/flow.ts`:

```ts
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { isProviderId, type ProviderId } from './providers.js'

export const OAUTH_COOKIE = 'crdt_oauth'
export const FLOW_TTL_SECONDS = 600
// Scoped to the OAuth routes, so it is not sent with every request to the app.
const COOKIE_PATH = '/api/auth/oauth'

/** Everything the callback needs to finish a sign-in the start route began. */
export type FlowState = {
  provider: ProviderId
  /** Echoed back by the provider; must match, or the callback is a forgery. */
  state: string
  /** PKCE secret. The provider only ever saw its SHA-256 challenge. */
  verifier: string
  /** Already passed through safeNext by the start route. */
  next: string
  /** Seconds since the epoch. */
  issuedAt: number
}

const randomToken = () => randomBytes(32).toString('base64url')

export function newFlow(provider: ProviderId, next: string, now = Date.now()): FlowState {
  return {
    provider,
    next,
    state: randomToken(),
    // 32 random bytes → 43 base64url characters, the minimum PKCE verifier length.
    verifier: randomToken(),
    issuedAt: Math.floor(now / 1000),
  }
}

/** RFC 7636 S256: BASE64URL(SHA256(verifier)). */
export function pkceChallenge(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url')
}

function sign(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('base64url')
}

function attributes(maxAge: number): string[] {
  // SameSite=Lax, not Strict: the provider sends the browser back with a
  // cross-site top-level GET. Browsers send Lax cookies on that navigation and
  // withhold Strict ones, which would fail every sign-in with state_mismatch.
  const parts = [`Path=${COOKIE_PATH}`, 'HttpOnly', 'SameSite=Lax', `Max-Age=${maxAge}`]
  if (process.env.NODE_ENV === 'production') parts.push('Secure')
  return parts
}

/**
 * The Set-Cookie value holding the flow. Signed with HMAC: on onrender.com the
 * Public Suffix List already stops sibling apps from planting cookies here, but
 * the signature keeps the flow safe on any future custom domain whose other
 * subdomains might not be trustworthy.
 */
export function flowCookie(flow: FlowState, secret: string): string {
  const payload = Buffer.from(JSON.stringify(flow)).toString('base64url')
  return [`${OAUTH_COOKIE}=${payload}.${sign(payload, secret)}`, ...attributes(FLOW_TTL_SECONDS)].join('; ')
}

export function clearFlowCookie(): string {
  return [`${OAUTH_COOKIE}=`, ...attributes(0)].join('; ')
}

function cookieValue(header: string | null, name: string): string | null {
  if (!header) return null
  for (const part of header.split(';')) {
    const trimmed = part.trim()
    if (trimmed.startsWith(`${name}=`)) return trimmed.slice(name.length + 1)
  }
  return null
}

function isFlowState(value: unknown): value is FlowState {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return (
    typeof v.provider === 'string' &&
    isProviderId(v.provider) &&
    typeof v.state === 'string' &&
    v.state.length > 0 &&
    typeof v.verifier === 'string' &&
    v.verifier.length >= 43 &&
    v.verifier.length <= 128 &&
    typeof v.next === 'string' &&
    typeof v.issuedAt === 'number' &&
    Number.isInteger(v.issuedAt)
  )
}

/** The flow from a Cookie request header, or null if absent, forged, malformed or expired. */
export function readFlowCookie(cookieHeader: string | null, secret: string, now = Date.now()): FlowState | null {
  const raw = cookieValue(cookieHeader, OAUTH_COOKIE)
  if (!raw) return null

  const [payload, signature, extra] = raw.split('.')
  if (!payload || !signature || extra !== undefined) return null
  if (!statesMatch(signature, sign(payload, secret))) return null

  let parsed: unknown
  try {
    parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
  } catch {
    return null
  }
  if (!isFlowState(parsed)) return null

  // The browser enforces Max-Age too; checking here as well means a cookie
  // copied out of a browser cannot be replayed later.
  const age = Math.floor(now / 1000) - parsed.issuedAt
  if (age < 0 || age > FLOW_TTL_SECONDS) return null
  return parsed
}

/** Constant-time string comparison. A length mismatch is simply "not equal". */
export function statesMatch(expected: string, received: string): boolean {
  const a = Buffer.from(expected)
  const b = Buffer.from(received)
  return a.length === b.length && timingSafeEqual(a, b)
}
```

- [ ] **Step 4: Implement `http.ts`**

Create `apps/web/src/lib/oauth/http.ts`:

```ts
import type { OAuthErrorCode } from './errors.js'
import type { ProviderId } from './providers.js'

/**
 * A 302 that can set cookies. Not Response.redirect(): the Response it returns
 * has immutable headers, so it cannot carry Set-Cookie.
 */
export function redirectResponse(location: string | URL, cookies: readonly string[] = []): Response {
  const headers = new Headers({ location: location.toString() })
  for (const cookie of cookies) headers.append('set-cookie', cookie)
  return new Response(null, { status: 302, headers })
}

/** Must match, character for character, the callback URL registered with the provider. */
export function callbackUrl(appUrl: string, provider: ProviderId): string {
  return `${appUrl}/api/auth/oauth/${provider}/callback`
}

/** `next` must already have been through safeNext. */
export function loginErrorUrl(appUrl: string, code: OAuthErrorCode, next: string): string {
  const url = new URL('/login', appUrl)
  url.searchParams.set('error', code)
  if (next !== '/') url.searchParams.set('next', next)
  return url.toString()
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm test oauth-flow` — Expected: PASS.
Run: `pnpm typecheck` — Expected: clean.

- [ ] **Step 6: Prove the tests discriminate, then restore**

1. In `readFlowCookie`, delete the line `if (!statesMatch(signature, sign(payload, secret))) return null`. Expected: the edited-payload and different-secret tests FAIL.
2. Delete the `age` check. Expected: the older-than-lifetime and future tests FAIL.
3. In `attributes`, change `SameSite=Lax` to `SameSite=Strict`. Expected: the attributes test FAILS.

Restore each and confirm green. Report the observed failures.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/lib/oauth/flow.ts apps/web/src/lib/oauth/http.ts apps/web/test/oauth-flow.test.ts
git commit -m "feat(auth): add PKCE and a signed, short-lived OAuth flow cookie"
```

---

## Task 4: Resolving a provider identity to a user

**Files:**
- Create: `apps/web/src/lib/oauth/resolve-user.ts`
- Test: `apps/web/test/oauth-resolve-user.integration.test.ts`

**Interfaces:**
- Consumes: `OAuthProfile`, `ProviderId` from `./providers.js` (Task 2); Prisma `account` model (Task 1).
- Produces: `resolveOAuthUser(provider: ProviderId, profile: OAuthProfile): Promise<{ id: string }>`

**The three rules** (Decision 4) are the security core of this plan. Rule 2 — linking a provider identity to an existing user by email — is only safe because, after Task 6, every way a user row can come into existence is trusted: a previous provider-verified sign-in, or the operator's seed script. That is precisely why the password routes must be deleted rather than hidden.

- [ ] **Step 1: Write the failing test**

Create `apps/web/test/oauth-resolve-user.integration.test.ts`:

```ts
import { describe, it, expect, afterAll } from 'vitest'
import { prisma } from '@crdt/db'
import { resolveOAuthUser } from '../src/lib/oauth/resolve-user.js'

const RUN = Date.now().toString(36)
const email = (label: string) => `resolve-${label}-${RUN}@example.com`
const id = (label: string) => `${label}-${RUN}`

afterAll(async () => {
  const users = await prisma.user.findMany({
    where: { email: { endsWith: `-${RUN}@example.com` } },
    select: { id: true },
  })
  const ids = users.map((user) => user.id)
  // Workspace.ownerId is a plain string column, not a relation, so deleting a
  // user does not cascade to their workspace. Delete workspaces first.
  await prisma.workspace.deleteMany({ where: { ownerId: { in: ids } } })
  await prisma.user.deleteMany({ where: { id: { in: ids } } })
  await prisma.$disconnect()
})

async function footprint(userEmail: string) {
  const users = await prisma.user.findMany({ where: { email: userEmail }, select: { id: true } })
  const ids = users.map((user) => user.id)
  return {
    users: users.length,
    accounts: await prisma.account.count({ where: { userId: { in: ids } } }),
    workspaces: await prisma.workspace.count({ where: { ownerId: { in: ids } } }),
  }
}

describe('resolveOAuthUser', () => {
  it('creates a password-less user, links the identity, and gives them a workspace they own', async () => {
    const user = await resolveOAuthUser('github', { providerAccountId: id('new'), email: email('new'), name: 'Ada' })

    const row = await prisma.user.findUnique({
      where: { id: user.id },
      include: { accounts: true, memberships: { include: { workspace: true } } },
    })
    expect(row?.email).toBe(email('new'))
    expect(row?.passwordHash).toBeNull()
    expect(row?.accounts).toEqual([
      expect.objectContaining({ provider: 'github', providerAccountId: id('new') }),
    ])
    expect(row?.memberships).toHaveLength(1)
    expect(row?.memberships[0]?.role).toBe('owner')
    expect(row?.memberships[0]?.workspace.name).toBe("Ada's workspace")
    expect(row?.memberships[0]?.workspace.ownerId).toBe(user.id)
  })

  it('signs a returning identity into the same user and creates nothing new', async () => {
    const profile = { providerAccountId: id('return'), email: email('return'), name: 'Grace' }
    const first = await resolveOAuthUser('google', profile)
    const before = await footprint(email('return'))

    const second = await resolveOAuthUser('google', profile)

    expect(second.id).toBe(first.id)
    expect(await footprint(email('return'))).toEqual(before)
  })

  it('links a second provider to the user who already has that verified email', async () => {
    const viaGithub = await resolveOAuthUser('github', {
      providerAccountId: id('gh-both'),
      email: email('both'),
      name: 'Both',
    })
    const viaGoogle = await resolveOAuthUser('google', {
      providerAccountId: id('gg-both'),
      email: email('both'),
      name: 'Both (Google)',
    })

    expect(viaGoogle.id).toBe(viaGithub.id)
    expect(await footprint(email('both'))).toEqual({ users: 1, accounts: 2, workspaces: 1 })
  })

  it('follows the identity, not the email, when the provider email has changed', async () => {
    const original = await resolveOAuthUser('github', {
      providerAccountId: id('moved'),
      email: email('moved-old'),
      name: 'Mover',
    })

    const after = await resolveOAuthUser('github', {
      providerAccountId: id('moved'),
      email: email('moved-new'),
      name: 'Mover',
    })

    expect(after.id).toBe(original.id)
    expect(await footprint(email('moved-new'))).toEqual({ users: 0, accounts: 0, workspaces: 0 })
  })

  it('links to a pre-existing user row with that email without giving them a second workspace', async () => {
    // How the operator's seed script creates the demo owner: a user row with no identity yet.
    const seeded = await prisma.user.create({ data: { email: email('seeded'), name: 'Seeded' } })

    const user = await resolveOAuthUser('google', {
      providerAccountId: id('seeded'),
      email: email('seeded'),
      name: 'Seeded Person',
    })

    expect(user.id).toBe(seeded.id)
    expect(await footprint(email('seeded'))).toEqual({ users: 1, accounts: 1, workspaces: 0 })
  })

  it('survives two simultaneous first sign-ins for the same identity', async () => {
    // A double click, or two tabs. Whichever loses the race hits a unique
    // constraint and must still end up signed into the winner's user.
    const profile = { providerAccountId: id('race'), email: email('race'), name: 'Racer' }

    const [a, b] = await Promise.all([resolveOAuthUser('github', profile), resolveOAuthUser('github', profile)])

    expect(a.id).toBe(b.id)
    expect(await footprint(email('race'))).toEqual({ users: 1, accounts: 1, workspaces: 1 })
  })
})
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `pnpm test oauth-resolve-user`
Expected: FAIL — cannot resolve `../src/lib/oauth/resolve-user.js`.

- [ ] **Step 3: Implement `resolve-user.ts`**

Create `apps/web/src/lib/oauth/resolve-user.ts`:

```ts
import { prisma } from '@crdt/db'
import type { OAuthProfile, ProviderId } from './providers.js'

/**
 * The user a verified provider identity signs into, creating one if needed.
 * `profile.email` must already be provider-verified and normalized (providers.ts).
 */
export async function resolveOAuthUser(provider: ProviderId, profile: OAuthProfile): Promise<{ id: string }> {
  try {
    return await attempt(provider, profile)
  } catch (error) {
    // Two first sign-ins for the same person can race (a double click, two tabs).
    // The loser trips a unique constraint on the email or on the identity; by the
    // time it does, the winner's rows are committed, so one re-run takes the
    // "already linked" path. A second failure is a real error and propagates.
    if (isUniqueViolation(error)) return attempt(provider, profile)
    throw error
  }
}

async function attempt(provider: ProviderId, profile: OAuthProfile): Promise<{ id: string }> {
  const identity = { provider, providerAccountId: profile.providerAccountId }

  // Rule 1: a known identity always maps to its user, even if the email the
  // provider reports has changed since. The identity id is stable; email is not.
  const linked = await prisma.account.findUnique({
    where: { provider_providerAccountId: identity },
    select: { userId: true },
  })
  if (linked) return { id: linked.userId }

  // Rule 2: link to the user who already has this email. Safe only because every
  // way a user row can exist is trusted: an earlier provider-verified sign-in, or
  // the operator's seed script. Password sign-up — which let someone create a row
  // for an address they did not own — no longer exists.
  const existing = await prisma.user.findUnique({ where: { email: profile.email }, select: { id: true } })
  if (existing) {
    await prisma.account.create({ data: { ...identity, userId: existing.id } })
    return existing
  }

  // Rule 3: someone new. User, identity and personal workspace are created in one
  // transaction, so a failure part-way cannot leave a user with nowhere to land.
  return prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: { email: profile.email, name: profile.name, accounts: { create: identity } },
      select: { id: true },
    })
    await tx.workspace.create({
      data: {
        name: `${profile.name}'s workspace`,
        ownerId: user.id,
        members: { create: { userId: user.id, role: 'owner' } },
      },
    })
    return user
  })
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'P2002'
}
```

- [ ] **Step 4: Run the tests**

Run: `pnpm test oauth-resolve-user` — Expected: PASS, 6 tests.
Run: `pnpm typecheck` — Expected: clean.

If the interactive `$transaction` fails under the `pg` driver adapter, report the exact error rather than switching to separate writes — the atomicity is the point of Rule 3.

- [ ] **Step 5: Prove the tests discriminate, then restore**

1. In `resolveOAuthUser`, replace the body with `return attempt(provider, profile)` (no retry). Run the race test **five times** (`pnpm test oauth-resolve-user -t simultaneous`). Expected: it FAILS at least once with a `P2002`. Report how many of the five failed. If none fail, say so plainly — the race may not interleave on this machine; do not claim a failure you did not see.
2. In Rule 1, look up by email first instead of by identity. Expected: `follows the identity, not the email` FAILS.
3. Move `tx.workspace.create` outside the transaction and make it throw (`throw new Error('boom')` just before it). Confirm no orphaned user is left behind with the transaction in place, and that one is left behind without it. Report both.

Restore and confirm green.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/oauth/resolve-user.ts apps/web/test/oauth-resolve-user.integration.test.ts
git commit -m "feat(auth): resolve OAuth identities to users with safe linking rules"
```

---

## Task 5: The OAuth start and callback routes

**Files:**
- Create: `apps/web/src/app/api/auth/oauth/[provider]/route.ts`
- Create: `apps/web/src/app/api/auth/oauth/[provider]/callback/route.ts`
- Test: `apps/web/test/oauth-routes.integration.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 2–4; `env.appUrl`, `env.sessionSecret`; `safeNext` from `@/lib/safe-next`; `signSession`, `sessionCookie` from `@/lib/session` (existing, unchanged).
- Produces:
  - `GET /api/auth/oauth/:provider?next=<path>` → 302 to the provider, setting `crdt_oauth`
  - `GET /api/auth/oauth/:provider/callback?code&state` → 302 to `next` with `crdt_session` set, or 302 to `/login?error=<code>[&next=…]`; always clears `crdt_oauth`

- [ ] **Step 1: Write the failing test**

Create `apps/web/test/oauth-routes.integration.test.ts`:

```ts
import { createHash } from 'node:crypto'
import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest'
import { prisma } from '@crdt/db'
import { GET as start } from '../src/app/api/auth/oauth/[provider]/route.js'
import { GET as callback } from '../src/app/api/auth/oauth/[provider]/callback/route.js'
import { flowCookie } from '../src/lib/oauth/flow.js'
import { SESSION_COOKIE, verifySession } from '../src/lib/session.js'

const SECRET = 'session-secret-long-enough-for-oauth-route-tests!!'
const APP = 'http://localhost:3000'
const RUN = Date.now().toString(36)
const email = (label: string) => `oauth-route-${label}-${RUN}@example.com`

beforeAll(() => {
  process.env.SESSION_SECRET = SECRET
  process.env.APP_URL = APP
  process.env.GITHUB_CLIENT_ID = 'gh-client'
  process.env.GITHUB_CLIENT_SECRET = 'gh-secret'
  process.env.GOOGLE_CLIENT_ID = 'gg-client'
  process.env.GOOGLE_CLIENT_SECRET = 'gg-secret'
})

afterEach(() => {
  vi.unstubAllGlobals()
})

afterAll(async () => {
  const users = await prisma.user.findMany({
    where: { email: { endsWith: `-${RUN}@example.com` } },
    select: { id: true },
  })
  const ids = users.map((user) => user.id)
  await prisma.workspace.deleteMany({ where: { ownerId: { in: ids } } })
  await prisma.user.deleteMany({ where: { id: { in: ids } } })
  await prisma.$disconnect()
})

const params = (provider: string) => ({ params: Promise.resolve({ provider }) })

async function begin(provider: string, next?: string) {
  const url = new URL(`${APP}/api/auth/oauth/${provider}`)
  if (next !== undefined) url.searchParams.set('next', next)
  const response = await start(new Request(url), params(provider))
  const location = new URL(response.headers.get('location')!)
  const setCookie = response.headers.getSetCookie().find((c) => c.startsWith('crdt_oauth='))
  return {
    response,
    location,
    /** What the browser would send back: "crdt_oauth=<value>". */
    cookie: setCookie?.split(';')[0],
    state: location.searchParams.get('state') ?? '',
  }
}

async function finish(provider: string, query: Record<string, string>, cookie?: string) {
  const url = new URL(`${APP}/api/auth/oauth/${provider}/callback`)
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value)
  return callback(new Request(url, { headers: cookie ? { cookie } : {} }), params(provider))
}

/** Fakes GitHub's token, /user and /user/emails endpoints. */
function stubGithub(opts: { accountId: string; email: string; verified?: boolean; token?: unknown }) {
  const fetchMock = vi.fn(async (input: string | URL | Request) => {
    const url = String(input)
    if (url === 'https://github.com/login/oauth/access_token') {
      return Response.json(opts.token ?? { access_token: 'gh-token' })
    }
    if (url === 'https://api.github.com/user') {
      return Response.json({ id: opts.accountId, login: 'octo', name: 'Octo Cat' })
    }
    if (url === 'https://api.github.com/user/emails') {
      return Response.json([{ email: opts.email, primary: true, verified: opts.verified ?? true }])
    }
    return new Response(`unexpected request to ${url}`, { status: 500 })
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

describe('GET /api/auth/oauth/:provider', () => {
  it('sends the browser to GitHub with state, PKCE and the registered callback URL', async () => {
    const { response, location, cookie } = await begin('github')

    expect(response.status).toBe(302)
    expect(location.origin + location.pathname).toBe('https://github.com/login/oauth/authorize')
    expect(location.searchParams.get('client_id')).toBe('gh-client')
    expect(location.searchParams.get('redirect_uri')).toBe(`${APP}/api/auth/oauth/github/callback`)
    expect(location.searchParams.get('response_type')).toBe('code')
    expect(location.searchParams.get('scope')).toBe('read:user user:email')
    expect(location.searchParams.get('state')).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(location.searchParams.get('code_challenge')).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(location.searchParams.get('code_challenge_method')).toBe('S256')
    expect(cookie).toMatch(/^crdt_oauth=/)
  })

  it('asks Google to let the person choose an account', async () => {
    const { location } = await begin('google')
    expect(location.origin + location.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth')
    expect(location.searchParams.get('prompt')).toBe('select_account')
  })

  it('refuses an unknown provider without setting a cookie', async () => {
    const { location, cookie } = await begin('facebook', '/workspaces/abc')
    expect(location.toString()).toBe(`${APP}/login?error=provider_unavailable&next=%2Fworkspaces%2Fabc`)
    expect(cookie).toBeUndefined()
  })

  it('refuses a provider with no credentials configured', async () => {
    const saved = process.env.GOOGLE_CLIENT_SECRET
    delete process.env.GOOGLE_CLIENT_SECRET
    try {
      const { location, cookie } = await begin('google')
      expect(location.toString()).toBe(`${APP}/login?error=provider_unavailable`)
      expect(cookie).toBeUndefined()
    } finally {
      process.env.GOOGLE_CLIENT_SECRET = saved
    }
  })
})

describe('GET /api/auth/oauth/:provider/callback', () => {
  it('signs a new person in, gives them a workspace, and returns them to where they were going', async () => {
    const accountId = `gh-happy-${RUN}`
    stubGithub({ accountId, email: `  ${email('happy').toUpperCase()} ` })
    const { cookie, state } = await begin('github', '/workspaces/abc')

    const response = await finish('github', { code: 'the-code', state }, cookie)

    expect(response.status).toBe(302)
    expect(response.headers.get('location')).toBe(`${APP}/workspaces/abc`)

    const setCookies = response.headers.getSetCookie()
    // The flow cookie is spent...
    expect(setCookies.some((c) => c.startsWith('crdt_oauth=;') && c.includes('Max-Age=0'))).toBe(true)
    // ...and a real session is issued for the user we just created.
    const session = setCookies.find((c) => c.startsWith(`${SESSION_COOKIE}=`))!
    const userId = await verifySession(session.split(';')[0]!.slice(SESSION_COOKIE.length + 1), SECRET)
    const user = await prisma.user.findUnique({ where: { id: userId }, include: { accounts: true } })
    expect(user?.email).toBe(email('happy'))
    expect(user?.accounts[0]?.providerAccountId).toBe(accountId)
    expect(await prisma.workspace.count({ where: { ownerId: userId } })).toBe(1)
  })

  it('sends the PKCE verifier whose hash is the challenge it gave the provider', async () => {
    const fetchMock = stubGithub({ accountId: `gh-pkce-${RUN}`, email: email('pkce') })
    const { cookie, state, location } = await begin('github')

    await finish('github', { code: 'c', state }, cookie)

    const tokenCall = (fetchMock.mock.calls as unknown as [string, RequestInit][]).find(
      ([url]) => url === 'https://github.com/login/oauth/access_token',
    )!
    const body = new URLSearchParams(String(tokenCall[1].body))
    const verifier = body.get('code_verifier')!
    expect(createHash('sha256').update(verifier).digest('base64url')).toBe(
      location.searchParams.get('code_challenge'),
    )
    expect(body.get('redirect_uri')).toBe(`${APP}/api/auth/oauth/github/callback`)
  })

  it('rejects a mismatched state before making any network call', async () => {
    const fetchMock = stubGithub({ accountId: `gh-csrf-${RUN}`, email: email('csrf') })
    const { cookie } = await begin('github', '/workspaces/abc')

    const response = await finish('github', { code: 'attacker-code', state: 'x'.repeat(43) }, cookie)

    expect(response.headers.get('location')).toBe(
      `${APP}/login?error=state_mismatch&next=%2Fworkspaces%2Fabc`,
    )
    expect(response.headers.getSetCookie().some((c) => c.startsWith(`${SESSION_COOKIE}=`))).toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects a callback with no flow cookie at all', async () => {
    const fetchMock = stubGithub({ accountId: `gh-nocookie-${RUN}`, email: email('nocookie') })
    const response = await finish('github', { code: 'c', state: 's' })
    expect(response.headers.get('location')).toBe(`${APP}/login?error=state_mismatch`)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects a flow started for one provider arriving at another', async () => {
    const { cookie, state } = await begin('github')
    const response = await finish('google', { code: 'c', state }, cookie)
    expect(response.headers.get('location')).toBe(`${APP}/login?error=state_mismatch`)
  })

  it('reports a cancelled sign-in as cancelled, and any other provider error generically', async () => {
    const { cookie } = await begin('github')
    const cancelled = await finish('github', { error: 'access_denied' }, cookie)
    expect(cancelled.headers.get('location')).toBe(`${APP}/login?error=access_denied`)

    const other = await finish('github', { error: 'temporarily_unavailable' }, cookie)
    expect(other.headers.get('location')).toBe(`${APP}/login?error=provider_error`)
  })

  it("treats GitHub's HTTP-200-with-error token response as a failure", async () => {
    stubGithub({ accountId: `gh-badcode-${RUN}`, email: email('badcode'), token: { error: 'bad_verification_code' } })
    const { cookie, state } = await begin('github')
    const response = await finish('github', { code: 'reused', state }, cookie)
    expect(response.headers.get('location')).toBe(`${APP}/login?error=provider_error`)
  })

  it('refuses an unverified email and creates no user', async () => {
    stubGithub({ accountId: `gh-unverified-${RUN}`, email: email('unverified'), verified: false })
    const { cookie, state } = await begin('github')

    const response = await finish('github', { code: 'c', state }, cookie)

    expect(response.headers.get('location')).toBe(`${APP}/login?error=no_verified_email`)
    expect(await prisma.user.count({ where: { email: email('unverified') } })).toBe(0)
  })

  it('reports a provider that cannot be reached as a generic failure', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new TypeError('fetch failed')
    }))
    const { cookie, state } = await begin('github')
    const response = await finish('github', { code: 'c', state }, cookie)
    expect(response.headers.get('location')).toBe(`${APP}/login?error=provider_error`)
  })

  it('re-validates next itself, even from a validly signed cookie', async () => {
    // Defense in depth: the start route already sanitizes next, but the
    // callback must not trust the cookie's copy blindly.
    stubGithub({ accountId: `gh-next-${RUN}`, email: email('next') })
    const flow = {
      provider: 'github' as const,
      state: 's'.repeat(43),
      verifier: 'v'.repeat(43),
      next: '//evil.example',
      issuedAt: Math.floor(Date.now() / 1000),
    }
    const cookie = flowCookie(flow, SECRET).split(';')[0]

    const response = await finish('github', { code: 'c', state: flow.state }, cookie)

    expect(response.headers.get('location')).toBe(`${APP}/`)
  })
})
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `pnpm test oauth-routes`
Expected: FAIL — cannot resolve the route modules.

- [ ] **Step 3: Implement the start route**

Create `apps/web/src/app/api/auth/oauth/[provider]/route.ts`:

```ts
import { env } from '@/lib/env'
import { safeNext } from '@/lib/safe-next'
import { PROVIDERS, isProviderId, oauthClient } from '@/lib/oauth/providers'
import { flowCookie, newFlow, pkceChallenge } from '@/lib/oauth/flow'
import { callbackUrl, loginErrorUrl, redirectResponse } from '@/lib/oauth/http'

export async function GET(
  request: Request,
  { params }: { params: Promise<{ provider: string }> },
): Promise<Response> {
  const { provider } = await params
  const next = safeNext(new URL(request.url).searchParams.get('next'))
  // From configuration, never from the request's Host header.
  const appUrl = env.appUrl

  if (!isProviderId(provider)) return redirectResponse(loginErrorUrl(appUrl, 'provider_unavailable', next))
  const client = oauthClient(provider)
  if (!client) return redirectResponse(loginErrorUrl(appUrl, 'provider_unavailable', next))

  const flow = newFlow(provider, next)
  const spec = PROVIDERS[provider]
  const authorize = new URL(spec.authorizeUrl)
  authorize.searchParams.set('client_id', client.clientId)
  authorize.searchParams.set('redirect_uri', callbackUrl(appUrl, provider))
  authorize.searchParams.set('response_type', 'code')
  authorize.searchParams.set('scope', spec.scope)
  authorize.searchParams.set('state', flow.state)
  authorize.searchParams.set('code_challenge', pkceChallenge(flow.verifier))
  authorize.searchParams.set('code_challenge_method', 'S256')
  for (const [key, value] of Object.entries(spec.extraAuthorizeParams)) authorize.searchParams.set(key, value)

  return redirectResponse(authorize, [flowCookie(flow, env.sessionSecret)])
}
```

- [ ] **Step 4: Implement the callback route**

Create `apps/web/src/app/api/auth/oauth/[provider]/callback/route.ts`:

```ts
import { env } from '@/lib/env'
import { safeNext } from '@/lib/safe-next'
import { sessionCookie, signSession } from '@/lib/session'
import { OAuthError, type OAuthErrorCode } from '@/lib/oauth/errors'
import { exchangeCode, fetchProfile, isProviderId, oauthClient } from '@/lib/oauth/providers'
import { clearFlowCookie, readFlowCookie, statesMatch } from '@/lib/oauth/flow'
import { callbackUrl, loginErrorUrl, redirectResponse } from '@/lib/oauth/http'
import { resolveOAuthUser } from '@/lib/oauth/resolve-user'

export async function GET(
  request: Request,
  { params }: { params: Promise<{ provider: string }> },
): Promise<Response> {
  const { provider } = await params
  const appUrl = env.appUrl
  const secret = env.sessionSecret
  const url = new URL(request.url)

  const flow = readFlowCookie(request.headers.get('cookie'), secret)
  // Single use: whatever happens below, this flow is spent.
  const spent = clearFlowCookie()
  // Re-validated here even though the start route already did it: the callback
  // does not trust the cookie's copy of next blindly.
  const next = safeNext(flow?.next)
  const fail = (code: OAuthErrorCode) => redirectResponse(loginErrorUrl(appUrl, code, next), [spent])

  if (!isProviderId(provider)) return fail('provider_unavailable')

  const providerError = url.searchParams.get('error')
  if (providerError) return fail(providerError === 'access_denied' ? 'access_denied' : 'provider_error')

  // Checked before any network call, so a forged callback costs us nothing.
  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')
  if (!flow || !code || !state || flow.provider !== provider || !statesMatch(flow.state, state)) {
    return fail('state_mismatch')
  }

  const client = oauthClient(provider)
  if (!client) return fail('provider_unavailable')

  try {
    const accessToken = await exchangeCode(provider, client, code, flow.verifier, callbackUrl(appUrl, provider))
    const profile = await fetchProfile(provider, accessToken)
    const user = await resolveOAuthUser(provider, profile)
    const token = await signSession(user.id, secret)
    return redirectResponse(new URL(next, appUrl), [spent, sessionCookie(token)])
  } catch (error) {
    if (error instanceof OAuthError) return fail(error.code)
    // Logged without the code, token, verifier or any secret.
    console.error(JSON.stringify({ level: 'error', msg: 'oauth callback failed', provider, error: String(error) }))
    return fail('provider_error')
  }
}
```

- [ ] **Step 5: Run the tests**

Run: `pnpm test oauth-routes` — Expected: PASS.
Run: `pnpm test` — Expected: the whole suite green.
Run: `pnpm typecheck` — Expected: clean.

- [ ] **Step 6: Prove the tests discriminate, then restore**

1. In the callback, move the whole state check below `exchangeCode(...)`. Expected: `rejects a mismatched state before making any network call` FAILS on `fetch` having been called.
2. Remove `flow.provider !== provider ||`. Expected: the cross-provider test FAILS.
3. Replace `const next = safeNext(flow?.next)` with `const next = flow?.next ?? '/'`. Expected: `re-validates next itself` FAILS.
4. Remove `spent` from the success redirect's cookie list. Expected: the happy-path test FAILS.

Restore each and confirm green. Report the observed failures.

- [ ] **Step 7: Commit**

```bash
git add "apps/web/src/app/api/auth/oauth" apps/web/test/oauth-routes.integration.test.ts
git commit -m "feat(auth): add GitHub and Google OAuth start and callback routes"
```

---

## Task 6: Replace password sign-in with provider buttons

**Files:**
- Modify: `apps/web/src/app/(auth)/login/page.tsx` (rewrite)
- Modify: `apps/web/src/app/(auth)/signup/page.tsx` (rewrite as a redirect)
- Modify: `apps/web/src/app/(auth)/auth.module.css` (rewrite)
- Modify: `apps/web/src/lib/session.ts` (password hashing removed)
- Modify: `apps/web/test/session.test.ts` (password tests removed)
- Modify: `apps/web/e2e/fixtures.ts` (rewrite)
- Modify: `apps/web/e2e/auth-flow.spec.ts` (rewrite)
- Modify: `apps/web/playwright.config.ts` (test env for OAuth)
- Modify: `scripts/seed-demo.ts` (rewrite)
- Delete: `apps/web/src/app/api/auth/login/route.ts`, `apps/web/src/app/api/auth/signup/route.ts`, `apps/web/src/app/(auth)/login/LoginForm.tsx`, `apps/web/src/app/(auth)/signup/SignupForm.tsx`, `apps/web/test/auth-routes.integration.test.ts`

**Interfaces:**
- Consumes: `availableProviders`, `PROVIDERS` (Task 2); `oauthErrorMessage` (Task 2); the OAuth start route (Task 5).
- Produces: `/login` with `data-testid="signin-github"` / `"signin-google"` links and `data-testid="auth-error"`; `/signup` → redirect; e2e fixture `signIn(page: Page, userId: string): Promise<void>`.

This task removes code, so it has to leave nothing behind that could re-open password sign-in. It ends with a grep that must come back empty.

- [ ] **Step 1: Rewrite the e2e fixtures**

Replace `apps/web/e2e/fixtures.ts` entirely:

```ts
import type { Page } from '@playwright/test'
import { prisma } from '@crdt/db'
import type { Role } from '@crdt/shared/types'
import { signSession } from '../src/lib/session.js'

export async function seedWorkspace(label: string) {
  const owner = await prisma.user.create({
    data: { email: `${label}-owner@e2e.test`, name: 'Owner' },
  })
  const workspace = await prisma.workspace.create({ data: { name: label, ownerId: owner.id } })
  await prisma.workspaceMember.create({
    data: { workspaceId: workspace.id, userId: owner.id, role: 'owner' },
  })
  return { owner, workspace }
}

export async function addMember(workspaceId: string, label: string, role: Role) {
  const user = await prisma.user.create({
    data: {
      email: `${label}-${role}@e2e.test`,
      name: role === 'viewer' ? 'Vera' : 'Eddie',
    },
  })
  await prisma.workspaceMember.create({ data: { workspaceId, userId: user.id, role } })
  return user
}

export async function createDocument(workspaceId: string, type: 'doc' | 'board') {
  return prisma.document.create({ data: { workspaceId, type, title: `e2e ${type}` } })
}

export async function sessionCookieFor(userId: string) {
  return {
    name: 'crdt_session',
    value: await signSession(userId, process.env.SESSION_SECRET!),
    domain: 'localhost',
    path: '/',
  }
}

/**
 * Signs a browser in by setting the session cookie directly. A real GitHub or
 * Google sign-in cannot be scripted, and the OAuth flow itself is covered by
 * oauth-routes.integration.test.ts; this is what every other e2e test uses.
 */
export async function signIn(page: Page, userId: string) {
  await page.context().addCookies([await sessionCookieFor(userId)])
}

export async function cleanup(label: string) {
  await prisma.workspace.deleteMany({ where: { name: label } })
  await prisma.user.deleteMany({ where: { email: { contains: `${label}-` } } })
}
```

- [ ] **Step 2: Rewrite the e2e spec**

Replace `apps/web/e2e/auth-flow.spec.ts` entirely:

```ts
import { test, expect } from '@playwright/test'
import { addMember, cleanup, createDocument, seedWorkspace, signIn } from './fixtures.js'

const LABEL = 'e2e-auth'

test.afterAll(async () => {
  await cleanup(LABEL)
})

test('the login page offers GitHub and Google sign-in, carrying the destination', async ({ page }) => {
  await page.goto('/login?next=/workspaces/abc')
  await expect(page.getByTestId('signin-github')).toHaveAttribute(
    'href',
    '/api/auth/oauth/github?next=%2Fworkspaces%2Fabc',
  )
  await expect(page.getByTestId('signin-google')).toHaveAttribute(
    'href',
    '/api/auth/oauth/google?next=%2Fworkspaces%2Fabc',
  )
})

test('a hostile next param never reaches the sign-in buttons', async ({ page }) => {
  await page.goto('/login?next=//evil.example')
  await expect(page.getByTestId('signin-github')).toHaveAttribute('href', '/api/auth/oauth/github?next=%2F')
})

test('a repeated next param does not crash the login page', async ({ page }) => {
  const response = await page.goto('/login?next=/a&next=/b')
  expect(response?.status()).toBe(200)
  await expect(page.getByTestId('signin-github')).toHaveAttribute('href', '/api/auth/oauth/github?next=%2F')
})

test('continuing with GitHub sends the browser to GitHub with state and PKCE', async ({ page }) => {
  // Never actually load github.com: capture the navigation and abort it.
  await page.route('https://github.com/**', (route) => route.abort())
  await page.goto('/login')

  const [request] = await Promise.all([
    page.waitForRequest((r) => r.url().startsWith('https://github.com/login/oauth/authorize')),
    page.getByTestId('signin-github').click(),
  ])

  const url = new URL(request.url())
  expect(url.searchParams.get('redirect_uri')).toBe('http://localhost:3000/api/auth/oauth/github/callback')
  expect(url.searchParams.get('response_type')).toBe('code')
  expect(url.searchParams.get('code_challenge_method')).toBe('S256')
  expect(url.searchParams.get('state')).toMatch(/^[A-Za-z0-9_-]{43}$/)
  expect(url.searchParams.get('code_challenge')).toMatch(/^[A-Za-z0-9_-]{43}$/)
  expect(url.searchParams.get('client_id')).toBeTruthy()
})

test('a known sign-in error shows its fixed message', async ({ page }) => {
  await page.goto('/login?error=state_mismatch')
  await expect(page.getByTestId('auth-error')).toContainText('expired or was started in another tab')
})

test('an unknown error code shows a generic message, never the raw text', async ({ page }) => {
  await page.goto(`/login?error=${encodeURIComponent('Call 555-0100 to verify your account')}`)
  await expect(page.getByTestId('auth-error')).toHaveText('Sign-in failed. Please try again.')
  await expect(page.getByText('555-0100')).toHaveCount(0)
})

test('/signup forwards to /login and keeps the destination', async ({ page }) => {
  await page.goto('/signup?next=/workspaces/abc')
  await expect(page).toHaveURL('/login?next=%2Fworkspaces%2Fabc')
})

test('the old password endpoints are gone', async ({ request }) => {
  // If either route still existed, anyone could create an account for an email
  // they do not own with a single curl command.
  const login = await request.post('/api/auth/login', {
    data: { email: 'someone@e2e.test', password: 'x'.repeat(12) },
  })
  const signup = await request.post('/api/auth/signup', {
    data: { email: 'someone@e2e.test', password: 'x'.repeat(12), name: 'Someone' },
  })
  expect(login.status()).toBe(404)
  expect(signup.status()).toBe(404)
})

test('a signed-in visitor to /login goes straight to their destination', async ({ page }) => {
  const label = `${LABEL}-already`
  const { owner } = await seedWorkspace(label)
  await signIn(page, owner.id)

  await page.goto('/login?next=/')
  await expect(page).toHaveURL('/')

  await cleanup(label)
})

test('the dashboard lists the workspaces you belong to and can create another', async ({ page }) => {
  const label = `${LABEL}-dash`
  const { owner, workspace } = await seedWorkspace(label)
  await signIn(page, owner.id)

  await page.goto('/')
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

test('an unauthenticated visit to the dashboard sends you to sign-in', async ({ page }) => {
  await page.goto('/')
  await expect(page).toHaveURL(/\/login/)
})

test('a workspace page lists its documents and can create a board', async ({ page }) => {
  const label = `${LABEL}-ws`
  const { owner, workspace } = await seedWorkspace(label)
  const existing = await createDocument(workspace.id, 'doc')
  await signIn(page, owner.id)

  await page.goto('/')
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
  await signIn(page, owner.id)

  // 404, never 403: a 403 would confirm the id exists to somebody with no access.
  const response = await page.goto(`/workspaces/${other.workspace.id}`)
  expect(response?.status()).toBe(404)

  await cleanup(mine)
  await cleanup(theirs)
})

test('a document in a workspace you are not a member of is not found, not forbidden', async ({ page }) => {
  const mine = `${LABEL}-docmine`
  const theirs = `${LABEL}-doctheirs`
  const { owner } = await seedWorkspace(mine)
  const other = await seedWorkspace(theirs)
  const otherDocument = await createDocument(other.workspace.id, 'doc')
  await signIn(page, owner.id)

  const response = await page.goto(`/documents/${otherDocument.id}`)
  expect(response?.status()).toBe(404)

  await cleanup(mine)
  await cleanup(theirs)
})

test('an owner sees the member list and can invite an existing user', async ({ page }) => {
  const label = `${LABEL}-members`
  const { owner, workspace } = await seedWorkspace(label)
  const invitee = await addMember(workspace.id, `${label}-pre`, 'viewer')
  const outsider = await seedWorkspace(`${label}-outsider`)
  await signIn(page, owner.id)

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
  await signIn(page, owner.id)

  await page.goto(`/workspaces/${workspace.id}`)
  await page.getByTestId('member-email').fill('nobody-at-all@e2e.test')
  await page.getByTestId('add-member').click()

  await expect(page.getByTestId('member-error')).toContainText('No account')

  await cleanup(label)
})

test('an unauthenticated visit to a document redirects to sign-in carrying the destination', async ({
  page,
}) => {
  const label = `${LABEL}-doc`
  const { owner, workspace } = await seedWorkspace(label)
  const document = await createDocument(workspace.id, 'board')

  await page.goto(`/documents/${document.id}`)
  await expect(page).toHaveURL(`/login?next=${encodeURIComponent(`/documents/${document.id}`)}`)
  await expect(page.getByTestId('signin-github')).toHaveAttribute(
    'href',
    `/api/auth/oauth/github?next=${encodeURIComponent(`/documents/${document.id}`)}`,
  )

  // The return trip through OAuth is covered by oauth-routes.integration.test.ts;
  // here, confirm the destination itself works once signed in.
  await signIn(page, owner.id)
  await page.goto(`/documents/${document.id}`)
  await expect(page.getByTestId('document-title')).toHaveText('e2e board')
  await expect(page.getByTestId('workspace-link')).toHaveText(label)
  await expect(page.getByTestId('role')).toHaveText('owner')

  await cleanup(label)
})
```

- [ ] **Step 3: Give Playwright's dev server the OAuth settings**

In `apps/web/playwright.config.ts`, leave the `process.loadEnvFile` block and the `import` exactly as they are. Add this helper directly below the import:

```ts
/** process.env without undefined values, as Playwright's webServer.env requires. */
function definedEnv(): Record<string, string> {
  return Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
  )
}
```

and add an `env` key to the existing `webServer` object, after `timeout: 120_000,`:

```ts
    // The login page only renders a button for a provider whose credentials are
    // set, and the OAuth routes build redirect URIs from APP_URL. The e2e suite
    // never completes a real sign-in, so placeholders are enough; a developer's
    // real credentials from .env are used instead when present. APP_URL is forced,
    // because the tests assert redirect URIs against localhost:3000.
    //
    // This only applies when Playwright starts the server. A dev server you
    // started yourself is reused as-is, and then needs these in your .env.
    env: {
      ...definedEnv(),
      APP_URL: 'http://localhost:3000',
      GITHUB_CLIENT_ID: process.env.GITHUB_CLIENT_ID || 'e2e-github-client-id',
      GITHUB_CLIENT_SECRET: process.env.GITHUB_CLIENT_SECRET || 'e2e-github-client-secret',
      GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID || 'e2e-google-client-id',
      GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET || 'e2e-google-client-secret',
    },
```

- [ ] **Step 4: Run the new e2e tests to see them fail**

Make sure nothing is listening on port 3000 first (`lsof -nP -iTCP:3000 -sTCP:LISTEN` should print nothing), so Playwright starts its own server with the env above.

Run: `pnpm --filter @crdt/web exec playwright test auth-flow`
Expected: the eight OAuth-UI tests FAIL (no `signin-github` element; `/signup` still renders a form; the password endpoints still answer). The tests that sign in with `signIn()` should already PASS — they no longer depend on the password form. Report which is which.

- [ ] **Step 5: Rewrite the login page**

Replace `apps/web/src/app/(auth)/login/page.tsx` entirely:

```tsx
import { redirect } from 'next/navigation'
import { getCurrentUser } from '@/lib/current-user'
import { safeNext } from '@/lib/safe-next'
import { oauthErrorMessage } from '@/lib/oauth/errors'
import { PROVIDERS, availableProviders } from '@/lib/oauth/providers'
import styles from '../auth.module.css'

type SearchParams = Promise<Record<string, string | string[] | undefined>>

export default async function LoginPage({ searchParams }: { searchParams: SearchParams }) {
  const { next, error } = await searchParams
  // A repeated ?next= arrives as an array. Narrow it; anything that isn't a
  // single string falls back to the default rather than crashing the page.
  const destination = safeNext(typeof next === 'string' ? next : undefined)

  // redirect() signals by throwing — it is deliberately outside any try/catch.
  if (await getCurrentUser()) redirect(destination)

  const providers = availableProviders()
  // ?error= only selects one of a fixed set of messages; it is never displayed.
  const message = oauthErrorMessage(error)

  return (
    <>
      <p className={styles.lede}>Sign in to your workspaces.</p>
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
              className={styles.provider}
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
}
```

Plain links, not a client component: the browser must navigate to the start route so it can receive the flow cookie and follow the redirect to the provider. No JavaScript is needed to sign in.

- [ ] **Step 6: Turn `/signup` into a redirect**

Replace `apps/web/src/app/(auth)/signup/page.tsx` entirely:

```tsx
import { redirect } from 'next/navigation'
import { safeNext } from '@/lib/safe-next'

type SearchParams = Promise<Record<string, string | string[] | undefined>>

// With provider sign-in, signing up and signing in are the same action: the
// first sign-in creates the account. Kept as a redirect so old links and
// bookmarks to /signup still land somewhere useful.
export default async function SignupPage({ searchParams }: { searchParams: SearchParams }) {
  const { next } = await searchParams
  const destination = safeNext(typeof next === 'string' ? next : undefined)
  redirect(`/login?next=${encodeURIComponent(destination)}`)
}
```

- [ ] **Step 7: Replace the auth stylesheet**

Replace `apps/web/src/app/(auth)/auth.module.css` entirely (the form and hint styles go; provider buttons come in):

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

.error {
  padding: var(--space-2) var(--space-3);
  border: 1px solid var(--danger);
  border-radius: var(--radius-sm);
  color: var(--danger);
  font-size: 13px;
}

.providers {
  display: grid;
  gap: var(--space-2);
}

.provider {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 10px 14px;
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-sm);
  background: var(--surface);
  color: var(--text);
  font-size: 14px;
  font-weight: 500;
}

.provider:hover {
  background: var(--bg);
  text-decoration: none;
}

.alt {
  font-size: 13px;
  color: var(--text-muted);
}
```

- [ ] **Step 8: Delete the password code**

```bash
git rm apps/web/src/app/api/auth/login/route.ts apps/web/src/app/api/auth/signup/route.ts "apps/web/src/app/(auth)/login/LoginForm.tsx" "apps/web/src/app/(auth)/signup/SignupForm.tsx" apps/web/test/auth-routes.integration.test.ts
```

`apps/web/src/app/api/auth/logout/route.ts` stays — sign-out still clears the same session cookie.

- [ ] **Step 9: Remove password hashing from `session.ts`**

Replace `apps/web/src/lib/session.ts` entirely. Everything below the removed hashing code is unchanged:

```ts
import { SignJWT, jwtVerify } from 'jose'

export const SESSION_COOKIE = 'crdt_session'
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7

export class SessionError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'SessionError'
  }
}

const encodeSecret = (secret: string) => new TextEncoder().encode(secret)

export async function signSession(userId: string, secret: string): Promise<string> {
  return new SignJWT({})
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS)
    .sign(encodeSecret(secret))
}

export async function verifySession(token: string, secret: string): Promise<string> {
  try {
    const { payload } = await jwtVerify(token, encodeSecret(secret), { algorithms: ['HS256'] })
    if (typeof payload.sub !== 'string' || payload.sub.length === 0) {
      throw new SessionError('missing subject')
    }
    return payload.sub
  } catch (cause) {
    if (cause instanceof SessionError) throw cause
    throw new SessionError('session verification failed', { cause })
  }
}

/**
 * Ruling R4: this helper lives beside SESSION_COOKIE and SESSION_TTL_SECONDS rather
 * than inside a route module. Route modules importing helpers from sibling route
 * modules breaks the moment either gains module-level side effects.
 */
export function sessionCookie(token: string): string {
  const parts = [
    `${SESSION_COOKIE}=${token}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${SESSION_TTL_SECONDS}`,
  ]
  if (process.env.NODE_ENV === 'production') parts.push('Secure')
  return parts.join('; ')
}
```

- [ ] **Step 10: Remove the password tests from `session.test.ts`**

Replace `apps/web/test/session.test.ts` entirely:

```ts
import { describe, it, expect } from 'vitest'
import {
  signSession, verifySession, SessionError,
  SESSION_COOKIE, SESSION_TTL_SECONDS, sessionCookie,
} from '../src/lib/session.js'

const SECRET = 'session-secret-long-enough-here!'

describe('session token', () => {
  it('round-trips a user id', async () => {
    const token = await signSession('usr_1', SECRET)
    await expect(verifySession(token, SECRET)).resolves.toBe('usr_1')
  })

  it('rejects a token signed with another secret', async () => {
    const token = await signSession('usr_1', SECRET)
    await expect(verifySession(token, 'a'.repeat(32))).rejects.toBeInstanceOf(SessionError)
  })

  it('rejects garbage', async () => {
    await expect(verifySession('nope', SECRET)).rejects.toBeInstanceOf(SessionError)
  })
})

describe('sessionCookie', () => {
  it('sets the security-relevant flags and max-age', () => {
    const cookie = sessionCookie('some-token-value')
    expect(cookie).toContain(`${SESSION_COOKIE}=some-token-value`)
    expect(cookie).toContain('HttpOnly')
    expect(cookie).toContain('SameSite=Lax')
    expect(cookie).toContain('Path=/')
    expect(cookie).toContain(`Max-Age=${SESSION_TTL_SECONDS}`)
  })
})
```

- [ ] **Step 11: Make the demo seed owner-by-email**

Replace `scripts/seed-demo.ts` entirely:

```ts
import { prisma } from '@crdt/db'
import { addCard, addColumn } from '@crdt/shared/board'
import * as Y from 'yjs'

const doc = new Y.Doc()
addColumn(doc, { id: 'todo', title: 'To do' })
addColumn(doc, { id: 'doing', title: 'In progress' })
addColumn(doc, { id: 'done', title: 'Done' })
addCard(doc, { id: 'c1', title: 'Open this board in two windows', columnId: 'todo' })
addCard(doc, { id: 'c2', title: 'Drag a card and watch the other window', columnId: 'todo' })
addCard(doc, { id: 'c3', title: 'Go offline, keep editing, come back', columnId: 'doing' })

// The demo workspace is owned by whoever signs in with this address. Normalized
// exactly as sign-in normalizes provider emails, so the first GitHub or Google
// sign-in with it links to this user rather than creating a second one.
const ownerEmail = process.env.DEMO_OWNER_EMAIL?.trim().toLowerCase()
if (!ownerEmail || !ownerEmail.includes('@')) {
  throw new Error('DEMO_OWNER_EMAIL must be set to the email you will sign in with (GitHub or Google)')
}

const user = await prisma.user.upsert({
  where: { email: ownerEmail },
  update: {},
  create: { email: ownerEmail, name: 'Demo' },
})

const workspace = await prisma.workspace.create({ data: { name: 'Demo', ownerId: user.id } })
await prisma.workspaceMember.create({
  data: { workspaceId: workspace.id, userId: user.id, role: 'owner' },
})

const document = await prisma.document.create({
  data: { workspaceId: workspace.id, type: 'board', title: 'Demo board' },
})

// Seed through the update log, exactly as the sync server would, so the demo board
// loads by the same code path as every other document.
await prisma.documentUpdate.create({
  data: {
    documentId: document.id,
    update: Buffer.from(Y.encodeStateAsUpdate(doc)),
    clientId: 'seed',
  },
})

console.log(`seeded board: /documents/${document.id} (owner: ${ownerEmail})`)
await prisma.$disconnect()
```

- [ ] **Step 12: Confirm nothing that could re-open password sign-in survives**

```bash
git grep -n -E "hashPassword|verifyPassword|E2E_PASSWORD|DEMO_PASSWORD|cleanupUser|LoginForm|SignupForm|api/auth/(login|signup)" -- . ':!docs' ':!*.md'
```

Expected: **no output at all.** (The e2e test `the old password endpoints are gone` contains the strings `/api/auth/login` and `/api/auth/signup` inside `request.post(...)` calls; if the pattern matches them, confirm those are the only hits and say so.)

- [ ] **Step 13: Run everything**

Run: `pnpm test` — Expected: green. The count drops by the removed password and auth-route tests and rises by Tasks 1–5's additions; report the actual numbers.
Run: `pnpm typecheck` — Expected: clean.
Run: `pnpm --filter @crdt/web exec playwright test auth-flow` (nothing on port 3000 beforehand) — Expected: all PASS.

- [ ] **Step 14: Prove the key tests discriminate, then restore**

1. Restore the signup route with `git show HEAD:apps/web/src/app/api/auth/signup/route.ts > apps/web/src/app/api/auth/signup/route.ts` — it will not typecheck without `hashPassword`, so run only the e2e test `the old password endpoints are gone` against the dev server. Expected: it FAILS (the route answers with something other than 404). Delete the file again.
2. In the login page, render `{typeof error === 'string' ? error : null}` instead of `{message}`. Expected: `an unknown error code shows a generic message` FAILS. Restore.
3. In the login page, replace `typeof next === 'string' ? next : undefined` with `next as string`. Expected: `a repeated next param does not crash the login page` FAILS. Restore.

Confirm green again. Report the observed failures.

- [ ] **Step 15: Commit**

```bash
git add -A "apps/web/src/app/(auth)" apps/web/src/app/api/auth apps/web/src/lib/session.ts apps/web/test/session.test.ts apps/web/test/auth-routes.integration.test.ts apps/web/e2e/fixtures.ts apps/web/e2e/auth-flow.spec.ts apps/web/playwright.config.ts scripts/seed-demo.ts
git commit -m "feat(auth): replace email/password sign-in with GitHub and Google"
```

---

## Task 7: Invites match emails case-insensitively

**Files:**
- Modify: `apps/web/src/app/api/workspaces/[id]/members/route.ts` (one line)
- Modify: `apps/web/src/app/workspaces/[id]/MembersPanel.tsx` (copy)
- Test: `apps/web/test/workspace-routes.integration.test.ts` (append one test)

**Interfaces:**
- Consumes: the existing members route and its test helper `postAs`.
- Produces: no new interfaces.

Sign-in stores emails lowercased (Task 2). An owner who types `Ada@Example.com` into the invite box must still find `ada@example.com`.

- [ ] **Step 1: Write the failing test**

In `apps/web/test/workspace-routes.integration.test.ts`, inside the existing `describe('members route: last-owner guard', ...)` block, after the test `'allows demoting an owner when another owner remains'`, add:

```ts
  it('finds the invitee regardless of the case or whitespace the inviter typed', async () => {
    const response = await postAs(soleOwner.id, soleOwnerWorkspaceId, {
      email: `  ${coOwnerB.email.toUpperCase()}  `,
      role: 'viewer',
    })
    expect(response.status).toBe(201)

    const member = await prisma.workspaceMember.findUnique({
      where: { workspaceId_userId: { workspaceId: soleOwnerWorkspaceId, userId: coOwnerB.id } },
    })
    expect(member?.role).toBe('viewer')
  })
```

(This adds `coOwnerB` to the sole-owner workspace as a **viewer**, so the neighbouring "only owner" test is unaffected — that workspace still has exactly one owner.)

- [ ] **Step 2: Run it to make sure it fails**

Run: `pnpm test workspace-routes`
Expected: FAIL — `400` instead of `201` (the padded, uppercased value fails `.email()` and would not match the stored lowercase address anyway).

- [ ] **Step 3: Normalize the email in the route**

In `apps/web/src/app/api/workspaces/[id]/members/route.ts`, replace the line

```ts
  email: z.string().email(),
```

with

```ts
  // Sign-in stores emails trimmed and lowercased, so the lookup must match that,
  // or inviting "Ada@Example.com" would never find ada@example.com.
  email: z.string().trim().toLowerCase().email(),
```

This is the only change to this file.

- [ ] **Step 4: Update the panel's copy**

In `apps/web/src/app/workspaces/[id]/MembersPanel.tsx`, replace

```ts
          ? `No account is registered to ${email}. They need to sign up first.`
```

with

```ts
          ? `No account is registered to ${email}. They need to sign in once with GitHub or Google first.`
```

- [ ] **Step 5: Run the tests**

Run: `pnpm test workspace-routes` — Expected: PASS.
Run: `pnpm typecheck` — Expected: clean.

- [ ] **Step 6: Prove the test discriminates, then restore**

Revert the route line to `z.string().email()`, run `pnpm test workspace-routes`, confirm the new test FAILS, restore, confirm green. Report the failure.

- [ ] **Step 7: Commit**

```bash
git add "apps/web/src/app/api/workspaces/[id]/members/route.ts" "apps/web/src/app/workspaces/[id]/MembersPanel.tsx" apps/web/test/workspace-routes.integration.test.ts
git commit -m "fix(members): match invite emails case-insensitively"
```

---

## Task 8: Wake the sync server early

**Files:**
- Create: `apps/web/src/lib/sync-url.ts`
- Create: `apps/web/src/components/WarmSync.tsx`
- Modify: `apps/web/src/app/layout.tsx`
- Modify: `apps/web/src/hooks/use-doc.ts` (import the constant)
- Test: `apps/web/test/sync-url.test.ts`
- Test: `apps/web/e2e/warm-sync.spec.ts`

**Interfaces:**
- Consumes: the sync server's existing `GET /healthz` (unchanged).
- Produces: `SYNC_URL: string`, `syncHealthUrl(syncUrl: string): string | null`, `<WarmSync />`.

On Render's free tier the sync server sleeps after 15 idle minutes and takes about a minute to wake. Today it only starts waking when someone opens a document. This starts it as soon as any page loads.

- [ ] **Step 1: Write the failing unit test**

Create `apps/web/test/sync-url.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { syncHealthUrl } from '../src/lib/sync-url.js'

describe('syncHealthUrl', () => {
  it('maps wss to https', () => {
    expect(syncHealthUrl('wss://crdt-sync.onrender.com')).toBe('https://crdt-sync.onrender.com/healthz')
  })

  it('maps ws to http, keeping the port', () => {
    expect(syncHealthUrl('ws://localhost:1234')).toBe('http://localhost:1234/healthz')
  })

  it('replaces any path, query or fragment', () => {
    expect(syncHealthUrl('wss://sync.example.com/some/room?token=abc#x')).toBe(
      'https://sync.example.com/healthz',
    )
  })

  it('returns null for anything that is not a WebSocket URL', () => {
    expect(syncHealthUrl('')).toBeNull()
    expect(syncHealthUrl('not a url')).toBeNull()
    expect(syncHealthUrl('https://sync.example.com')).toBeNull()
  })
})
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `pnpm test sync-url`
Expected: FAIL — cannot resolve `../src/lib/sync-url.js`.

- [ ] **Step 3: Implement `sync-url.ts`**

Create `apps/web/src/lib/sync-url.ts`:

```ts
/** Where the browser opens its WebSocket. Next inlines NEXT_PUBLIC_ values at build time. */
export const SYNC_URL = process.env.NEXT_PUBLIC_SYNC_URL ?? 'ws://localhost:1234'

/** The sync server's health endpoint over plain HTTP(S), or null if the URL isn't ws/wss. */
export function syncHealthUrl(syncUrl: string): string | null {
  let url: URL
  try {
    url = new URL(syncUrl)
  } catch {
    return null
  }
  if (url.protocol === 'wss:') url.protocol = 'https:'
  else if (url.protocol === 'ws:') url.protocol = 'http:'
  else return null
  url.pathname = '/healthz'
  url.search = ''
  url.hash = ''
  return url.toString()
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm test sync-url` — Expected: PASS.

- [ ] **Step 5: Point `use-doc.ts` at the shared constant**

In `apps/web/src/hooks/use-doc.ts`, replace

```ts
const SYNC_URL = process.env.NEXT_PUBLIC_SYNC_URL ?? 'ws://localhost:1234'
```

with

```ts
import { SYNC_URL } from '@/lib/sync-url'
```

moving it up to sit with the other imports. Nothing else in the file changes.

- [ ] **Step 6: Write the failing e2e test**

Create `apps/web/e2e/warm-sync.spec.ts`:

```ts
import { test } from '@playwright/test'

test('loading a page pings the sync server so it starts waking up', async ({ page }) => {
  const ping = page.waitForRequest((request) => request.url() === 'http://localhost:1234/healthz')
  await page.goto('/login')
  await ping
})
```

Run: `pnpm --filter @crdt/web exec playwright test warm-sync`
Expected: FAIL — timeout waiting for the request.

- [ ] **Step 7: Implement `WarmSync` and render it**

Create `apps/web/src/components/WarmSync.tsx`:

```tsx
'use client'

import { useEffect } from 'react'
import { SYNC_URL, syncHealthUrl } from '@/lib/sync-url'

/**
 * On a free hosting tier the sync server sleeps after 15 idle minutes and takes
 * about a minute to wake. Pinging it as soon as any page loads starts that
 * wake-up while the person is still on the login page or dashboard, instead of
 * only once they open a document.
 *
 * mode 'no-cors': the response is opaque and deliberately ignored; the request
 * reaching the server is the whole point. A failure is expected (it may be
 * asleep) and harmless.
 */
export function WarmSync() {
  useEffect(() => {
    const url = syncHealthUrl(SYNC_URL)
    if (url) void fetch(url, { mode: 'no-cors', cache: 'no-store' }).catch(() => {})
  }, [])
  return null
}
```

Replace `apps/web/src/app/layout.tsx` entirely:

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

- [ ] **Step 8: Run the tests**

Run: `pnpm --filter @crdt/web exec playwright test warm-sync auth-flow` — Expected: PASS.
Run: `pnpm test` and `pnpm typecheck` — Expected: green and clean.

- [ ] **Step 9: Prove the e2e test discriminates, then restore**

Remove `<WarmSync />` from the layout, confirm `warm-sync` FAILS, restore, confirm it passes. Report.

- [ ] **Step 10: Commit**

```bash
git add apps/web/src/lib/sync-url.ts apps/web/src/components/WarmSync.tsx apps/web/src/app/layout.tsx apps/web/src/hooks/use-doc.ts apps/web/test/sync-url.test.ts apps/web/e2e/warm-sync.spec.ts
git commit -m "feat(web): ping the sync server on page load so free-tier cold starts overlap"
```

---

## Task 9: Deployment configuration

**Files:**
- Modify: `apps/web/Dockerfile`
- Create: `render.yaml`
- Modify: `.env.example`

**Interfaces:**
- Consumes: env var names from Tasks 2 and 5 (`APP_URL`, `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`); the sync server's `/healthz`.
- Produces: a buildable production image; a Render Blueprint.

**The bug this fixes.** `NEXT_PUBLIC_SYNC_URL` is read in client code, and Next inlines `NEXT_PUBLIC_*` values into the browser bundle **at build time**. The web Dockerfile never passes it to the build, so the production bundle falls back to `ws://localhost:1234` — every visitor's browser would try to reach a sync server on their own machine. (The old Fly runbook set it as a runtime secret, which never reaches the bundle.) Render passes each env var to a Docker build as a build arg, **but only if the Dockerfile declares an `ARG` for it.**

- [ ] **Step 1: Confirm the bug before fixing it**

```bash
docker build -f apps/web/Dockerfile -t crdt-web:before .
docker run --rm crdt-web:before sh -c "grep -rl 'ws://localhost:1234' apps/web/.next/static | head -1"
docker rmi crdt-web:before
```

Expected: the `grep` prints a file path, and no real sync URL is present anywhere — the localhost fallback is the only thing the bundle knows. Report it. (This build takes several minutes.)

- [ ] **Step 2: Fix the Dockerfile**

In `apps/web/Dockerfile`, insert this block immediately **above** the existing comment that begins `# next.config.ts loads the repo-root .env directly`:

```dockerfile
# NEXT_PUBLIC_* values are compiled into the browser bundle when `next build`
# runs, not read at runtime — so the sync server's public URL must be known
# here. Render passes each service env var as a build arg, but only if this
# ARG is declared. Fail the build rather than silently shipping a bundle that
# points every visitor at ws://localhost:1234.
#
# Only this value is declared. Never add an ARG for a secret: a declared build
# arg can end up in the image.
ARG NEXT_PUBLIC_SYNC_URL
RUN case "$NEXT_PUBLIC_SYNC_URL" in \
      ws://*|wss://*) ;; \
      *) echo "NEXT_PUBLIC_SYNC_URL build arg must be the sync server's ws:// or wss:// URL" >&2; exit 1 ;; \
    esac
ENV NEXT_PUBLIC_SYNC_URL=$NEXT_PUBLIC_SYNC_URL

```

- [ ] **Step 3: Verify the fix both ways**

Without the arg, the build must fail loudly:

```bash
docker build -f apps/web/Dockerfile -t crdt-web:noarg . ; echo "exit=$?"
```

Expected: the build stops at the guard with the error message above and a non-zero exit.

With the arg, the value must be inlined and the fallback gone:

```bash
docker build -f apps/web/Dockerfile --build-arg NEXT_PUBLIC_SYNC_URL=wss://sync-probe.example.com -t crdt-web:after .
docker run --rm crdt-web:after sh -c "grep -rl 'wss://sync-probe.example.com' apps/web/.next/static | head -1"
docker run --rm crdt-web:after sh -c "grep -rl 'ws://localhost:1234' apps/web/.next/static | head -1 || true"
docker rmi crdt-web:after
```

Expected: the first `grep` prints a path — that is the proof the real URL was compiled in. The second is informational only: it may still print a path, because the minifier can keep the now-dead `?? 'ws://localhost:1234'` branch even though its left side is a non-null literal. That is harmless and is **not** a failure. Report all three results.

- [ ] **Step 4: Write the Render Blueprint**

Create `render.yaml` at the repo root:

```yaml
# Render Blueprint: two free web services built from this repo's Dockerfiles.
# The database is Neon, not Render Postgres — Render's free Postgres is deleted
# 30 days after creation. See README → Deployment for the full, ordered runbook.
#
# `sync: false` values are secrets or URLs that only exist after creation; Render
# prompts for them when the Blueprint is first applied. SYNC_JWT_SECRET must be
# the SAME value on both services — it is the contract between them — which is
# why it is entered by hand rather than generated per service.
services:
  - type: web
    name: crdt-sync
    runtime: docker
    plan: free
    region: oregon
    dockerfilePath: ./apps/sync/Dockerfile
    dockerContext: .
    healthCheckPath: /healthz
    autoDeployTrigger: commit
    envVars:
      # Render routes traffic to PORT; the sync server listens on SYNC_PORT,
      # which defaults to 1234. Pointing PORT at it needs no code change.
      - key: PORT
        value: "1234"
      - key: DATABASE_URL
        sync: false
      - key: SYNC_JWT_SECRET
        sync: false

  - type: web
    name: crdt-web
    runtime: docker
    plan: free
    region: oregon
    dockerfilePath: ./apps/web/Dockerfile
    dockerContext: .
    # /login renders without touching the database when no one is signed in.
    healthCheckPath: /login
    autoDeployTrigger: commit
    envVars:
      # `next start -p 3000` is fixed in package.json; point Render at it.
      - key: PORT
        value: "3000"
      - key: DATABASE_URL
        sync: false
      - key: SESSION_SECRET
        generateValue: true
      - key: SYNC_JWT_SECRET
        sync: false
      - key: APP_URL
        sync: false
      # Build-time: changing it requires a rebuild, not a restart.
      - key: NEXT_PUBLIC_SYNC_URL
        sync: false
      - key: GITHUB_CLIENT_ID
        sync: false
      - key: GITHUB_CLIENT_SECRET
        sync: false
      - key: GOOGLE_CLIENT_ID
        sync: false
      - key: GOOGLE_CLIENT_SECRET
        sync: false
```

- [ ] **Step 5: Check the YAML parses**

```bash
python3 -c "import yaml; d = yaml.safe_load(open('render.yaml')); print([s['name'] for s in d['services']])"
```

Expected: `['crdt-sync', 'crdt-web']`. If PyYAML is not installed, say so and skip — do not install anything; the reviewer will read the file.

- [ ] **Step 6: Document the new variables**

Replace `.env.example` entirely. Placeholders only — never real values:

```
DATABASE_URL=postgresql://crdt:crdt@localhost:5432/crdt
SESSION_SECRET=replace-me-with-32-bytes-of-random
SYNC_JWT_SECRET=replace-me-with-a-different-32-bytes
SYNC_PORT=1234
NEXT_PUBLIC_SYNC_URL=ws://localhost:1234

# The public origin of the web app, with no trailing slash. OAuth redirect URIs
# are built from it, and must match what is registered with each provider.
APP_URL=http://localhost:3000

# OAuth apps (see README -> Development). Leave a pair blank to hide that
# provider's button; one configured provider is enough to sign in.
GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
```

- [ ] **Step 7: Commit**

```bash
git add apps/web/Dockerfile render.yaml .env.example
git commit -m "fix(deploy): inline NEXT_PUBLIC_SYNC_URL at build time; add Render Blueprint"
```

---

## Task 10: Self-starting test servers, README, and full verification

**Files:**
- Modify: `apps/web/playwright.config.ts` (`webServer` becomes an array)
- Modify: `README.md`

**Interfaces:**
- Consumes: everything above.
- Produces: nothing importable.

### Part A — Playwright starts the sync server too

Earlier, `collaboration.spec.ts` failed all four tests with `expected "connected", received "connecting"` because the sync server wasn't running. Playwright starts the web app itself but not the sync server.

- [ ] **Step 1: See it fail**

Confirm nothing is listening on 1234 (`lsof -nP -iTCP:1234 -sTCP:LISTEN` prints nothing), then run:

`pnpm --filter @crdt/web exec playwright test collaboration`

Expected: 4 FAIL with status stuck on `connecting`. Report it.

- [ ] **Step 2: Convert `webServer` to an array**

In `apps/web/playwright.config.ts`, change `webServer: { ... }` into `webServer: [ { ...the existing web entry, unchanged... }, <sync entry> ]`, where the sync entry is:

```ts
    {
      // collaboration.spec.ts needs a live relay. `start`, not `dev`: no file
      // watcher in a test run. Reused if you already have one running.
      command: 'pnpm --filter @crdt/sync run start',
      url: 'http://localhost:1234/healthz',
      reuseExistingServer: true,
      timeout: 60_000,
    },
```

Update the comment above `webServer` that says the sync server "is unchanged from before and still started by hand" — it is now started automatically.

- [ ] **Step 3: See it pass**

With nothing on 1234 or 3000: `pnpm --filter @crdt/web exec playwright test`
Expected: every spec passes — `auth-flow`, `warm-sync`, and all 4 `collaboration` tests. Afterwards confirm nothing is left listening on 1234 or 3000. Report the counts and the port check.

### Part B — README

- [ ] **Step 4: Update "Using the app"**

In `README.md`, under `### Using the app`, replace step 3 with:

```markdown
3. Choose **Continue with GitHub** or **Continue with Google**. Your first
   sign-in creates your account and a workspace of your own.
```

and step 5 with:

```markdown
5. To collaborate, invite a teammate by email from the workspace's **Members**
   panel. They must have signed in once first — invitations go to the email
   address of an existing account, and there is no invitation email.
```

- [ ] **Step 5: Add a local sign-in subsection to "Development"**

In `README.md`, directly after the first code block of `## Development` (the one containing `pnpm install`) and its following paragraph about `postinstall`, insert:

```markdown
### Signing in locally

Sign-in is GitHub or Google only, so local development needs its own OAuth app.
A GitHub OAuth app allows exactly one callback URL, so create a development app
separate from the production one:

- **GitHub** → Settings → Developer settings → OAuth Apps → New OAuth App.
  Homepage URL `http://localhost:3000`; Authorization callback URL
  `http://localhost:3000/api/auth/oauth/github/callback`. Generate a client secret.
- **Google** (optional) → an OAuth client of type *Web application* with the
  authorized redirect URI `http://localhost:3000/api/auth/oauth/google/callback`.
  One Google client can list both the local and the production redirect URIs.

Then add to your `.env`:

    APP_URL=http://localhost:3000
    GITHUB_CLIENT_ID=<from GitHub>
    GITHUB_CLIENT_SECRET=<from GitHub>

A provider with a blank ID or secret simply doesn't get a button, so GitHub
alone is enough.

`pnpm --filter @crdt/web exec playwright test` starts the web app and the sync
server itself when they aren't already running, with placeholder provider
credentials — the tests never complete a real sign-in. If you already have your
own `pnpm dev` running, Playwright reuses it, and then it needs `APP_URL` and at
least placeholder credentials for both providers in `.env`.
```

- [ ] **Step 6: Update "Seeding a demo workspace"**

Replace the section's body (everything between `## Seeding a demo workspace` and `## Deployment`) with:

```markdown
`scripts/seed-demo.ts` creates a demo workspace and a board with three cards
that walk through the demo above ("open this in two windows", "drag a card",
"go offline"). It writes the board through the same `DocumentUpdate` log the
sync server itself writes through, so the seeded board loads by the exact same
code path as any real document.

The workspace is owned by the email address you pass. Sign in with GitHub or
Google using that address and the demo workspace is yours:

```bash
DEMO_OWNER_EMAIL='you@example.com' pnpm exec tsx scripts/seed-demo.ts
```

It prints the seeded document's URL path on success.
```

- [ ] **Step 7: Replace "Deployment"**

Replace everything from `## Deployment` up to (not including) `## Local Docker verification` with:

````markdown
## Deployment

The public deployment runs on free tiers: two **Render** web services built from
this repo's Dockerfiles (`crdt-web` and `crdt-sync`, declared in `render.yaml`),
and a **Neon** Postgres database. Render's own free Postgres isn't used — it is
deleted 30 days after creation (plus a 14-day grace period), with no backups.
Neon's free plan doesn't expire.

**What free costs you.** Each Render service sleeps after 15 minutes without
traffic and takes about a minute to wake, and the two wake separately. Every page
pings the sync server as it loads, so they wake in parallel rather than one after
the other. Render allows 750 free instance-hours a month across a workspace, and
a browser tab left open on a document keeps the sync server awake around the
clock. Neon's free plan holds 0.5 GB, and `DocumentUpdate` rows are never pruned
(see [What I deliberately did not build](#what-i-deliberately-did-not-build)).

Nothing is lost when a service sleeps: the sync server only sleeps after 15
minutes with no WebSocket traffic, long after its 500 ms write queue flushed.

Do these steps in order — several values only exist once an earlier step has
created them.

### 1. Database (Neon)

1. Create a project at neon.com in **AWS US West (Oregon)**, next to Render's
   `oregon` region.
2. From the project's **Connect** dialog, copy two connection strings: the
   **pooled** one (its host contains `-pooler`) and the **direct** one (pooling
   switched off).
3. Apply the migrations from your machine with the **direct** string. Check the
   target first: `migrate status` prints the host it is about to use, and it must
   be your Neon host, not `localhost`.

   ```bash
   DATABASE_URL='<direct connection string>' pnpm --filter @crdt/db exec prisma migrate status
   DATABASE_URL='<direct connection string>' pnpm --filter @crdt/db exec prisma migrate deploy
   ```

   A variable set on the command line takes precedence over your local `.env`,
   so this cannot touch your local database.

### 2. Services (Render)

1. Generate the shared sync secret and keep it for the next step:
   `openssl rand -hex 32`.
2. In Render choose **New → Blueprint** and connect this GitHub repository.
   Render reads `render.yaml` and asks for each value marked `sync: false`:

   | Variable | Service | Value |
   |---|---|---|
   | `DATABASE_URL` | both | the **pooled** Neon string |
   | `SYNC_JWT_SECRET` | both | the value from step 1 — **identical** on both |
   | `APP_URL` | crdt-web | `https://placeholder.invalid` for now |
   | `NEXT_PUBLIC_SYNC_URL` | crdt-web | `wss://placeholder.invalid` for now |
   | `GITHUB_…`, `GOOGLE_…` | crdt-web | blank, or a placeholder if Render insists |

   `SESSION_SECRET` is generated by Render.
3. Once both services are live, note their URLs — for example
   `https://crdt-web-xxxx.onrender.com` and `https://crdt-sync-xxxx.onrender.com`.
   Open `https://<sync URL>/healthz`; it should answer `ok`.
4. On **crdt-web → Environment**, set `APP_URL` to the web URL (no trailing slash)
   and `NEXT_PUBLIC_SYNC_URL` to the sync URL with `wss://` in place of `https://`.

### 3. Sign-in providers

- **GitHub** → Settings → Developer settings → OAuth Apps → New OAuth App.
  Homepage URL: your `APP_URL`. Authorization callback URL:
  `<APP_URL>/api/auth/oauth/github/callback`. Generate a client secret.
- **Google** → console.cloud.google.com, create a project, then configure the
  OAuth consent screen (in the current console: *Google Auth Platform*): set the
  app name and support email, choose audience **External**, and **publish** the
  app — while it is in *Testing*, only listed test users can sign in. The scopes
  used (`openid`, `email`, `profile`) are non-sensitive, so publishing doesn't
  require Google's verification review. Then create an OAuth client of type
  *Web application* with the authorized redirect URI
  `<APP_URL>/api/auth/oauth/google/callback`. Console labels change over time;
  the settings that matter are the audience, the publishing status, and the
  exact redirect URI.

Set `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `GOOGLE_CLIENT_ID` and
`GOOGLE_CLIENT_SECRET` on **crdt-web**.

### 4. Rebuild the web service

`NEXT_PUBLIC_SYNC_URL` is compiled into the browser bundle, so changing it needs
a rebuild, not a restart: **crdt-web → Manual Deploy → Clear build cache &
deploy.** The build fails on purpose if the value isn't a `ws://` or `wss://` URL.

### 5. Check it

- `<APP_URL>/login` shows both buttons.
- Sign in with GitHub: you land on a dashboard with *"<your name>'s workspace"*.
- Sign out, then sign in with Google using the same email: you land in the same
  workspace, because the two identities are linked by their verified email.
- Open a board in two browsers — one normal, one incognito signed in as a second
  account you invited from **Members** — and watch edits appear in both. DevTools
  → Network → WS should show a connection to `wss://<sync URL>`.
- If sign-in comes back with *"expired or was started in another tab"* every
  time, `APP_URL` doesn't exactly match the address in your browser's address bar.

### Seeding the public demo (optional)

```bash
DATABASE_URL='<direct connection string>' DEMO_OWNER_EMAIL='you@example.com' pnpm exec tsx scripts/seed-demo.ts
```

### Fly.io

`apps/*/fly.toml` remain from an earlier deployment design and have never been
deployed. If you use them, `NEXT_PUBLIC_SYNC_URL` must be passed at build time
(`fly deploy ... --build-arg NEXT_PUBLIC_SYNC_URL=wss://...`); setting it as a Fly
secret does not reach the browser bundle.
````

- [ ] **Step 8: Fix the local Docker verification command**

In `## Local Docker verification`, change

```bash
docker build -f apps/web/Dockerfile -t crdt-web:verify .
```

to

```bash
docker build -f apps/web/Dockerfile --build-arg NEXT_PUBLIC_SYNC_URL=ws://localhost:1234 -t crdt-web:verify .
```

(Without the build arg the web image now refuses to build, on purpose.)

- [ ] **Step 9: Record the removal in "What I deliberately did not build"**

Add this bullet to the list under `## What I deliberately did not build`:

```markdown
- **Email/password sign-in.** Sign-in is GitHub or Google only. An earlier version
  had a password form, but a password account's email is never verified, and
  invitations go by email address — so on the public internet anyone could
  register a colleague's address first and receive the invitations meant for
  them. Provider sign-in delivers already-verified emails, which removes that
  whole class of problem instead of patching around it. The hardened password
  code (scrypt, constant-time comparison, and a dummy hash that equalizes login
  timing) is in the git history.
```

- [ ] **Step 10: Check nothing stale remains**

```bash
grep -n -i -E "create one|passwords? must|DEMO_PASSWORD|fly secrets set NEXT_PUBLIC" README.md
```

Expected: no output. Anything found is a stale reference; fix it to match the steps above.

### Part C — Full verification

- [ ] **Step 11: Run everything**

- `pnpm test` — all green. Report the counts.
- `pnpm typecheck` — clean.
- `pnpm --filter @crdt/web build` — completes, and the route list includes `/login`, `/signup`, `/api/auth/oauth/[provider]`, `/api/auth/oauth/[provider]/callback`, and **not** `/api/auth/login` or `/api/auth/signup`.
- `pnpm --filter @crdt/web exec playwright test` with nothing running on 1234 or 3000 — all green, then confirm both ports are free again.

Do not commit `apps/web/next-env.d.ts` if the build rewrote it (`git checkout -- apps/web/next-env.d.ts`).

- [ ] **Step 12: Commit**

```bash
git add apps/web/playwright.config.ts README.md
git commit -m "docs: document OAuth setup and the Render + Neon deployment; start the sync server in e2e"
```

---

## Going live (you, not an agent)

Agents cannot create accounts, enter credentials, or create billed cloud resources, and should not. Once the branch is reviewed, merged and pushed to `github.com/dhanush1-2/CRD-Workspace` (Render reads `render.yaml` from the repository), follow **README → Deployment**, steps 1–5, in order. It takes roughly 30–45 minutes, most of it in the Neon, Render, GitHub and Google consoles.

Things only you can do, and why they are ordered as they are:

1. **Neon first.** The web service's Prisma client is constructed at startup and needs a real `DATABASE_URL`, so the database has to exist before Render builds anything.
2. **Render second, with placeholders.** The public URLs don't exist until the services do, and `APP_URL` and the OAuth callback URLs depend on them.
3. **OAuth apps third.** Their callback URLs need the real `APP_URL`.
4. **Rebuild last.** `NEXT_PUBLIC_SYNC_URL` only takes effect in a fresh build.

---

## Self-Review

**Spec coverage.** Every decision has a task: OAuth only (6), hand-rolled flow issuing the existing session (3, 5), verified emails only (2), the three linking rules (4), Render + Neon (9, 10), minimal backend change (footprint table; the constraints forbid the rest), nullable not dropped (1). Each of the 32 edge cases in the table points at the task and test that covers it; #30 (sleep with unflushed writes) is documented rather than coded because it cannot happen.

**Placeholder scan.** Every code step has the code. The two places that describe an edit instead of quoting a whole file — the `webServer` array in Task 10 and the Dockerfile insertion in Task 9 — name the exact anchor and give the exact inserted text. Test counts are deliberately not predicted as totals, because earlier fix rounds made predicted totals wrong; each task reports actual numbers.

**Type consistency.**
- `ProviderId` (`'github' | 'google'`) is defined once in `providers.ts` and matches the Prisma `AuthProvider` enum from Task 1 value for value, so it is assignable to the `provider` column.
- `OAuthProfile`, `OAuthClient`, and `OAuthErrorCode` are defined in Task 2 and consumed unchanged by Tasks 3, 4, 5 and 6.
- `flowCookie(flow, secret)` and `readFlowCookie(header, secret, now?)` take the secret explicitly everywhere: the routes pass `env.sessionSecret`, and the tests pass their own.
- `redirectResponse`, `callbackUrl` and `loginErrorUrl` (Task 3) are used with the same signatures in both routes (Task 5).
- `resolveOAuthUser(provider, profile)` returns `{ id }`, which the callback passes to the existing `signSession(userId, secret)`.
- `signIn(page, userId)` (Task 6) wraps the existing `sessionCookieFor(userId)`, which `collaboration.spec.ts` keeps using unchanged.
- `SYNC_URL` moves from `use-doc.ts` to `sync-url.ts` (Task 8) with an identical expression, so the WebSocket target cannot change.

**Ordering.** Every task ends green. Task 6 is the only one that deletes code, and it rewrites the e2e suite and fixtures in the same task, so nothing is left referencing a deleted export. The grep in Step 12 is the gate.
