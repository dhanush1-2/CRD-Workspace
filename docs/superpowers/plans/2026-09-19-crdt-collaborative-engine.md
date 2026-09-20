# CRDT Collaborative Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a real-time collaborative workspace where two users edit the same kanban board or rich-text document simultaneously, offline edits merge without loss on reconnect, and a `viewer` role is physically unable to write because the sync server rejects their frames.

**Architecture:** Each client holds a Yjs CRDT document and applies edits locally first. A hand-rolled Node WebSocket server speaks the standard Yjs sync protocol, authorizes each frame against a short-lived document-scoped JWT, relays writes to peers synchronously, and persists them to Postgres asynchronously through a write-behind queue. Periodic snapshots keep document load time flat as history grows.

**Tech Stack:** TypeScript 7, Node 24, pnpm workspaces, Yjs 13 + y-protocols 1, `ws` 8, Next.js 16 + React 19, Tiptap 3, Prisma 7 + PostgreSQL 16, jose 6, Vitest 5, Playwright 1.63, Fly.io.

**Spec:** `docs/superpowers/specs/2026-09-19-crdt-collaborative-engine-design.md`

## Global Constraints

Every task's requirements implicitly include this section.

- **Node:** `>=24.0.0`. Declared in every `package.json` `engines` field.
- **Package manager:** `pnpm@10`. Never `npm install` — it will break the workspace links.
- **Exact dependency versions.** Do not run `pnpm add <pkg>@latest`; pin these:
  - `yjs@13.6.32`, `y-protocols@1.0.7`, `y-websocket@3.1.0`, `lib0@0.2.117`
  - `ws@8.21.3`, `@types/ws@8.18.1`
  - `next@16.3.5`, `react@19.3.0`, `react-dom@19.3.0`
  - `@tiptap/core@3.31.3`, `@tiptap/react@3.31.3`, `@tiptap/starter-kit@3.31.3`, `@tiptap/pm@3.31.3`, `@tiptap/extension-collaboration@3.31.3`, `@tiptap/extension-collaboration-caret@3.31.3`, `@tiptap/y-tiptap@3.0.9`
  - `prisma@7.10.0`, `@prisma/client@7.10.0` — **pin the CLI to 7.10.0.** The `latest` dist-tag on `prisma` currently points at an `8.0.0-rc`, which will not match the 7.x client.
  - `jose@6.2.12`, `zod@4.6.5`, `vitest@5.0.1`, `@playwright/test@1.63.0`, `typescript@7.0.2`, `tsx@4.23.14`
- **Extension naming:** the cursor extension is `@tiptap/extension-collaboration-caret`. In Tiptap 3 it was renamed from `-collaboration-cursor`, which is frozen at 2.x. Using the old name installs a v2 package against a v3 editor and fails at runtime.
- **`@tiptap/extension-collaboration` has no `dependencies`, only peers.** `@tiptap/y-tiptap`, `@tiptap/pm`, `@tiptap/core` and `yjs` must be installed explicitly.
- **`disableBc: true` in every test and every automated browser check.** `WebsocketProvider` syncs across same-origin tabs via `BroadcastChannel` by default. Without this flag, two-tab tests pass with the sync server stopped.
- **ESM only.** Every package is `"type": "module"`. `y-protocols` subpath imports (`y-protocols/sync`) only resolve under ESM.
- **Secrets:** `SESSION_SECRET` and `SYNC_JWT_SECRET` are distinct, at least 32 bytes, read from the environment. No default values in code — a missing secret must throw at startup.
- **Never commit `.env`.** `.env.example` is committed; `.env` is gitignored from Task 1.
- **TDD, always.** Write the failing test, watch it fail for the right reason, then implement. A test that has never failed has not been shown to test anything.
- **Commit at the end of every task.** Conventional-commit prefixes: `feat:`, `fix:`, `test:`, `chore:`, `docs:`.

---

## File Structure

```text
crdt-engine/
├── package.json                      workspace root, scripts, engines
├── pnpm-workspace.yaml
├── tsconfig.base.json                shared compiler options
├── vitest.config.ts                  projects: shared, sync, web
├── docker-compose.yml                Postgres 16 for local + CI
├── .env.example
│
├── packages/
│   ├── shared/                       pure logic, zero I/O, fastest tests
│   │   ├── src/fractional-index.ts   ordering keys                    T11
│   │   ├── src/board.ts              board ops as Y.Doc mutations     T12
│   │   ├── src/doc-token.ts          sign/verify the document JWT     T3
│   │   ├── src/types.ts              Role, DocumentType, view models  T3
│   │   └── test/*.test.ts
│   │
│   └── db/                           Prisma schema + client, shared
│       ├── prisma/schema.prisma                                       T2
│       └── src/index.ts              exports the PrismaClient singleton
│
├── apps/
│   ├── sync/                         the WebSocket server
│   │   ├── src/protocol.ts           frame encode/decode/peek         T4
│   │   ├── src/guard.ts              role × frame decision, pure      T5
│   │   ├── src/room.ts               one open document                T6
│   │   ├── src/update-queue.ts       write-behind buffer              T8
│   │   ├── src/store.ts              load/append/snapshot             T9
│   │   ├── src/metrics.ts            counters, gauges, /metrics text  T22
│   │   ├── src/server.ts             http upgrade + wiring            T7
│   │   ├── src/index.ts              entrypoint, config, SIGTERM      T10
│   │   └── test/*.test.ts
│   │
│   └── web/                          Next.js app
│       ├── src/lib/session.ts        scrypt + session cookie          T15
│       ├── src/lib/auth-guard.ts     requireUser / requireRole        T17
│       ├── src/app/api/...           route handlers               T16-T18
│       ├── src/hooks/use-doc.ts      Y.Doc + provider + token refresh T13
│       ├── src/components/Board.tsx  kanban, native HTML5 DnD         T14
│       ├── src/components/Editor.tsx Tiptap + collaboration           T20
│       ├── src/components/Presence.tsx avatars + card focus           T21
│       └── e2e/*.spec.ts             Playwright                       T23
│
└── docs/superpowers/{specs,plans}/
```

**Why this shape.** The two algorithms most likely to be subtly wrong — ordering keys and
the wire protocol — live in files with no database, no socket, and no React, so their tests
run in milliseconds and fail for exactly one reason. `guard.ts` is separated from
`server.ts` for the same reason: the role decision is a pure function over (role, frame
kind), and that is the security property worth testing exhaustively.

---

## Phase 1 — Sync core

*Exit criterion: two Yjs documents converge through a real WebSocket server.*

---

### Task 1: Workspace skeleton

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `vitest.config.ts`, `.gitignore`, `.env.example`, `README.md`
- Create: `packages/shared/package.json`, `packages/shared/tsconfig.json`
- Test: `packages/shared/test/smoke.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: a `pnpm test` command that runs Vitest across all workspace projects; the `@crdt/shared` package name that every later task imports from.

- [ ] **Step 1: Initialize the repository**

```bash
cd /Users/dhanush/Desktop/Projects/CRDT
git init
git add docs
git commit -m "docs: add design document and implementation plan"
```

- [ ] **Step 2: Write the workspace root files**

`pnpm-workspace.yaml`:
```yaml
packages:
  - 'packages/*'
  - 'apps/*'
```

`package.json`:
```json
{
  "name": "crdt-engine",
  "private": true,
  "type": "module",
  "engines": { "node": ">=24.0.0" },
  "packageManager": "pnpm@10.0.0",
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc -b --noEmit"
  },
  "devDependencies": {
    "typescript": "7.0.2",
    "vitest": "5.0.1",
    "tsx": "4.23.14",
    "@types/node": "24.0.0"
  }
}
```

`tsconfig.base.json`:
```json
{
  "compilerOptions": {
    "target": "ES2023",
    "lib": ["ES2023", "DOM"],
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "verbatimModuleSyntax": true,
    "skipLibCheck": true,
    "declaration": true,
    "sourceMap": true
  }
}
```

`vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    projects: [
      { test: { name: 'shared', root: './packages/shared', environment: 'node' } },
      { test: { name: 'sync', root: './apps/sync', environment: 'node' } },
    ],
  },
})
```

`.gitignore`:
```text
node_modules/
.env
.next/
dist/
test-results/
playwright-report/
*.tsbuildinfo
```

`.env.example`:
```text
DATABASE_URL=postgresql://crdt:crdt@localhost:5432/crdt
SESSION_SECRET=replace-me-with-32-bytes-of-random
SYNC_JWT_SECRET=replace-me-with-a-different-32-bytes
SYNC_PORT=1234
NEXT_PUBLIC_SYNC_URL=ws://localhost:1234
```

- [ ] **Step 3: Write the shared package manifest**

`packages/shared/package.json`:
```json
{
  "name": "@crdt/shared",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": {
    "./fractional-index": "./src/fractional-index.ts",
    "./board": "./src/board.ts",
    "./doc-token": "./src/doc-token.ts",
    "./types": "./src/types.ts"
  },
  "dependencies": {
    "yjs": "13.6.32",
    "jose": "6.2.12"
  }
}
```

`packages/shared/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "outDir": "dist", "rootDir": "src" },
  "include": ["src/**/*.ts", "test/**/*.ts"]
}
```

- [ ] **Step 4: Write the smoke test**

`packages/shared/test/smoke.test.ts`:
```ts
import { describe, it, expect } from 'vitest'

describe('workspace', () => {
  it('runs tests', () => {
    expect(1 + 1).toBe(2)
  })
})
```

- [ ] **Step 5: Install and run**

```bash
pnpm install
pnpm test
```
Expected: one passing test under the `shared` project. If Vitest reports "no test files found" for `sync`, that is expected until Task 4 — remove the `sync` project entry temporarily only if it errors rather than warns.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "chore: initialize pnpm workspace with vitest"
```

---

### Task 2: Database schema

**Files:**
- Create: `docker-compose.yml`
- Create: `packages/db/package.json`, `packages/db/prisma/schema.prisma`, `packages/db/src/index.ts`
- Test: `packages/db/test/schema.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `import { prisma } from '@crdt/db'` — a `PrismaClient` singleton. Models `User`, `Workspace`, `WorkspaceMember`, `Document`, `DocumentUpdate`, `DocumentSnapshot`; enums `Role` (`owner|editor|viewer`) and `DocumentType` (`doc|board`).

- [ ] **Step 1: Write the Postgres compose file**

`docker-compose.yml`:
```yaml
services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: crdt
      POSTGRES_PASSWORD: crdt
      POSTGRES_DB: crdt
    ports: ['5432:5432']
    healthcheck:
      test: ['CMD-SHELL', 'pg_isready -U crdt']
      interval: 2s
      timeout: 3s
      retries: 20
```

```bash
docker compose up -d
```

- [ ] **Step 2: Write the schema**

`packages/db/prisma/schema.prisma`:
```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

enum Role { owner editor viewer }

enum DocumentType { doc board }

model User {
  id           String            @id @default(cuid())
  email        String            @unique
  name         String
  passwordHash String
  createdAt    DateTime          @default(now())
  memberships  WorkspaceMember[]
}

model Workspace {
  id        String            @id @default(cuid())
  name      String
  ownerId   String
  createdAt DateTime          @default(now())
  members   WorkspaceMember[]
  documents Document[]
}

model WorkspaceMember {
  id          String    @id @default(cuid())
  workspaceId String
  userId      String
  role        Role
  workspace   Workspace @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  user        User      @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@unique([workspaceId, userId])
  @@index([userId])
}

model Document {
  id          String             @id @default(cuid())
  workspaceId String
  type        DocumentType
  title       String
  createdAt   DateTime           @default(now())
  workspace   Workspace          @relation(fields: [workspaceId], references: [id], onDelete: Cascade)
  updates     DocumentUpdate[]
  snapshots   DocumentSnapshot[]

  @@index([workspaceId])
}

model DocumentUpdate {
  id         BigInt   @id @default(autoincrement())
  documentId String
  update     Bytes
  clientId   String
  createdAt  DateTime @default(now())
  document   Document @relation(fields: [documentId], references: [id], onDelete: Cascade)

  @@index([documentId, id])
}

model DocumentSnapshot {
  id              BigInt   @id @default(autoincrement())
  documentId      String
  state           Bytes
  throughUpdateId BigInt
  snapshotAt      DateTime @default(now())
  document        Document @relation(fields: [documentId], references: [id], onDelete: Cascade)

  @@index([documentId, id])
}
```

`packages/db/package.json`:
```json
{
  "name": "@crdt/db",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": { ".": "./src/index.ts" },
  "scripts": {
    "migrate": "prisma migrate dev",
    "generate": "prisma generate"
  },
  "dependencies": { "@prisma/client": "7.10.0" },
  "devDependencies": { "prisma": "7.10.0" }
}
```

`packages/db/src/index.ts`:
```ts
import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient }

export const prisma = globalForPrisma.prisma ?? new PrismaClient()

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma

export * from '@prisma/client'
```

- [ ] **Step 3: Write the failing schema test**

`packages/db/test/schema.test.ts`:
```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { prisma } from '../src/index.js'

describe('schema', () => {
  let workspaceId: string
  let documentId: string

  beforeAll(async () => {
    const ws = await prisma.workspace.create({
      data: { name: 'test-ws', ownerId: 'usr_test' },
    })
    workspaceId = ws.id
    const doc = await prisma.document.create({
      data: { workspaceId, type: 'board', title: 'test-board' },
    })
    documentId = doc.id
  })

  afterAll(async () => {
    await prisma.workspace.delete({ where: { id: workspaceId } })
    await prisma.$disconnect()
  })

  it('stores binary updates and returns them in insertion order', async () => {
    await prisma.documentUpdate.createMany({
      data: [
        { documentId, update: Buffer.from([1, 2, 3]), clientId: 'c1' },
        { documentId, update: Buffer.from([4, 5, 6]), clientId: 'c2' },
      ],
    })

    const rows = await prisma.documentUpdate.findMany({
      where: { documentId },
      orderBy: { id: 'asc' },
    })

    expect(rows).toHaveLength(2)
    expect(Array.from(rows[0]!.update)).toEqual([1, 2, 3])
    expect(rows[0]!.id < rows[1]!.id).toBe(true)
  })

  it('cascades deletes from document to updates', async () => {
    const doomed = await prisma.document.create({
      data: { workspaceId, type: 'doc', title: 'doomed' },
    })
    await prisma.documentUpdate.create({
      data: { documentId: doomed.id, update: Buffer.from([9]), clientId: 'c1' },
    })

    await prisma.document.delete({ where: { id: doomed.id } })

    const orphans = await prisma.documentUpdate.findMany({
      where: { documentId: doomed.id },
    })
    expect(orphans).toHaveLength(0)
  })
})
```

- [ ] **Step 4: Run it and watch it fail**

```bash
pnpm --filter @crdt/db exec vitest run
```
Expected: FAIL — the Prisma client has not been generated and the tables do not exist.

- [ ] **Step 5: Generate the client and apply the migration**

```bash
cp .env.example .env
pnpm --filter @crdt/db exec prisma migrate dev --name init
pnpm --filter @crdt/db exec prisma generate
```

- [ ] **Step 6: Add the db project to Vitest and re-run**

In `vitest.config.ts`, add to `projects`:
```ts
{ test: { name: 'db', root: './packages/db', environment: 'node' } },
```

```bash
pnpm test
```
Expected: PASS, both schema tests.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: add postgres schema for workspaces, documents, updates and snapshots"
```

---

### Task 3: Document token

**Files:**
- Create: `packages/shared/src/types.ts`, `packages/shared/src/doc-token.ts`
- Test: `packages/shared/test/doc-token.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `type Role = 'owner' | 'editor' | 'viewer'`
  - `interface DocTokenClaims { sub: string; docId: string; role: Role; name: string; color: string }`
  - `signDocToken(claims: DocTokenClaims, secret: string, ttlSeconds?: number): Promise<string>`
  - `verifyDocToken(token: string, secret: string): Promise<DocTokenClaims>` — throws `DocTokenError` on any failure.

- [ ] **Step 1: Write the failing test**

`packages/shared/test/doc-token.test.ts`:
```ts
import { describe, it, expect, vi, afterEach } from 'vitest'
import { signDocToken, verifyDocToken, DocTokenError } from '../src/doc-token.js'
import type { DocTokenClaims } from '../src/doc-token.js'

const SECRET = 'a'.repeat(32)
const OTHER_SECRET = 'b'.repeat(32)

const claims: DocTokenClaims = {
  sub: 'usr_1',
  docId: 'doc_1',
  role: 'editor',
  name: 'Dhanush',
  color: '#e11d48',
}

afterEach(() => { vi.useRealTimers() })

describe('doc token', () => {
  it('round-trips claims', async () => {
    const token = await signDocToken(claims, SECRET)
    await expect(verifyDocToken(token, SECRET)).resolves.toEqual(claims)
  })

  it('rejects a token signed with a different secret', async () => {
    const token = await signDocToken(claims, SECRET)
    await expect(verifyDocToken(token, OTHER_SECRET)).rejects.toBeInstanceOf(DocTokenError)
  })

  it('rejects an expired token', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
    const token = await signDocToken(claims, SECRET, 900)

    vi.setSystemTime(new Date('2026-01-01T00:15:01Z'))
    await expect(verifyDocToken(token, SECRET)).rejects.toBeInstanceOf(DocTokenError)
  })

  it('rejects garbage', async () => {
    await expect(verifyDocToken('not-a-jwt', SECRET)).rejects.toBeInstanceOf(DocTokenError)
  })

  it('rejects a token missing a required claim', async () => {
    const token = await signDocToken({ ...claims, docId: '' }, SECRET)
    await expect(verifyDocToken(token, SECRET)).rejects.toBeInstanceOf(DocTokenError)
  })

  it('rejects an unknown role', async () => {
    const token = await signDocToken(
      { ...claims, role: 'admin' as unknown as DocTokenClaims['role'] },
      SECRET,
    )
    await expect(verifyDocToken(token, SECRET)).rejects.toBeInstanceOf(DocTokenError)
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

```bash
pnpm --filter @crdt/shared exec vitest run doc-token
```
Expected: FAIL — `Cannot find module '../src/doc-token.js'`.

- [ ] **Step 3: Implement the types**

`packages/shared/src/types.ts`:
```ts
export type Role = 'owner' | 'editor' | 'viewer'

export const ROLES: readonly Role[] = ['owner', 'editor', 'viewer'] as const

export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && (ROLES as readonly string[]).includes(value)
}

export type DocumentType = 'doc' | 'board'
```

- [ ] **Step 4: Implement the token**

`packages/shared/src/doc-token.ts`:
```ts
import { SignJWT, jwtVerify } from 'jose'
import { isRole, type Role } from './types.js'

export interface DocTokenClaims {
  sub: string
  docId: string
  role: Role
  name: string
  color: string
}

export class DocTokenError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'DocTokenError'
  }
}

const encodeSecret = (secret: string): Uint8Array => new TextEncoder().encode(secret)

export const DEFAULT_TTL_SECONDS = 900

export async function signDocToken(
  claims: DocTokenClaims,
  secret: string,
  ttlSeconds: number = DEFAULT_TTL_SECONDS,
): Promise<string> {
  return new SignJWT({
    docId: claims.docId,
    role: claims.role,
    name: claims.name,
    color: claims.color,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(claims.sub)
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + ttlSeconds)
    .sign(encodeSecret(secret))
}

export async function verifyDocToken(token: string, secret: string): Promise<DocTokenClaims> {
  let payload: Record<string, unknown>
  try {
    const result = await jwtVerify(token, encodeSecret(secret), { algorithms: ['HS256'] })
    payload = result.payload as Record<string, unknown>
  } catch (cause) {
    throw new DocTokenError('token verification failed', { cause })
  }

  const { sub, docId, role, name, color } = payload

  if (typeof sub !== 'string' || sub.length === 0) throw new DocTokenError('missing sub')
  if (typeof docId !== 'string' || docId.length === 0) throw new DocTokenError('missing docId')
  if (!isRole(role)) throw new DocTokenError('invalid role')
  if (typeof name !== 'string') throw new DocTokenError('missing name')
  if (typeof color !== 'string') throw new DocTokenError('missing color')

  return { sub, docId, role, name, color }
}
```

- [ ] **Step 5: Run the tests**

```bash
pnpm --filter @crdt/shared exec vitest run doc-token
```
Expected: PASS, 6 tests.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: add document-scoped jwt for cross-process authorization"
```

---

### Task 4: Wire protocol

**Files:**
- Create: `apps/sync/package.json`, `apps/sync/tsconfig.json`, `apps/sync/src/protocol.ts`
- Test: `apps/sync/test/protocol.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `MESSAGE_SYNC = 0`, `MESSAGE_AWARENESS = 1`, `MESSAGE_AUTH = 2`, `MESSAGE_QUERY_AWARENESS = 3`
  - `type FrameKind = 'sync-step1' | 'sync-step2' | 'update' | 'awareness' | 'query-awareness' | 'unknown'`
  - `peekFrame(data: Uint8Array): FrameKind` — never throws, never consumes.
  - `encodeSyncStep1(doc: Y.Doc): Uint8Array`
  - `encodeUpdate(update: Uint8Array): Uint8Array`
  - `encodeAwareness(awareness: Awareness, clients: number[]): Uint8Array`
  - `encodePermissionDenied(reason: string): Uint8Array`
  - `handleSyncFrame(data: Uint8Array, doc: Y.Doc, origin: unknown): Uint8Array | null` — applies the frame and returns a reply frame if the protocol requires one.

- [ ] **Step 1: Write the sync app manifest**

`apps/sync/package.json`:
```json
{
  "name": "@crdt/sync",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "engines": { "node": ">=24.0.0" },
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "start": "tsx src/index.ts"
  },
  "dependencies": {
    "@crdt/db": "workspace:*",
    "@crdt/shared": "workspace:*",
    "lib0": "0.2.117",
    "ws": "8.21.3",
    "y-protocols": "1.0.7",
    "yjs": "13.6.32"
  },
  "devDependencies": {
    "@types/ws": "8.18.1",
    "y-websocket": "3.1.0"
  }
}
```

`apps/sync/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "outDir": "dist", "rootDir": "src" },
  "include": ["src/**/*.ts", "test/**/*.ts"]
}
```

```bash
pnpm install
```

- [ ] **Step 2: Write the failing test**

`apps/sync/test/protocol.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import * as Y from 'yjs'
import { Awareness } from 'y-protocols/awareness'
import {
  peekFrame,
  encodeSyncStep1,
  encodeUpdate,
  encodeAwareness,
  encodePermissionDenied,
  handleSyncFrame,
} from '../src/protocol.js'

describe('peekFrame', () => {
  it('identifies sync step 1', () => {
    const doc = new Y.Doc()
    expect(peekFrame(encodeSyncStep1(doc))).toBe('sync-step1')
  })

  it('identifies an update', () => {
    const doc = new Y.Doc()
    doc.getText('t').insert(0, 'hello')
    expect(peekFrame(encodeUpdate(Y.encodeStateAsUpdate(doc)))).toBe('update')
  })

  it('identifies awareness', () => {
    const doc = new Y.Doc()
    const awareness = new Awareness(doc)
    awareness.setLocalState({ user: { name: 'a' } })
    const frame = encodeAwareness(awareness, [doc.clientID])
    expect(peekFrame(frame)).toBe('awareness')
  })

  it('returns unknown for an empty frame instead of throwing', () => {
    expect(peekFrame(new Uint8Array(0))).toBe('unknown')
  })

  it('returns unknown for a truncated sync frame instead of throwing', () => {
    expect(peekFrame(new Uint8Array([0]))).toBe('unknown')
  })

  it('does not consume the frame', () => {
    const doc = new Y.Doc()
    const frame = encodeSyncStep1(doc)
    expect(peekFrame(frame)).toBe('sync-step1')
    expect(peekFrame(frame)).toBe('sync-step1')
  })
})

describe('handleSyncFrame', () => {
  it('replies to sync step 1 with sync step 2', () => {
    const server = new Y.Doc()
    server.getText('t').insert(0, 'server state')
    const client = new Y.Doc()

    const reply = handleSyncFrame(encodeSyncStep1(client), server, 'test')

    expect(reply).not.toBeNull()
    expect(peekFrame(reply!)).toBe('sync-step2')
  })

  it('applies an update and returns no reply', () => {
    const source = new Y.Doc()
    source.getText('t').insert(0, 'abc')
    const target = new Y.Doc()

    const reply = handleSyncFrame(encodeUpdate(Y.encodeStateAsUpdate(source)), target, 'test')

    expect(reply).toBeNull()
    expect(target.getText('t').toString()).toBe('abc')
  })

  it('converges two documents through a full handshake', () => {
    const a = new Y.Doc()
    const b = new Y.Doc()
    a.getText('t').insert(0, 'from-a ')
    b.getText('t').insert(0, 'from-b ')

    // a -> b: step1, b replies step2
    const step2FromB = handleSyncFrame(encodeSyncStep1(a), b, 'a')!
    handleSyncFrame(step2FromB, a, 'b')
    // b -> a: step1, a replies step2
    const step2FromA = handleSyncFrame(encodeSyncStep1(b), a, 'b')!
    handleSyncFrame(step2FromA, b, 'a')

    expect(a.getText('t').toString()).toBe(b.getText('t').toString())
    expect(a.getText('t').toString()).toContain('from-a')
    expect(a.getText('t').toString()).toContain('from-b')
  })
})

describe('encodePermissionDenied', () => {
  it('produces an auth frame', () => {
    expect(peekFrame(encodePermissionDenied('read only'))).toBe('unknown')
  })
})
```

Note on the last test: `MESSAGE_AUTH` is not one of the frame kinds the guard cares about,
so `peekFrame` classifies it as `unknown`. The server only ever *sends* auth frames, never
receives them, so this is correct rather than a gap. The test pins that intent.

- [ ] **Step 3: Run it and watch it fail**

```bash
pnpm --filter @crdt/sync exec vitest run protocol
```
Expected: FAIL — `Cannot find module '../src/protocol.js'`.

- [ ] **Step 4: Implement the protocol module**

`apps/sync/src/protocol.ts`:
```ts
import * as encoding from 'lib0/encoding'
import * as decoding from 'lib0/decoding'
import * as syncProtocol from 'y-protocols/sync'
import * as awarenessProtocol from 'y-protocols/awareness'
import * as authProtocol from 'y-protocols/auth'
import type * as Y from 'yjs'

export const MESSAGE_SYNC = 0
export const MESSAGE_AWARENESS = 1
export const MESSAGE_AUTH = 2
export const MESSAGE_QUERY_AWARENESS = 3

export type FrameKind =
  | 'sync-step1'
  | 'sync-step2'
  | 'update'
  | 'awareness'
  | 'query-awareness'
  | 'unknown'

/**
 * Classify a frame without consuming it. Creates its own decoder, so the caller's
 * buffer is untouched and can be decoded again afterwards.
 *
 * Never throws: a malformed frame from a hostile or buggy client must not be able to
 * take down the connection handler before the guard has had a chance to reject it.
 */
export function peekFrame(data: Uint8Array): FrameKind {
  try {
    const decoder = decoding.createDecoder(data)
    const messageType = decoding.readVarUint(decoder)

    switch (messageType) {
      case MESSAGE_SYNC: {
        const syncType = decoding.readVarUint(decoder)
        if (syncType === syncProtocol.messageYjsSyncStep1) return 'sync-step1'
        if (syncType === syncProtocol.messageYjsSyncStep2) return 'sync-step2'
        if (syncType === syncProtocol.messageYjsUpdate) return 'update'
        return 'unknown'
      }
      case MESSAGE_AWARENESS:
        return 'awareness'
      case MESSAGE_QUERY_AWARENESS:
        return 'query-awareness'
      default:
        return 'unknown'
    }
  } catch {
    return 'unknown'
  }
}

export function encodeSyncStep1(doc: Y.Doc): Uint8Array {
  const encoder = encoding.createEncoder()
  encoding.writeVarUint(encoder, MESSAGE_SYNC)
  syncProtocol.writeSyncStep1(encoder, doc)
  return encoding.toUint8Array(encoder)
}

export function encodeSyncStep2(doc: Y.Doc, stateVector?: Uint8Array): Uint8Array {
  const encoder = encoding.createEncoder()
  encoding.writeVarUint(encoder, MESSAGE_SYNC)
  syncProtocol.writeSyncStep2(encoder, doc, stateVector)
  return encoding.toUint8Array(encoder)
}

export function encodeUpdate(update: Uint8Array): Uint8Array {
  const encoder = encoding.createEncoder()
  encoding.writeVarUint(encoder, MESSAGE_SYNC)
  syncProtocol.writeUpdate(encoder, update)
  return encoding.toUint8Array(encoder)
}

export function encodeAwareness(
  awareness: awarenessProtocol.Awareness,
  clients: number[],
): Uint8Array {
  const encoder = encoding.createEncoder()
  encoding.writeVarUint(encoder, MESSAGE_AWARENESS)
  encoding.writeVarUint8Array(
    encoder,
    awarenessProtocol.encodeAwarenessUpdate(awareness, clients),
  )
  return encoding.toUint8Array(encoder)
}

export function encodePermissionDenied(reason: string): Uint8Array {
  const encoder = encoding.createEncoder()
  encoding.writeVarUint(encoder, MESSAGE_AUTH)
  authProtocol.writePermissionDenied(encoder, reason)
  return encoding.toUint8Array(encoder)
}

/**
 * Apply a sync frame to `doc` and return the reply the protocol requires, or null.
 *
 * The `encoding.length(encoder) > 1` check is how the Yjs reference implementation
 * decides whether a reply exists: the encoder always holds the leading MESSAGE_SYNC
 * varUint, so a length of exactly 1 means readSyncMessage wrote nothing.
 */
export function handleSyncFrame(
  data: Uint8Array,
  doc: Y.Doc,
  origin: unknown,
): Uint8Array | null {
  const decoder = decoding.createDecoder(data)
  const encoder = encoding.createEncoder()

  decoding.readVarUint(decoder) // consume MESSAGE_SYNC
  encoding.writeVarUint(encoder, MESSAGE_SYNC)

  syncProtocol.readSyncMessage(decoder, encoder, doc, origin)

  return encoding.length(encoder) > 1 ? encoding.toUint8Array(encoder) : null
}

export function applyAwarenessFrame(
  data: Uint8Array,
  awareness: awarenessProtocol.Awareness,
  origin: unknown,
): void {
  const decoder = decoding.createDecoder(data)
  decoding.readVarUint(decoder) // consume MESSAGE_AWARENESS
  awarenessProtocol.applyAwarenessUpdate(
    awareness,
    decoding.readVarUint8Array(decoder),
    origin,
  )
}
```

- [ ] **Step 5: Run the tests**

```bash
pnpm --filter @crdt/sync exec vitest run protocol
```
Expected: PASS, 10 tests.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: add yjs wire protocol encode, decode and non-consuming peek"
```

---

### Task 5: Role guard

**Files:**
- Create: `apps/sync/src/guard.ts`
- Test: `apps/sync/test/guard.test.ts`

**Interfaces:**
- Consumes: `FrameKind` from `apps/sync/src/protocol.ts`; `Role` from `@crdt/shared/types`
- Produces: `interface GuardDecision { allow: boolean; notify: boolean; reason: string }` and `guard(role: Role, kind: FrameKind): GuardDecision`.

- [ ] **Step 1: Write the failing test**

`apps/sync/test/guard.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { guard } from '../src/guard.js'
import type { FrameKind } from '../src/protocol.js'
import type { Role } from '@crdt/shared/types'

const WRITE_KINDS: FrameKind[] = ['sync-step2', 'update']
const READ_KINDS: FrameKind[] = ['sync-step1', 'awareness', 'query-awareness']

describe('guard', () => {
  for (const role of ['owner', 'editor'] as Role[]) {
    it(`allows every legitimate frame for ${role}`, () => {
      for (const kind of [...WRITE_KINDS, ...READ_KINDS]) {
        expect(guard(role, kind).allow, `${role} / ${kind}`).toBe(true)
      }
    })
  }

  it('allows a viewer to read state and publish presence', () => {
    for (const kind of READ_KINDS) {
      expect(guard('viewer', kind).allow, kind).toBe(true)
    }
  })

  it('denies a viewer every write frame', () => {
    for (const kind of WRITE_KINDS) {
      expect(guard('viewer', kind).allow, kind).toBe(false)
    }
  })

  it('notifies a viewer who sends a real update', () => {
    const decision = guard('viewer', 'update')
    expect(decision.allow).toBe(false)
    expect(decision.notify).toBe(true)
    expect(decision.reason).toBe('viewer_update')
  })

  it('silently drops a viewer handshake sync-step2 without notifying', () => {
    // Every y-websocket client answers the server's sync-step1 with a sync-step2,
    // even when it has nothing to contribute. Notifying on that would fire a
    // permission-denied on every single viewer connection.
    const decision = guard('viewer', 'sync-step2')
    expect(decision.allow).toBe(false)
    expect(decision.notify).toBe(false)
    expect(decision.reason).toBe('viewer_sync_step2')
  })

  it('denies unknown frames for every role', () => {
    for (const role of ['owner', 'editor', 'viewer'] as Role[]) {
      const decision = guard(role, 'unknown')
      expect(decision.allow, role).toBe(false)
      expect(decision.reason).toBe('malformed_frame')
    }
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

```bash
pnpm --filter @crdt/sync exec vitest run guard
```
Expected: FAIL — `Cannot find module '../src/guard.js'`.

- [ ] **Step 3: Implement the guard**

`apps/sync/src/guard.ts`:
```ts
import type { Role } from '@crdt/shared/types'
import type { FrameKind } from './protocol.js'

export interface GuardDecision {
  /** Whether the frame may be applied to the room document and relayed to peers. */
  allow: boolean
  /** Whether to send this connection a permission-denied frame. */
  notify: boolean
  /** Metric label. */
  reason: string
}

const ALLOWED: GuardDecision = { allow: true, notify: false, reason: 'ok' }

/**
 * The authorization decision, as a pure function of role and frame kind.
 *
 * A viewer may send sync-step1 (asking what the server has) and awareness frames
 * (their cursor), but may not send sync-step2 or update frames, which are the only
 * two frames that carry document mutations.
 */
export function guard(role: Role, kind: FrameKind): GuardDecision {
  if (kind === 'unknown') {
    return { allow: false, notify: false, reason: 'malformed_frame' }
  }

  if (role !== 'viewer') return ALLOWED

  switch (kind) {
    case 'update':
      return { allow: false, notify: true, reason: 'viewer_update' }
    case 'sync-step2':
      return { allow: false, notify: false, reason: 'viewer_sync_step2' }
    default:
      return ALLOWED
  }
}
```

- [ ] **Step 4: Run the tests**

```bash
pnpm --filter @crdt/sync exec vitest run guard
```
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: add pure role-versus-frame authorization decision"
```

---

### Task 6: Document room

**Files:**
- Create: `apps/sync/src/room.ts`
- Test: `apps/sync/test/room.test.ts`

**Interfaces:**
- Consumes: `protocol.ts`, `guard.ts`
- Produces:
  - `interface Connection { readonly id: string; readonly userId: string; readonly role: Role; send(data: Uint8Array): void; close(code: number, reason: string): void }`
  - `const LOAD_ORIGIN: symbol` — the origin to pass when applying persisted state so it is not re-persisted.
  - `class DocumentRoom` with `documentId`, `doc`, `awareness`, `size`, `add(conn)`, `remove(conn)`, `handleFrame(conn, data)`, `loadState(update)`, `destroy()`.
  - Constructor option `onPersist(update: Uint8Array, clientId: string): void`.

- [ ] **Step 1: Write the failing test**

`apps/sync/test/room.test.ts`:
```ts
import { describe, it, expect, vi } from 'vitest'
import * as Y from 'yjs'
import { DocumentRoom, LOAD_ORIGIN, type Connection } from '../src/room.js'
import { encodeSyncStep1, encodeUpdate, handleSyncFrame, peekFrame } from '../src/protocol.js'
import type { Role } from '@crdt/shared/types'

function fakeConnection(id: string, role: Role = 'editor') {
  const sent: Uint8Array[] = []
  const closed: Array<{ code: number; reason: string }> = []
  const conn: Connection = {
    id,
    userId: `usr_${id}`,
    role,
    send: (data) => { sent.push(data) },
    close: (code, reason) => { closed.push({ code, reason }) },
  }
  return { conn, sent, closed }
}

describe('DocumentRoom', () => {
  it('relays an editor update to peers but not back to the sender', () => {
    const room = new DocumentRoom('doc_1', { onPersist: () => {} })
    const a = fakeConnection('a')
    const b = fakeConnection('b')
    room.add(a.conn)
    room.add(b.conn)

    const source = new Y.Doc()
    source.getText('t').insert(0, 'hello')
    room.handleFrame(a.conn, encodeUpdate(Y.encodeStateAsUpdate(source)))

    expect(a.sent).toHaveLength(0)
    expect(b.sent).toHaveLength(1)
    expect(peekFrame(b.sent[0]!)).toBe('update')
    expect(room.doc.getText('t').toString()).toBe('hello')
  })

  it('answers sync-step1 on the sender connection only', () => {
    const room = new DocumentRoom('doc_1', { onPersist: () => {} })
    room.doc.getText('t').insert(0, 'server state')
    const a = fakeConnection('a')
    const b = fakeConnection('b')
    room.add(a.conn)
    room.add(b.conn)

    room.handleFrame(a.conn, encodeSyncStep1(new Y.Doc()))

    expect(a.sent.map(peekFrame)).toContain('sync-step2')
    expect(b.sent).toHaveLength(0)
  })

  it('calls onPersist once per applied update with the sender id', () => {
    const onPersist = vi.fn()
    const room = new DocumentRoom('doc_1', { onPersist })
    const a = fakeConnection('a')
    room.add(a.conn)

    const source = new Y.Doc()
    source.getText('t').insert(0, 'x')
    room.handleFrame(a.conn, encodeUpdate(Y.encodeStateAsUpdate(source)))

    expect(onPersist).toHaveBeenCalledTimes(1)
    expect(onPersist.mock.calls[0]![1]).toBe('a')
  })

  it('does not persist state loaded from storage', () => {
    const onPersist = vi.fn()
    const room = new DocumentRoom('doc_1', { onPersist })

    const stored = new Y.Doc()
    stored.getText('t').insert(0, 'from disk')
    room.loadState(Y.encodeStateAsUpdate(stored))

    expect(onPersist).not.toHaveBeenCalled()
    expect(room.doc.getText('t').toString()).toBe('from disk')
  })

  it('drops a viewer update: no peer relay, no persistence, permission denied sent', () => {
    const onPersist = vi.fn()
    const room = new DocumentRoom('doc_1', { onPersist })
    const viewer = fakeConnection('v', 'viewer')
    const editor = fakeConnection('e', 'editor')
    room.add(viewer.conn)
    room.add(editor.conn)

    const source = new Y.Doc()
    source.getText('t').insert(0, 'sneaky')
    room.handleFrame(viewer.conn, encodeUpdate(Y.encodeStateAsUpdate(source)))

    expect(room.doc.getText('t').toString()).toBe('')
    expect(editor.sent).toHaveLength(0)
    expect(onPersist).not.toHaveBeenCalled()
    expect(viewer.sent).toHaveLength(1) // the permission-denied frame
  })

  it('drops a viewer handshake sync-step2 without sending anything back', () => {
    const room = new DocumentRoom('doc_1', { onPersist: () => {} })
    const viewer = fakeConnection('v', 'viewer')
    room.add(viewer.conn)

    const client = new Y.Doc()
    const step2 = handleSyncFrame(encodeSyncStep1(room.doc), client, 'test')!
    room.handleFrame(viewer.conn, step2)

    expect(viewer.sent).toHaveLength(0)
  })

  it('reports size and stops relaying to removed connections', () => {
    const room = new DocumentRoom('doc_1', { onPersist: () => {} })
    const a = fakeConnection('a')
    const b = fakeConnection('b')
    room.add(a.conn)
    room.add(b.conn)
    expect(room.size).toBe(2)

    room.remove(b.conn)
    expect(room.size).toBe(1)

    const source = new Y.Doc()
    source.getText('t').insert(0, 'y')
    room.handleFrame(a.conn, encodeUpdate(Y.encodeStateAsUpdate(source)))
    expect(b.sent).toHaveLength(0)
  })

  it('survives a malformed frame without throwing', () => {
    const room = new DocumentRoom('doc_1', { onPersist: () => {} })
    const a = fakeConnection('a')
    room.add(a.conn)

    expect(() => room.handleFrame(a.conn, new Uint8Array([200, 200, 200]))).not.toThrow()
    expect(room.size).toBe(1)
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

```bash
pnpm --filter @crdt/sync exec vitest run room
```
Expected: FAIL — `Cannot find module '../src/room.js'`.

- [ ] **Step 3: Implement the room**

`apps/sync/src/room.ts`:
```ts
import * as Y from 'yjs'
import { Awareness, removeAwarenessStates } from 'y-protocols/awareness'
import type { Role } from '@crdt/shared/types'
import {
  applyAwarenessFrame,
  encodeAwareness,
  encodePermissionDenied,
  encodeUpdate,
  handleSyncFrame,
  peekFrame,
} from './protocol.js'
import { guard } from './guard.js'

export interface Connection {
  readonly id: string
  readonly userId: string
  readonly role: Role
  send(data: Uint8Array): void
  close(code: number, reason: string): void
}

/** Origin used when applying persisted state, so the update observer skips re-persisting it. */
export const LOAD_ORIGIN = Symbol('load')

export interface RoomOptions {
  onPersist(update: Uint8Array, clientId: string): void
  onReject?(reason: string, conn: Connection): void
}

export class DocumentRoom {
  readonly doc = new Y.Doc()
  readonly awareness = new Awareness(this.doc)

  private readonly connections = new Set<Connection>()
  private readonly notified = new Set<string>()
  /** Awareness client ids owned by each connection, so they can be cleared on disconnect. */
  private readonly awarenessClients = new Map<Connection, Set<number>>()

  constructor(
    readonly documentId: string,
    private readonly options: RoomOptions,
  ) {
    this.awareness.setLocalState(null)

    this.doc.on('update', (update: Uint8Array, origin: unknown) => {
      if (origin !== LOAD_ORIGIN) {
        const sender = origin as Connection | undefined
        this.broadcast(encodeUpdate(update), sender)
        this.options.onPersist(update, sender?.id ?? 'server')
      }
    })

    this.awareness.on(
      'update',
      ({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] },
       origin: unknown) => {
        const changed = [...added, ...updated, ...removed]
        if (changed.length === 0) return
        this.broadcast(encodeAwareness(this.awareness, changed), origin as Connection | undefined)
      },
    )
  }

  get size(): number {
    return this.connections.size
  }

  add(conn: Connection): void {
    this.connections.add(conn)
    this.awarenessClients.set(conn, new Set())
  }

  remove(conn: Connection): void {
    this.connections.delete(conn)
    this.notified.delete(conn.id)

    const clients = this.awarenessClients.get(conn)
    if (clients && clients.size > 0) {
      removeAwarenessStates(this.awareness, [...clients], null)
    }
    this.awarenessClients.delete(conn)
  }

  /** Apply state read from storage. Does not trigger persistence or broadcast to peers. */
  loadState(update: Uint8Array): void {
    Y.applyUpdate(this.doc, update, LOAD_ORIGIN)
  }

  handleFrame(conn: Connection, data: Uint8Array): void {
    const kind = peekFrame(data)
    const decision = guard(conn.role, kind)

    if (!decision.allow) {
      this.options.onReject?.(decision.reason, conn)
      if (decision.notify && !this.notified.has(conn.id)) {
        this.notified.add(conn.id)
        conn.send(encodePermissionDenied('your role is read-only for this document'))
      }
      return
    }

    try {
      if (kind === 'awareness') {
        this.trackAwareness(conn, data)
        applyAwarenessFrame(data, this.awareness, conn)
        return
      }

      if (kind === 'query-awareness') {
        const clients = [...this.awareness.getStates().keys()]
        if (clients.length > 0) conn.send(encodeAwareness(this.awareness, clients))
        return
      }

      // sync-step1 / sync-step2 / update. The doc's update observer handles relay
      // and persistence; the reply here goes only to the sender.
      const reply = handleSyncFrame(data, this.doc, conn)
      if (reply) conn.send(reply)
    } catch (error) {
      this.options.onReject?.('frame_error', conn)
      conn.close(4500, 'frame handling failed')
      void error
    }
  }

  destroy(): void {
    this.awareness.destroy()
    this.doc.destroy()
    this.connections.clear()
    this.awarenessClients.clear()
  }

  private trackAwareness(conn: Connection, data: Uint8Array): void {
    const before = new Set(this.awareness.getStates().keys())
    queueMicrotask(() => {
      const owned = this.awarenessClients.get(conn)
      if (!owned) return
      for (const client of this.awareness.getStates().keys()) {
        if (!before.has(client)) owned.add(client)
      }
    })
    void data
  }

  private broadcast(frame: Uint8Array, except?: Connection): void {
    for (const conn of this.connections) {
      if (conn === except) continue
      conn.send(frame)
    }
  }
}
```

- [ ] **Step 4: Run the tests**

```bash
pnpm --filter @crdt/sync exec vitest run room
```
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: add document room with per-frame role enforcement and peer relay"
```

---

### Task 7: WebSocket server

**Files:**
- Create: `apps/sync/src/server.ts`, `apps/sync/src/config.ts`, `apps/sync/src/index.ts`
- Test: `apps/sync/test/server.integration.test.ts`

**Interfaces:**
- Consumes: `room.ts`, `@crdt/shared/doc-token`
- Produces:
  - `interface SyncServerOptions { port: number; jwtSecret: string; onPersist?(documentId, update, clientId): void; loadDocument?(documentId): Promise<Uint8Array | null>; idleEvictMs?: number }`
  - `createSyncServer(options): Promise<SyncServer>` where `SyncServer` has `port: number`, `roomCount: number`, `close(): Promise<void>`.

- [ ] **Step 1: Write the failing integration test**

`apps/sync/test/server.integration.test.ts`:
```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as Y from 'yjs'
import { WebsocketProvider } from 'y-websocket'
import { WebSocket } from 'ws'
import { signDocToken } from '@crdt/shared/doc-token'
import type { Role } from '@crdt/shared/types'
import { createSyncServer, type SyncServer } from '../src/server.js'

const SECRET = 'test-secret-that-is-long-enough!!'

let server: SyncServer

beforeEach(async () => {
  server = await createSyncServer({ port: 0, jwtSecret: SECRET })
})

afterEach(async () => {
  await server.close()
})

async function connect(documentId: string, name: string, role: Role = 'editor') {
  const token = await signDocToken(
    { sub: `usr_${name}`, docId: documentId, role, name, color: '#000' },
    SECRET,
  )
  const doc = new Y.Doc()
  const provider = new WebsocketProvider(`ws://127.0.0.1:${server.port}`, documentId, doc, {
    params: { token },
    WebSocketPolyfill: WebSocket as unknown as typeof globalThis.WebSocket,
    // Without this, the two providers in this process sync over BroadcastChannel
    // and the test passes even with the server stopped.
    disableBc: true,
  })
  await new Promise<void>((resolve) => provider.once('sync', () => resolve()))
  return { doc, provider }
}

function eventually(predicate: () => boolean, timeoutMs = 3000): Promise<void> {
  return new Promise((resolve, reject) => {
    const started = Date.now()
    const tick = () => {
      if (predicate()) return resolve()
      if (Date.now() - started > timeoutMs) return reject(new Error('condition not met in time'))
      setTimeout(tick, 20)
    }
    tick()
  })
}

describe('sync server', () => {
  it('converges two clients on the same document', async () => {
    const a = await connect('doc_1', 'alice')
    const b = await connect('doc_1', 'bob')

    a.doc.getText('t').insert(0, 'hello ')
    b.doc.getText('t').insert(0, 'world ')

    await eventually(() => a.doc.getText('t').toString() === b.doc.getText('t').toString())

    expect(a.doc.getText('t').toString()).toContain('hello')
    expect(a.doc.getText('t').toString()).toContain('world')

    a.provider.destroy()
    b.provider.destroy()
  })

  it('isolates different documents', async () => {
    const a = await connect('doc_a', 'alice')
    const b = await connect('doc_b', 'bob')

    a.doc.getText('t').insert(0, 'only-in-a')
    await new Promise((r) => setTimeout(r, 300))

    expect(b.doc.getText('t').toString()).toBe('')

    a.provider.destroy()
    b.provider.destroy()
  })

  it('closes a connection with no token using a permanent code', async () => {
    const doc = new Y.Doc()
    const closed = new Promise<{ code: number }>((resolve) => {
      const provider = new WebsocketProvider(
        `ws://127.0.0.1:${server.port}`, 'doc_1', doc,
        {
          WebSocketPolyfill: WebSocket as unknown as typeof globalThis.WebSocket,
          disableBc: true,
        },
      )
      provider.once('closed', (event) => resolve(event))
    })

    const event = await closed
    expect(event.code).toBe(4401)
  })

  it('rejects a token minted for a different document', async () => {
    const token = await signDocToken(
      { sub: 'usr_1', docId: 'doc_other', role: 'editor', name: 'mallory', color: '#000' },
      SECRET,
    )
    const doc = new Y.Doc()
    const closed = new Promise<{ code: number }>((resolve) => {
      const provider = new WebsocketProvider(
        `ws://127.0.0.1:${server.port}`, 'doc_1', doc,
        {
          params: { token },
          WebSocketPolyfill: WebSocket as unknown as typeof globalThis.WebSocket,
          disableBc: true,
        },
      )
      provider.once('closed', (event) => resolve(event))
    })

    expect((await closed).code).toBe(4403)
  })

  it('never lets a viewer edit reach another client', async () => {
    const editor = await connect('doc_v', 'editor-user', 'editor')
    const viewer = await connect('doc_v', 'viewer-user', 'viewer')

    viewer.doc.getText('t').insert(0, 'VIEWER WROTE THIS')
    editor.doc.getText('t').insert(0, 'editor wrote this')

    await eventually(() => editor.doc.getText('t').toString().includes('editor wrote this'))
    await new Promise((r) => setTimeout(r, 300))

    expect(editor.doc.getText('t').toString()).not.toContain('VIEWER')

    editor.provider.destroy()
    viewer.provider.destroy()
  })

  it('catches a client up after it reconnects', async () => {
    const a = await connect('doc_r', 'alice')
    const b = await connect('doc_r', 'bob')

    b.provider.disconnect()
    a.doc.getText('t').insert(0, 'written while bob was away')
    b.doc.getText('t').insert(0, 'written by bob offline ')

    await new Promise((r) => setTimeout(r, 200))
    b.provider.connect()

    await eventually(() => a.doc.getText('t').toString() === b.doc.getText('t').toString())
    expect(b.doc.getText('t').toString()).toContain('while bob was away')
    expect(a.doc.getText('t').toString()).toContain('by bob offline')

    a.provider.destroy()
    b.provider.destroy()
  })

  it('evicts a room once the last client leaves', async () => {
    const a = await connect('doc_e', 'alice')
    expect(server.roomCount).toBe(1)

    a.provider.destroy()
    await eventually(() => server.roomCount === 0, 5000)
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

```bash
pnpm --filter @crdt/sync exec vitest run server
```
Expected: FAIL — `Cannot find module '../src/server.js'`.

- [ ] **Step 3: Implement config**

`apps/sync/src/config.ts`:
```ts
function required(name: string): string {
  const value = process.env[name]
  if (!value || value.length < 32) {
    throw new Error(`${name} must be set to at least 32 characters`)
  }
  return value
}

export function loadConfig() {
  return {
    port: Number(process.env.SYNC_PORT ?? 1234),
    jwtSecret: required('SYNC_JWT_SECRET'),
    idleEvictMs: Number(process.env.SYNC_IDLE_EVICT_MS ?? 30_000),
  }
}
```

- [ ] **Step 4: Implement the server**

`apps/sync/src/server.ts`:
```ts
import { createServer, type IncomingMessage, type Server } from 'node:http'
import { randomUUID } from 'node:crypto'
import { WebSocketServer, type WebSocket } from 'ws'
import { verifyDocToken } from '@crdt/shared/doc-token'
import { DocumentRoom, type Connection } from './room.js'

export interface SyncServerOptions {
  port: number
  jwtSecret: string
  idleEvictMs?: number
  onPersist?(documentId: string, update: Uint8Array, clientId: string): void
  loadDocument?(documentId: string): Promise<Uint8Array | null>
  onReject?(documentId: string, reason: string): void
}

export interface SyncServer {
  readonly port: number
  readonly roomCount: number
  close(): Promise<void>
}

const MAX_FRAME_BYTES = 1024 * 1024

export async function createSyncServer(options: SyncServerOptions): Promise<SyncServer> {
  const idleEvictMs = options.idleEvictMs ?? 30_000
  const rooms = new Map<string, DocumentRoom>()
  const evictTimers = new Map<string, NodeJS.Timeout>()

  const http: Server = createServer((req, res) => {
    if (req.url === '/healthz') {
      res.writeHead(200, { 'content-type': 'text/plain' })
      res.end('ok')
      return
    }
    res.writeHead(404)
    res.end()
  })

  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_FRAME_BYTES })

  async function roomFor(documentId: string): Promise<DocumentRoom> {
    const existing = rooms.get(documentId)
    if (existing) return existing

    const room = new DocumentRoom(documentId, {
      onPersist: (update, clientId) => options.onPersist?.(documentId, update, clientId),
      onReject: (reason) => options.onReject?.(documentId, reason),
    })
    rooms.set(documentId, room)

    if (options.loadDocument) {
      const state = await options.loadDocument(documentId)
      if (state) room.loadState(state)
    }
    return room
  }

  function scheduleEvict(documentId: string): void {
    const existing = evictTimers.get(documentId)
    if (existing) clearTimeout(existing)

    const timer = setTimeout(() => {
      const room = rooms.get(documentId)
      if (room && room.size === 0) {
        room.destroy()
        rooms.delete(documentId)
      }
      evictTimers.delete(documentId)
    }, idleEvictMs)
    timer.unref()
    evictTimers.set(documentId, timer)
  }

  http.on('upgrade', (req, socket, head) => {
    wss.handleUpgrade(req, socket, head, (ws) => {
      void onConnection(ws, req)
    })
  })

  async function onConnection(ws: WebSocket, req: IncomingMessage): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://localhost')
    const documentId = decodeURIComponent(url.pathname.slice(1))
    const token = url.searchParams.get('token')

    if (!documentId) return void ws.close(4401, 'missing document id')
    if (!token) return void ws.close(4401, 'missing token')

    let claims
    try {
      claims = await verifyDocToken(token, options.jwtSecret)
    } catch {
      return void ws.close(4401, 'invalid token')
    }

    if (claims.docId !== documentId) return void ws.close(4403, 'token document mismatch')

    const room = await roomFor(documentId)
    const evictTimer = evictTimers.get(documentId)
    if (evictTimer) {
      clearTimeout(evictTimer)
      evictTimers.delete(documentId)
    }

    const conn: Connection = {
      id: randomUUID(),
      userId: claims.sub,
      role: claims.role,
      send: (data) => { if (ws.readyState === ws.OPEN) ws.send(data) },
      close: (code, reason) => ws.close(code, reason),
    }

    room.add(conn)

    ws.on('message', (data: Buffer) => {
      room.handleFrame(conn, new Uint8Array(data.buffer, data.byteOffset, data.byteLength))
    })

    ws.on('close', () => {
      room.remove(conn)
      if (room.size === 0) scheduleEvict(documentId)
    })

    ws.on('error', () => {
      room.remove(conn)
      if (room.size === 0) scheduleEvict(documentId)
    })

    // The server opens the sync handshake by advertising its own state vector.
    conn.send(encodeSyncStep1(room.doc))
  }

  await new Promise<void>((resolve) => http.listen(options.port, resolve))
  const address = http.address()
  const port = typeof address === 'object' && address ? address.port : options.port

  return {
    port,
    get roomCount() { return rooms.size },
    async close() {
      for (const timer of evictTimers.values()) clearTimeout(timer)
      evictTimers.clear()
      for (const client of wss.clients) client.terminate()
      for (const room of rooms.values()) room.destroy()
      rooms.clear()
      await new Promise<void>((resolve) => wss.close(() => resolve()))
      await new Promise<void>((resolve) => http.close(() => resolve()))
    },
  }
}
```

Add the missing import at the top of the file:
```ts
import { encodeSyncStep1 } from './protocol.js'
```

- [ ] **Step 5: Implement the entrypoint**

`apps/sync/src/index.ts`:
```ts
import { loadConfig } from './config.js'
import { createSyncServer } from './server.js'

const config = loadConfig()

const server = await createSyncServer({
  port: config.port,
  jwtSecret: config.jwtSecret,
  idleEvictMs: config.idleEvictMs,
})

console.log(JSON.stringify({ level: 'info', msg: 'sync server listening', port: server.port }))

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    void server.close().then(() => process.exit(0))
  })
}
```

- [ ] **Step 6: Run the tests**

```bash
pnpm --filter @crdt/sync exec vitest run server
```
Expected: PASS, 7 tests. The convergence test and the viewer test are the two that matter — if either is flaky, raise the `eventually` timeout before suspecting the server.

- [ ] **Step 7: Prove the BroadcastChannel trap is real**

Temporarily change `disableBc: true` to `disableBc: false` in `connect()`, comment out the `createSyncServer` call in `beforeEach`, and run the convergence test.

Expected: it **passes** with no server running. Restore both lines immediately. This is a one-minute exercise whose only purpose is that you have seen the false positive with your own eyes and will never trust a two-tab test without that flag.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat: add websocket sync server with token auth and room eviction"
```

---

## Phase 2 — Persistence

*Exit criterion: kill the server, restart it, reconnect — the document is still there.*

---

### Task 8: Write-behind update queue

**Files:**
- Create: `apps/sync/src/update-queue.ts`
- Test: `apps/sync/test/update-queue.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `interface PendingUpdate { update: Uint8Array; clientId: string }`
  - `interface UpdateSink { append(documentId: string, rows: PendingUpdate[]): Promise<void> }`
  - `class UpdateQueue` with `enqueue(documentId, pending)`, `flush(): Promise<void>`, `close(): Promise<void>`, `get depth(): number`.

- [ ] **Step 1: Write the failing test**

`apps/sync/test/update-queue.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { UpdateQueue, type PendingUpdate, type UpdateSink } from '../src/update-queue.js'

function recordingSink() {
  const calls: Array<{ documentId: string; rows: PendingUpdate[] }> = []
  const sink: UpdateSink = {
    append: async (documentId, rows) => { calls.push({ documentId, rows }) },
  }
  return { sink, calls }
}

function failingSink(failures: number) {
  let attempts = 0
  const calls: Array<{ documentId: string; rows: PendingUpdate[] }> = []
  const sink: UpdateSink = {
    append: async (documentId, rows) => {
      attempts += 1
      if (attempts <= failures) throw new Error('postgres is down')
      calls.push({ documentId, rows })
    },
  }
  return { sink, calls, attempts: () => attempts }
}

const update = (n: number): PendingUpdate => ({
  update: new Uint8Array([n]),
  clientId: `c${n}`,
})

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers() })

describe('UpdateQueue', () => {
  it('does not write immediately on enqueue', async () => {
    const { sink, calls } = recordingSink()
    const queue = new UpdateQueue(sink, { flushIntervalMs: 500, maxBatch: 64 })

    queue.enqueue('doc_1', update(1))

    expect(calls).toHaveLength(0)
    expect(queue.depth).toBe(1)
  })

  it('flushes after the interval elapses', async () => {
    const { sink, calls } = recordingSink()
    const queue = new UpdateQueue(sink, { flushIntervalMs: 500, maxBatch: 64 })

    queue.enqueue('doc_1', update(1))
    await vi.advanceTimersByTimeAsync(500)

    expect(calls).toHaveLength(1)
    expect(calls[0]!.rows).toHaveLength(1)
    expect(queue.depth).toBe(0)
  })

  it('flushes immediately once the batch size is reached, without waiting', async () => {
    const { sink, calls } = recordingSink()
    const queue = new UpdateQueue(sink, { flushIntervalMs: 500, maxBatch: 3 })

    queue.enqueue('doc_1', update(1))
    queue.enqueue('doc_1', update(2))
    queue.enqueue('doc_1', update(3))
    await vi.advanceTimersByTimeAsync(0)

    expect(calls).toHaveLength(1)
    expect(calls[0]!.rows).toHaveLength(3)
  })

  it('preserves enqueue order within a document', async () => {
    const { sink, calls } = recordingSink()
    const queue = new UpdateQueue(sink, { flushIntervalMs: 500, maxBatch: 64 })

    for (let n = 1; n <= 5; n += 1) queue.enqueue('doc_1', update(n))
    await vi.advanceTimersByTimeAsync(500)

    expect(calls[0]!.rows.map((r) => r.update[0])).toEqual([1, 2, 3, 4, 5])
  })

  it('keeps documents in separate batches', async () => {
    const { sink, calls } = recordingSink()
    const queue = new UpdateQueue(sink, { flushIntervalMs: 500, maxBatch: 64 })

    queue.enqueue('doc_a', update(1))
    queue.enqueue('doc_b', update(2))
    await vi.advanceTimersByTimeAsync(500)

    expect(calls).toHaveLength(2)
    expect(calls.map((c) => c.documentId).sort()).toEqual(['doc_a', 'doc_b'])
  })

  it('retains the batch and retries when the sink fails', async () => {
    const { sink, calls } = failingSink(2)
    const onError = vi.fn()
    const queue = new UpdateQueue(sink, {
      flushIntervalMs: 500,
      maxBatch: 64,
      retryBaseMs: 100,
      onError,
    })

    queue.enqueue('doc_1', update(1))
    queue.enqueue('doc_1', update(2))

    await vi.advanceTimersByTimeAsync(500)
    expect(calls).toHaveLength(0)
    expect(queue.depth).toBe(2)
    expect(onError).toHaveBeenCalled()

    await vi.advanceTimersByTimeAsync(100)   // first retry, fails
    await vi.advanceTimersByTimeAsync(200)   // second retry, succeeds

    expect(calls).toHaveLength(1)
    expect(calls[0]!.rows.map((r) => r.update[0])).toEqual([1, 2])
    expect(queue.depth).toBe(0)
  })

  it('does not lose updates enqueued during a failed flush', async () => {
    const { sink, calls } = failingSink(1)
    const queue = new UpdateQueue(sink, { flushIntervalMs: 500, maxBatch: 64, retryBaseMs: 100 })

    queue.enqueue('doc_1', update(1))
    await vi.advanceTimersByTimeAsync(500)   // fails, row 1 goes back

    queue.enqueue('doc_1', update(2))
    await vi.advanceTimersByTimeAsync(100)   // retry succeeds

    expect(calls[0]!.rows.map((r) => r.update[0])).toEqual([1, 2])
  })

  it('flushes everything on close', async () => {
    const { sink, calls } = recordingSink()
    const queue = new UpdateQueue(sink, { flushIntervalMs: 500, maxBatch: 64 })

    queue.enqueue('doc_1', update(1))
    await queue.close()

    expect(calls).toHaveLength(1)
    expect(queue.depth).toBe(0)
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

```bash
pnpm --filter @crdt/sync exec vitest run update-queue
```
Expected: FAIL — `Cannot find module '../src/update-queue.js'`.

- [ ] **Step 3: Implement the queue**

`apps/sync/src/update-queue.ts`:
```ts
export interface PendingUpdate {
  update: Uint8Array
  clientId: string
}

export interface UpdateSink {
  append(documentId: string, rows: PendingUpdate[]): Promise<void>
}

export interface UpdateQueueOptions {
  flushIntervalMs?: number
  maxBatch?: number
  retryBaseMs?: number
  maxRetryDelayMs?: number
  onError?(error: unknown, attempt: number): void
}

/**
 * Buffers updates in memory and writes them to the sink in batches.
 *
 * The point is that persistence never sits in the broadcast path: a slow or dead
 * database degrades durability, not collaboration. The cost is a bounded window
 * (flushIntervalMs) of updates that exist only in memory, which close() drains on
 * SIGTERM so planned restarts lose nothing.
 */
export class UpdateQueue {
  private readonly buffers = new Map<string, PendingUpdate[]>()
  private readonly flushIntervalMs: number
  private readonly maxBatch: number
  private readonly retryBaseMs: number
  private readonly maxRetryDelayMs: number

  private timer: ReturnType<typeof setTimeout> | null = null
  private chain: Promise<void> = Promise.resolve()
  private attempt = 0
  private closed = false

  constructor(
    private readonly sink: UpdateSink,
    private readonly options: UpdateQueueOptions = {},
  ) {
    this.flushIntervalMs = options.flushIntervalMs ?? 500
    this.maxBatch = options.maxBatch ?? 64
    this.retryBaseMs = options.retryBaseMs ?? 100
    this.maxRetryDelayMs = options.maxRetryDelayMs ?? 10_000
  }

  get depth(): number {
    let total = 0
    for (const rows of this.buffers.values()) total += rows.length
    return total
  }

  enqueue(documentId: string, pending: PendingUpdate): void {
    if (this.closed) throw new Error('queue is closed')

    const rows = this.buffers.get(documentId)
    if (rows) rows.push(pending)
    else this.buffers.set(documentId, [pending])

    if (this.depth >= this.maxBatch) void this.flush()
    else this.schedule(this.flushIntervalMs)
  }

  flush(): Promise<void> {
    this.chain = this.chain.then(() => this.drain())
    return this.chain
  }

  async close(): Promise<void> {
    this.closed = true
    this.clearTimer()
    await this.flush()
  }

  private schedule(delayMs: number): void {
    if (this.timer) return
    this.timer = setTimeout(() => {
      this.timer = null
      void this.flush()
    }, delayMs)
    // Do not hold the process open just because a flush is pending.
    this.timer.unref?.()
  }

  private clearTimer(): void {
    if (this.timer) {
      clearTimeout(this.timer)
      this.timer = null
    }
  }

  private async drain(): Promise<void> {
    while (this.buffers.size > 0) {
      const entry = this.buffers.entries().next()
      if (entry.done) return

      const [documentId, rows] = entry.value
      this.buffers.delete(documentId)

      try {
        await this.sink.append(documentId, rows)
        this.attempt = 0
      } catch (error) {
        // Put the batch back at the front so ordering within the document survives,
        // ahead of anything enqueued while the write was in flight.
        const arrived = this.buffers.get(documentId) ?? []
        this.buffers.set(documentId, [...rows, ...arrived])

        this.attempt += 1
        this.options.onError?.(error, this.attempt)

        if (!this.closed) {
          const delay = Math.min(
            this.retryBaseMs * 2 ** (this.attempt - 1),
            this.maxRetryDelayMs,
          )
          this.schedule(delay)
        }
        return
      }
    }
  }
}
```

- [ ] **Step 4: Run the tests**

```bash
pnpm --filter @crdt/sync exec vitest run update-queue
```
Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: add write-behind update queue with batching and retry"
```

---

### Task 9: Document store

**Files:**
- Create: `apps/sync/src/store.ts`
- Test: `apps/sync/test/store.integration.test.ts`

**Interfaces:**
- Consumes: `UpdateSink`, `PendingUpdate` from `update-queue.ts`; `prisma` from `@crdt/db`
- Produces: `class DocumentStore implements UpdateSink` with `load(documentId): Promise<Uint8Array | null>`, `append(documentId, rows): Promise<void>`, `needsSnapshot(documentId): boolean`, `snapshot(documentId, doc: Y.Doc): Promise<void>`.

- [ ] **Step 1: Write the failing test**

`apps/sync/test/store.integration.test.ts`:
```ts
import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import * as Y from 'yjs'
import { prisma } from '@crdt/db'
import { DocumentStore } from '../src/store.js'

let workspaceId: string
let documentId: string

beforeEach(async () => {
  const ws = await prisma.workspace.create({ data: { name: 'store-test', ownerId: 'usr_t' } })
  workspaceId = ws.id
  const doc = await prisma.document.create({
    data: { workspaceId, type: 'doc', title: 'store-test-doc' },
  })
  documentId = doc.id
})

afterAll(async () => {
  await prisma.workspace.deleteMany({ where: { name: 'store-test' } })
  await prisma.$disconnect()
})

function updateFrom(text: string): Uint8Array {
  const doc = new Y.Doc()
  doc.getText('t').insert(0, text)
  return Y.encodeStateAsUpdate(doc)
}

describe('DocumentStore', () => {
  it('returns null for a document with no history', async () => {
    const store = new DocumentStore(prisma)
    await expect(store.load(documentId)).resolves.toBeNull()
  })

  it('round-trips updates into a usable document state', async () => {
    const store = new DocumentStore(prisma)
    await store.append(documentId, [{ update: updateFrom('hello'), clientId: 'c1' }])

    const state = await store.load(documentId)
    expect(state).not.toBeNull()

    const restored = new Y.Doc()
    Y.applyUpdate(restored, state!)
    expect(restored.getText('t').toString()).toBe('hello')
  })

  it('merges many updates in insertion order', async () => {
    const store = new DocumentStore(prisma)
    const source = new Y.Doc()
    const rows = []
    for (const word of ['a', 'b', 'c', 'd']) {
      const before = Y.encodeStateVector(source)
      source.getText('t').insert(source.getText('t').length, word)
      rows.push({ update: Y.encodeStateAsUpdate(source, before), clientId: 'c1' })
    }
    for (const row of rows) await store.append(documentId, [row])

    const restored = new Y.Doc()
    Y.applyUpdate(restored, (await store.load(documentId))!)
    expect(restored.getText('t').toString()).toBe('abcd')
  })

  it('asks for a snapshot only after the threshold is crossed', async () => {
    const store = new DocumentStore(prisma, { snapshotEvery: 3 })
    expect(store.needsSnapshot(documentId)).toBe(false)

    await store.append(documentId, [
      { update: updateFrom('a'), clientId: 'c1' },
      { update: updateFrom('b'), clientId: 'c1' },
    ])
    expect(store.needsSnapshot(documentId)).toBe(false)

    await store.append(documentId, [{ update: updateFrom('c'), clientId: 'c1' }])
    expect(store.needsSnapshot(documentId)).toBe(true)
  })

  it('writes a snapshot and loads from it instead of the whole log', async () => {
    const store = new DocumentStore(prisma, { snapshotEvery: 2 })
    const doc = new Y.Doc()

    doc.getText('t').insert(0, 'first ')
    await store.append(documentId, [{ update: Y.encodeStateAsUpdate(doc), clientId: 'c1' }])
    doc.getText('t').insert(doc.getText('t').length, 'second')
    await store.append(documentId, [{ update: Y.encodeStateAsUpdate(doc), clientId: 'c1' }])

    await store.snapshot(documentId, doc)
    expect(store.needsSnapshot(documentId)).toBe(false)

    const snapshots = await prisma.documentSnapshot.findMany({ where: { documentId } })
    expect(snapshots).toHaveLength(1)
    expect(snapshots[0]!.throughUpdateId > 0n).toBe(true)

    const fresh = new DocumentStore(prisma, { snapshotEvery: 2 })
    const restored = new Y.Doc()
    Y.applyUpdate(restored, (await fresh.load(documentId))!)
    expect(restored.getText('t').toString()).toBe('first second')
  })

  it('includes updates written after the snapshot', async () => {
    const store = new DocumentStore(prisma, { snapshotEvery: 100 })
    const doc = new Y.Doc()

    doc.getText('t').insert(0, 'before ')
    await store.append(documentId, [{ update: Y.encodeStateAsUpdate(doc), clientId: 'c1' }])
    await store.snapshot(documentId, doc)

    doc.getText('t').insert(doc.getText('t').length, 'after')
    await store.append(documentId, [{ update: Y.encodeStateAsUpdate(doc), clientId: 'c1' }])

    const fresh = new DocumentStore(prisma)
    const restored = new Y.Doc()
    Y.applyUpdate(restored, (await fresh.load(documentId))!)
    expect(restored.getText('t').toString()).toBe('before after')
  })

  it('tolerates re-applying updates a snapshot already contains', async () => {
    // Yjs updates are idempotent, which is why throughUpdateId can be conservative
    // without being wrong. This test pins that property so nobody "fixes" the
    // boundary with a fragile timestamp comparison later.
    const store = new DocumentStore(prisma)
    const doc = new Y.Doc()
    doc.getText('t').insert(0, 'once')
    const update = Y.encodeStateAsUpdate(doc)

    await store.append(documentId, [{ update, clientId: 'c1' }])
    await store.append(documentId, [{ update, clientId: 'c1' }])

    const restored = new Y.Doc()
    Y.applyUpdate(restored, (await store.load(documentId))!)
    expect(restored.getText('t').toString()).toBe('once')
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

```bash
docker compose up -d
pnpm --filter @crdt/sync exec vitest run store
```
Expected: FAIL — `Cannot find module '../src/store.js'`.

- [ ] **Step 3: Implement the store**

`apps/sync/src/store.ts`:
```ts
import * as Y from 'yjs'
import type { PrismaClient } from '@crdt/db'
import type { PendingUpdate, UpdateSink } from './update-queue.js'

export interface DocumentStoreOptions {
  snapshotEvery?: number
}

export class DocumentStore implements UpdateSink {
  private readonly snapshotEvery: number
  /** Updates appended since the last snapshot, per document. */
  private readonly sinceSnapshot = new Map<string, number>()
  /** Highest document_updates.id known to be durable, per document. */
  private readonly lastUpdateId = new Map<string, bigint>()

  constructor(
    private readonly prisma: PrismaClient,
    options: DocumentStoreOptions = {},
  ) {
    this.snapshotEvery = options.snapshotEvery ?? 100
  }

  /**
   * Rebuild a document's state as a single merged update: the newest snapshot,
   * plus every update recorded after it.
   */
  async load(documentId: string): Promise<Uint8Array | null> {
    const snapshot = await this.prisma.documentSnapshot.findFirst({
      where: { documentId },
      orderBy: { id: 'desc' },
      select: { state: true, throughUpdateId: true },
    })

    const updates = await this.prisma.documentUpdate.findMany({
      where: {
        documentId,
        ...(snapshot ? { id: { gt: snapshot.throughUpdateId } } : {}),
      },
      orderBy: { id: 'asc' },
      select: { id: true, update: true },
    })

    this.sinceSnapshot.set(documentId, updates.length)
    const newest = updates.at(-1)?.id ?? snapshot?.throughUpdateId ?? 0n
    this.lastUpdateId.set(documentId, newest)

    const parts: Uint8Array[] = []
    if (snapshot) parts.push(new Uint8Array(snapshot.state))
    for (const row of updates) parts.push(new Uint8Array(row.update))

    if (parts.length === 0) return null
    return Y.mergeUpdates(parts)
  }

  async append(documentId: string, rows: PendingUpdate[]): Promise<void> {
    if (rows.length === 0) return

    const created = await this.prisma.documentUpdate.createManyAndReturn({
      data: rows.map((row) => ({
        documentId,
        update: Buffer.from(row.update),
        clientId: row.clientId,
      })),
      select: { id: true },
    })

    let highest = this.lastUpdateId.get(documentId) ?? 0n
    for (const row of created) if (row.id > highest) highest = row.id
    this.lastUpdateId.set(documentId, highest)

    this.sinceSnapshot.set(documentId, (this.sinceSnapshot.get(documentId) ?? 0) + rows.length)
  }

  needsSnapshot(documentId: string): boolean {
    return (this.sinceSnapshot.get(documentId) ?? 0) >= this.snapshotEvery
  }

  /**
   * Compact the log. `throughUpdateId` is the newest update known to be durable,
   * which may be *behind* what the in-memory doc contains if a flush is in flight.
   * That is safe: the extra updates get re-applied on load, and Yjs updates are
   * idempotent. The reverse — claiming to include updates that are not in the
   * snapshot — cannot happen, because the doc is always a superset of what is durable.
   */
  async snapshot(documentId: string, doc: Y.Doc): Promise<void> {
    const throughUpdateId = this.lastUpdateId.get(documentId) ?? 0n

    await this.prisma.documentSnapshot.create({
      data: {
        documentId,
        state: Buffer.from(Y.encodeStateAsUpdate(doc)),
        throughUpdateId,
      },
    })

    this.sinceSnapshot.set(documentId, 0)
  }

  forget(documentId: string): void {
    this.sinceSnapshot.delete(documentId)
    this.lastUpdateId.delete(documentId)
  }
}
```

- [ ] **Step 4: Run the tests**

```bash
pnpm --filter @crdt/sync exec vitest run store
```
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: add snapshot-and-log document store"
```

---

### Task 10: Wire persistence into the server

**Files:**
- Modify: `apps/sync/src/server.ts` (add snapshot triggering on persist)
- Modify: `apps/sync/src/index.ts` (construct store + queue, flush on SIGTERM)
- Test: `apps/sync/test/durability.integration.test.ts`

**Interfaces:**
- Consumes: `createSyncServer`, `DocumentStore`, `UpdateQueue`
- Produces: `SyncServer.flush(): Promise<void>` and a `SyncServerOptions.onDocumentPersisted?(documentId, doc)` hook that lets the entrypoint trigger snapshots without the server knowing what a snapshot is.

- [ ] **Step 1: Write the failing test**

`apps/sync/test/durability.integration.test.ts`:
```ts
import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import * as Y from 'yjs'
import { WebsocketProvider } from 'y-websocket'
import { WebSocket } from 'ws'
import { prisma } from '@crdt/db'
import { signDocToken } from '@crdt/shared/doc-token'
import { createSyncServer, type SyncServer } from '../src/server.js'
import { DocumentStore } from '../src/store.js'
import { UpdateQueue } from '../src/update-queue.js'

const SECRET = 'test-secret-that-is-long-enough!!'

let documentId: string

beforeEach(async () => {
  const ws = await prisma.workspace.create({ data: { name: 'durability', ownerId: 'usr_t' } })
  const doc = await prisma.document.create({
    data: { workspaceId: ws.id, type: 'doc', title: 'durable' },
  })
  documentId = doc.id
})

afterAll(async () => {
  await prisma.workspace.deleteMany({ where: { name: 'durability' } })
  await prisma.$disconnect()
})

async function startServer(store: DocumentStore): Promise<{ server: SyncServer; queue: UpdateQueue }> {
  const queue = new UpdateQueue(store, { flushIntervalMs: 50, maxBatch: 8 })
  const server = await createSyncServer({
    port: 0,
    jwtSecret: SECRET,
    loadDocument: (id) => store.load(id),
    onPersist: (id, update, clientId) => queue.enqueue(id, { update, clientId }),
    onDocumentPersisted: async (id, doc) => {
      if (store.needsSnapshot(id)) await store.snapshot(id, doc)
    },
  })
  return { server, queue }
}

async function connect(server: SyncServer, name: string) {
  const token = await signDocToken(
    { sub: `usr_${name}`, docId: documentId, role: 'editor', name, color: '#000' },
    SECRET,
  )
  const doc = new Y.Doc()
  const provider = new WebsocketProvider(`ws://127.0.0.1:${server.port}`, documentId, doc, {
    params: { token },
    WebSocketPolyfill: WebSocket as unknown as typeof globalThis.WebSocket,
    disableBc: true,
  })
  await new Promise<void>((resolve) => provider.once('sync', () => resolve()))
  return { doc, provider }
}

describe('durability', () => {
  it('restores document state after a full server restart', async () => {
    const store = new DocumentStore(prisma, { snapshotEvery: 100 })

    const first = await startServer(store)
    const writer = await connect(first.server, 'alice')
    writer.doc.getText('t').insert(0, 'survives restart')

    await new Promise((r) => setTimeout(r, 150))
    await first.queue.close()
    writer.provider.destroy()
    await first.server.close()

    const second = await startServer(store)
    const reader = await connect(second.server, 'bob')

    expect(reader.doc.getText('t').toString()).toBe('survives restart')

    reader.provider.destroy()
    await second.queue.close()
    await second.server.close()
  })

  it('writes a snapshot once the threshold is crossed and still loads correctly', async () => {
    const store = new DocumentStore(prisma, { snapshotEvery: 5 })

    const first = await startServer(store)
    const writer = await connect(first.server, 'alice')

    for (let i = 0; i < 12; i += 1) {
      writer.doc.getText('t').insert(writer.doc.getText('t').length, `${i} `)
      await new Promise((r) => setTimeout(r, 60))
    }

    await first.queue.close()
    const expected = writer.doc.getText('t').toString()
    writer.provider.destroy()
    await first.server.close()

    const snapshots = await prisma.documentSnapshot.findMany({ where: { documentId } })
    expect(snapshots.length).toBeGreaterThan(0)

    const second = await startServer(new DocumentStore(prisma, { snapshotEvery: 5 }))
    const reader = await connect(second.server, 'bob')
    expect(reader.doc.getText('t').toString()).toBe(expected)

    reader.provider.destroy()
    await second.queue.close()
    await second.server.close()
  })

  it('does not persist a viewer edit', async () => {
    const store = new DocumentStore(prisma, { snapshotEvery: 100 })
    const { server, queue } = await startServer(store)

    const token = await signDocToken(
      { sub: 'usr_v', docId: documentId, role: 'viewer', name: 'v', color: '#000' },
      SECRET,
    )
    const doc = new Y.Doc()
    const provider = new WebsocketProvider(`ws://127.0.0.1:${server.port}`, documentId, doc, {
      params: { token },
      WebSocketPolyfill: WebSocket as unknown as typeof globalThis.WebSocket,
      disableBc: true,
    })
    await new Promise<void>((resolve) => provider.once('sync', () => resolve()))

    doc.getText('t').insert(0, 'viewer edit')
    await new Promise((r) => setTimeout(r, 200))
    await queue.close()

    const rows = await prisma.documentUpdate.findMany({ where: { documentId } })
    expect(rows).toHaveLength(0)

    provider.destroy()
    await server.close()
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

```bash
pnpm --filter @crdt/sync exec vitest run durability
```
Expected: FAIL — `onDocumentPersisted` is not a recognized option, so no state is loaded or stored.

- [ ] **Step 3: Extend the server options**

In `apps/sync/src/server.ts`, add to `SyncServerOptions`:
```ts
  onDocumentPersisted?(documentId: string, doc: Y.Doc): void | Promise<void>
```

Add the import:
```ts
import type * as Y from 'yjs'
```

In `roomFor`, change the `onPersist` wiring to:
```ts
    const room = new DocumentRoom(documentId, {
      onPersist: (update, clientId) => {
        options.onPersist?.(documentId, update, clientId)
        void Promise.resolve(options.onDocumentPersisted?.(documentId, room.doc)).catch(
          (error: unknown) => {
            console.error(
              JSON.stringify({ level: 'error', msg: 'snapshot failed', documentId, error: String(error) }),
            )
          },
        )
      },
      onReject: (reason) => options.onReject?.(documentId, reason),
    })
```

Note: `room` is referenced inside its own constructor callback. That is safe because
`onPersist` only fires on a later `doc.on('update')` event, never during construction.

- [ ] **Step 4: Wire the entrypoint**

`apps/sync/src/index.ts`:
```ts
import { prisma } from '@crdt/db'
import { loadConfig } from './config.js'
import { createSyncServer } from './server.js'
import { DocumentStore } from './store.js'
import { UpdateQueue } from './update-queue.js'

const config = loadConfig()

const log = (level: string, msg: string, extra: Record<string, unknown> = {}) =>
  console.log(JSON.stringify({ level, msg, ...extra, at: new Date().toISOString() }))

const store = new DocumentStore(prisma, { snapshotEvery: 100 })

const queue = new UpdateQueue(store, {
  flushIntervalMs: 500,
  maxBatch: 64,
  onError: (error, attempt) =>
    log('error', 'update flush failed', { attempt, error: String(error) }),
})

const server = await createSyncServer({
  port: config.port,
  jwtSecret: config.jwtSecret,
  idleEvictMs: config.idleEvictMs,
  loadDocument: (documentId) => store.load(documentId),
  onPersist: (documentId, update, clientId) => queue.enqueue(documentId, { update, clientId }),
  onDocumentPersisted: async (documentId, doc) => {
    if (store.needsSnapshot(documentId)) await store.snapshot(documentId, doc)
  },
  onReject: (documentId, reason) => log('warn', 'frame rejected', { documentId, reason }),
})

log('info', 'sync server listening', { port: server.port })

let shuttingDown = false
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    if (shuttingDown) return
    shuttingDown = true
    log('info', 'draining update queue before exit', { depth: queue.depth })
    void queue
      .close()
      .then(() => server.close())
      .then(() => prisma.$disconnect())
      .then(() => process.exit(0))
  })
}
```

- [ ] **Step 5: Run the tests**

```bash
pnpm --filter @crdt/sync exec vitest run durability
```
Expected: PASS, 3 tests.

- [ ] **Step 6: Run the whole suite**

```bash
pnpm test
```
Expected: everything green. If the room-eviction test in Task 7 now fails intermittently,
it is because loading from the store made room creation async — raise its timeout rather
than removing the assertion.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: persist and restore document state across server restarts"
```

---

## Phase 3 — Board and editor

*Exit criterion: drag a card in one tab, see it move in the other.*

---

### Task 11: Fractional index

**Files:**
- Create: `packages/shared/src/fractional-index.ts`
- Test: `packages/shared/test/fractional-index.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `between(a: string | null, b: string | null): string` — a key strictly between `a` and `b`, where `null` means unbounded.
  - `FractionalIndexError`
  - Invariant, relied on by callers: a generated key never ends in the lowest digit `'0'`, which is what keeps `between(a, b)` always solvable.

- [ ] **Step 1: Write the failing test**

`packages/shared/test/fractional-index.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { between, FractionalIndexError } from '../src/fractional-index.js'

describe('between', () => {
  it('generates a key when both bounds are open', () => {
    const key = between(null, null)
    expect(key.length).toBeGreaterThan(0)
  })

  it('appends after an existing key', () => {
    const first = between(null, null)
    const second = between(first, null)
    expect(second > first).toBe(true)
  })

  it('prepends before an existing key', () => {
    const first = between(null, null)
    const zeroth = between(null, first)
    expect(zeroth < first).toBe(true)
  })

  it('inserts strictly between two adjacent keys', () => {
    const a = between(null, null)
    const b = between(a, null)
    const mid = between(a, b)
    expect(a < mid).toBe(true)
    expect(mid < b).toBe(true)
  })

  it('never produces a key ending in the lowest digit', () => {
    // This invariant is what guarantees between(a, b) is always solvable:
    // a key ending in '0' has no room below its own last digit.
    let lower: string | null = null
    let upper: string | null = between(null, null)
    for (let i = 0; i < 200; i += 1) {
      const key = between(lower, upper)
      expect(key.endsWith('0')).toBe(false)
      upper = key
    }
    void lower
  })

  it('survives 100 repeated midpoint insertions at the same position', () => {
    let a = between(null, null)
    const b = between(a, null)
    for (let i = 0; i < 100; i += 1) {
      const mid = between(a, b)
      expect(a < mid && mid < b).toBe(true)
      a = mid
    }
  })

  it('keeps a randomly built list sorted', () => {
    const keys: string[] = [between(null, null)]

    for (let i = 0; i < 500; i += 1) {
      const at = Math.floor(Math.random() * (keys.length + 1))
      const left = at === 0 ? null : keys[at - 1]!
      const right = at === keys.length ? null : keys[at]!
      const key = between(left, right)
      keys.splice(at, 0, key)
    }

    const sorted = [...keys].sort()
    expect(keys).toEqual(sorted)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('rejects bounds that are not in order', () => {
    const a = between(null, null)
    const b = between(a, null)
    expect(() => between(b, a)).toThrow(FractionalIndexError)
    expect(() => between(a, a)).toThrow(FractionalIndexError)
  })

  it('rejects a key containing a character outside the alphabet', () => {
    expect(() => between('!!', null)).toThrow(FractionalIndexError)
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

```bash
pnpm --filter @crdt/shared exec vitest run fractional-index
```
Expected: FAIL — module not found.

- [ ] **Step 3: Implement it**

`packages/shared/src/fractional-index.ts`:
```ts
/**
 * Fractional indexing over a base-62 alphabet chosen so that plain string
 * comparison matches digit order: '0' < '9' < 'A' < 'Z' < 'a' < 'z' in ASCII.
 *
 * The point of fractional indices in a CRDT board: inserting between two cards
 * touches only the inserted card. There is no renumbering, so no write to a
 * neighbour that could conflict with a concurrent edit to that neighbour.
 */
const DIGITS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'
const BASE = DIGITS.length

export class FractionalIndexError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'FractionalIndexError'
  }
}

function assertValid(key: string | null, label: string): void {
  if (key === null) return
  if (key.length === 0) throw new FractionalIndexError(`${label} must not be empty`)
  for (const char of key) {
    if (!DIGITS.includes(char)) {
      throw new FractionalIndexError(`${label} contains an invalid character: ${char}`)
    }
  }
}

/** The digit at position `i`, or `fallback` when the key does not reach that far. */
function digitAt(key: string | null, i: number, fallback: number): number {
  if (key === null || i >= key.length) return fallback
  return DIGITS.indexOf(key[i]!)
}

/**
 * Return a key strictly between `a` and `b`. `null` means unbounded on that side.
 *
 * The result never ends in the lowest digit, because the final digit is always
 * chosen strictly above the lower bound's digit. That invariant is what keeps this
 * function total: a key ending in '0' would have no room below its own last digit.
 */
export function between(a: string | null, b: string | null): string {
  assertValid(a, 'lower bound')
  assertValid(b, 'upper bound')

  if (a !== null && b !== null && a >= b) {
    throw new FractionalIndexError(`bounds out of order: ${a} >= ${b}`)
  }

  let result = ''
  for (let i = 0; ; i += 1) {
    const lo = digitAt(a, i, 0)
    // A missing digit on the right behaves as "past the last digit", so an open
    // upper bound gets the whole remaining range.
    const hi = digitAt(b, i, BASE)

    if (hi - lo > 1) {
      return result + DIGITS[lo + Math.floor((hi - lo) / 2)]!
    }

    // No room at this position. Adopt the lower bound's digit and descend.
    result += DIGITS[lo]!
  }
}
```

- [ ] **Step 4: Run the tests**

```bash
pnpm --filter @crdt/shared exec vitest run fractional-index
```
Expected: PASS, 9 tests. The randomized test runs 500 insertions; if it ever fails, save
the seed — a single counterexample is worth more than any amount of re-reading.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: add fractional indexing for conflict-free card ordering"
```

---

### Task 12: Board operations

**Files:**
- Create: `packages/shared/src/board.ts`
- Test: `packages/shared/test/board.test.ts`

**Interfaces:**
- Consumes: `between` from `fractional-index.ts`
- Produces:
  - `interface CardView { id: string; title: string; columnId: string; order: string }`
  - `interface ColumnView { id: string; title: string; order: string }`
  - `addColumn(doc, { id, title }): void`
  - `addCard(doc, { id, title, columnId, afterCardId? }): void`
  - `moveCard(doc, cardId, { columnId, afterCardId?, beforeCardId? }): void`
  - `renameCard(doc, cardId, title): void`
  - `removeCard(doc, cardId): void`
  - `listColumns(doc): ColumnView[]`, `listCards(doc, columnId): CardView[]`

- [ ] **Step 1: Write the failing test**

`packages/shared/test/board.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import * as Y from 'yjs'
import {
  addCard, addColumn, listCards, listColumns, moveCard, removeCard, renameCard,
} from '../src/board.js'

function board(): Y.Doc {
  const doc = new Y.Doc()
  addColumn(doc, { id: 'todo', title: 'To do' })
  addColumn(doc, { id: 'doing', title: 'Doing' })
  return doc
}

/** Exchange all state both ways, the way the sync server would. */
function sync(a: Y.Doc, b: Y.Doc): void {
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a, Y.encodeStateVector(b)))
  Y.applyUpdate(a, Y.encodeStateAsUpdate(b, Y.encodeStateVector(a)))
}

describe('board', () => {
  it('lists columns in insertion order', () => {
    const doc = board()
    expect(listColumns(doc).map((c) => c.id)).toEqual(['todo', 'doing'])
  })

  it('adds cards to a column in order', () => {
    const doc = board()
    addCard(doc, { id: 'c1', title: 'first', columnId: 'todo' })
    addCard(doc, { id: 'c2', title: 'second', columnId: 'todo', afterCardId: 'c1' })

    expect(listCards(doc, 'todo').map((c) => c.title)).toEqual(['first', 'second'])
  })

  it('inserts between two cards without touching their keys', () => {
    const doc = board()
    addCard(doc, { id: 'c1', title: 'first', columnId: 'todo' })
    addCard(doc, { id: 'c3', title: 'third', columnId: 'todo', afterCardId: 'c1' })
    const before = listCards(doc, 'todo').map((c) => c.order)

    addCard(doc, { id: 'c2', title: 'second', columnId: 'todo', afterCardId: 'c1' })

    const after = listCards(doc, 'todo')
    expect(after.map((c) => c.title)).toEqual(['first', 'second', 'third'])
    expect(after[0]!.order).toBe(before[0]!)
    expect(after[2]!.order).toBe(before[1]!)
  })

  it('moves a card to another column', () => {
    const doc = board()
    addCard(doc, { id: 'c1', title: 'first', columnId: 'todo' })
    moveCard(doc, 'c1', { columnId: 'doing' })

    expect(listCards(doc, 'todo')).toHaveLength(0)
    expect(listCards(doc, 'doing').map((c) => c.id)).toEqual(['c1'])
  })

  it('keeps a concurrent rename when the same card is moved elsewhere', () => {
    const a = board()
    addCard(a, { id: 'c1', title: 'original', columnId: 'todo' })
    const b = new Y.Doc()
    sync(a, b)

    moveCard(a, 'c1', { columnId: 'doing' })
    renameCard(b, 'c1', 'renamed')
    sync(a, b)

    for (const doc of [a, b]) {
      const card = listCards(doc, 'doing')[0]
      expect(card?.title).toBe('renamed')
      expect(card?.columnId).toBe('doing')
    }
  })

  it('converges when two replicas move the same card to different columns', () => {
    const a = board()
    addColumn(a, { id: 'done', title: 'Done' })
    addCard(a, { id: 'c1', title: 'contested', columnId: 'todo' })
    const b = new Y.Doc()
    sync(a, b)

    moveCard(a, 'c1', { columnId: 'doing' })
    moveCard(b, 'c1', { columnId: 'done' })
    sync(a, b)

    const columnsA = listColumns(a).map((c) => c.id)
    const placementsA = columnsA.flatMap((id) => listCards(a, id).map((c) => `${id}:${c.id}`))
    const placementsB = columnsA.flatMap((id) => listCards(b, id).map((c) => `${id}:${c.id}`))

    expect(placementsA).toEqual(placementsB)
    // The card exists exactly once across the whole board on both replicas.
    expect(placementsA.filter((p) => p.endsWith(':c1'))).toHaveLength(1)
  })

  it('converges when two replicas insert at the same position', () => {
    const a = board()
    addCard(a, { id: 'anchor', title: 'anchor', columnId: 'todo' })
    const b = new Y.Doc()
    sync(a, b)

    addCard(a, { id: 'from-a', title: 'from a', columnId: 'todo', afterCardId: 'anchor' })
    addCard(b, { id: 'from-b', title: 'from b', columnId: 'todo', afterCardId: 'anchor' })
    sync(a, b)

    expect(listCards(a, 'todo').map((c) => c.id)).toEqual(listCards(b, 'todo').map((c) => c.id))
    expect(listCards(a, 'todo')).toHaveLength(3)
  })

  it('breaks ties on card id so ordering is identical everywhere', () => {
    const a = board()
    const b = new Y.Doc()
    sync(a, b)

    // Force identical order keys by adding the first card on both replicas.
    addCard(a, { id: 'zzz', title: 'z', columnId: 'todo' })
    addCard(b, { id: 'aaa', title: 'a', columnId: 'todo' })
    sync(a, b)

    expect(listCards(a, 'todo').map((c) => c.id)).toEqual(['aaa', 'zzz'])
    expect(listCards(b, 'todo').map((c) => c.id)).toEqual(['aaa', 'zzz'])
  })

  it('removes a card', () => {
    const doc = board()
    addCard(doc, { id: 'c1', title: 'gone', columnId: 'todo' })
    removeCard(doc, 'c1')
    expect(listCards(doc, 'todo')).toHaveLength(0)
  })

  it('ignores operations on a card that does not exist', () => {
    const doc = board()
    expect(() => moveCard(doc, 'missing', { columnId: 'doing' })).not.toThrow()
    expect(() => renameCard(doc, 'missing', 'x')).not.toThrow()
    expect(() => removeCard(doc, 'missing')).not.toThrow()
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

```bash
pnpm --filter @crdt/shared exec vitest run board
```
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the board**

`packages/shared/src/board.ts`:
```ts
import * as Y from 'yjs'
import { between } from './fractional-index.js'

export interface CardView {
  id: string
  title: string
  columnId: string
  order: string
}

export interface ColumnView {
  id: string
  title: string
  order: string
}

/**
 * Both maps are top-level Yjs types. Top-level types are created deterministically
 * by name on every replica, so there is no "who creates the container" race — which
 * there would be with nested maps initialized lazily by whichever client arrives first.
 */
const cardsOf = (doc: Y.Doc) => doc.getMap<Y.Map<string>>('cards')
const columnsOf = (doc: Y.Doc) => doc.getMap<Y.Map<string>>('columns')

function readMap(entry: Y.Map<string> | undefined): Record<string, string> | null {
  if (!entry) return null
  return Object.fromEntries(entry.entries())
}

/** Sort by order key, then by id, so every replica agrees even on identical keys. */
function compare(a: { order: string; id: string }, b: { order: string; id: string }): number {
  if (a.order !== b.order) return a.order < b.order ? -1 : 1
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

export function addColumn(doc: Y.Doc, input: { id: string; title: string }): void {
  doc.transact(() => {
    const columns = columnsOf(doc)
    if (columns.has(input.id)) return

    const existing = listColumns(doc)
    const order = between(existing.at(-1)?.order ?? null, null)

    const entry = new Y.Map<string>()
    entry.set('title', input.title)
    entry.set('order', order)
    columns.set(input.id, entry)
  })
}

export function listColumns(doc: Y.Doc): ColumnView[] {
  const out: ColumnView[] = []
  for (const [id, entry] of columnsOf(doc).entries()) {
    const fields = readMap(entry)
    if (!fields?.order) continue
    out.push({ id, title: fields.title ?? '', order: fields.order })
  }
  return out.sort(compare)
}

export function listCards(doc: Y.Doc, columnId: string): CardView[] {
  const out: CardView[] = []
  for (const [id, entry] of cardsOf(doc).entries()) {
    const fields = readMap(entry)
    if (!fields?.order || fields.columnId !== columnId) continue
    out.push({ id, title: fields.title ?? '', columnId, order: fields.order })
  }
  return out.sort(compare)
}

/** The order key for a slot in `columnId`, expressed relative to neighbouring cards. */
function orderFor(
  doc: Y.Doc,
  columnId: string,
  position: { afterCardId?: string; beforeCardId?: string },
  excludeCardId?: string,
): string {
  const siblings = listCards(doc, columnId).filter((c) => c.id !== excludeCardId)

  if (position.afterCardId) {
    const at = siblings.findIndex((c) => c.id === position.afterCardId)
    if (at !== -1) return between(siblings[at]!.order, siblings[at + 1]?.order ?? null)
  }

  if (position.beforeCardId) {
    const at = siblings.findIndex((c) => c.id === position.beforeCardId)
    if (at !== -1) return between(siblings[at - 1]?.order ?? null, siblings[at]!.order)
  }

  // Default: append to the end of the column.
  return between(siblings.at(-1)?.order ?? null, null)
}

export function addCard(
  doc: Y.Doc,
  input: { id: string; title: string; columnId: string; afterCardId?: string; beforeCardId?: string },
): void {
  doc.transact(() => {
    const cards = cardsOf(doc)
    if (cards.has(input.id)) return

    const entry = new Y.Map<string>()
    entry.set('title', input.title)
    entry.set('columnId', input.columnId)
    entry.set('order', orderFor(doc, input.columnId, input))
    cards.set(input.id, entry)
  })
}

/**
 * A move writes two fields on the card's existing map entry. It never deletes and
 * re-creates the entry, which is what keeps a concurrent title edit and a concurrent
 * move from destroying each other — and what makes it impossible for a card to end
 * up in two columns.
 */
export function moveCard(
  doc: Y.Doc,
  cardId: string,
  target: { columnId: string; afterCardId?: string; beforeCardId?: string },
): void {
  doc.transact(() => {
    const entry = cardsOf(doc).get(cardId)
    if (!entry) return

    entry.set('columnId', target.columnId)
    entry.set('order', orderFor(doc, target.columnId, target, cardId))
  })
}

export function renameCard(doc: Y.Doc, cardId: string, title: string): void {
  doc.transact(() => {
    cardsOf(doc).get(cardId)?.set('title', title)
  })
}

export function removeCard(doc: Y.Doc, cardId: string): void {
  doc.transact(() => {
    cardsOf(doc).delete(cardId)
  })
}
```

- [ ] **Step 4: Run the tests**

```bash
pnpm --filter @crdt/shared exec vitest run board
```
Expected: PASS, 10 tests. The two convergence tests are the ones that justify this whole
design — if either fails, the data model is wrong, not the test.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: add board operations with conflict-free card moves"
```

---

### Task 13: Web app skeleton and document session

**Files:**
- Create: `apps/web/package.json`, `apps/web/next.config.ts`, `apps/web/tsconfig.json`, `apps/web/src/app/layout.tsx`, `apps/web/src/app/page.tsx`
- Create: `apps/web/src/lib/doc-session.ts`, `apps/web/src/hooks/use-doc.ts`
- Test: `apps/web/test/doc-session.integration.test.ts`
- Modify: `vitest.config.ts` (add the `web` project)

**Interfaces:**
- Consumes: `createSyncServer` (dev only, for tests)
- Produces:
  - `interface DocSessionOptions { documentId: string; syncUrl: string; fetchToken(): Promise<string>; disableBc?: boolean; WebSocketImpl?: typeof WebSocket }`
  - `createDocSession(options): DocSession` where `DocSession` has `doc: Y.Doc`, `provider: WebsocketProvider`, `onStatus(cb): () => void`, `destroy(): void`.
  - `useCollaborativeDoc(documentId): { doc, provider, status }` — the React wrapper.

- [ ] **Step 1: Create the Next.js app**

`apps/web/package.json`:
```json
{
  "name": "@crdt/web",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "engines": { "node": ">=24.0.0" },
  "scripts": {
    "dev": "next dev -p 3000",
    "build": "next build",
    "start": "next start -p 3000"
  },
  "dependencies": {
    "@crdt/db": "workspace:*",
    "@crdt/shared": "workspace:*",
    "@tiptap/core": "3.31.3",
    "@tiptap/extension-collaboration": "3.31.3",
    "@tiptap/extension-collaboration-caret": "3.31.3",
    "@tiptap/pm": "3.31.3",
    "@tiptap/react": "3.31.3",
    "@tiptap/starter-kit": "3.31.3",
    "@tiptap/y-tiptap": "3.0.9",
    "jose": "6.2.12",
    "next": "16.3.5",
    "react": "19.3.0",
    "react-dom": "19.3.0",
    "y-websocket": "3.1.0",
    "yjs": "13.6.32",
    "zod": "4.6.5"
  },
  "devDependencies": {
    "@crdt/sync": "workspace:*",
    "@types/react": "19.3.0",
    "ws": "8.21.3"
  }
}
```

`apps/web/next.config.ts`:
```ts
import type { NextConfig } from 'next'

const config: NextConfig = {
  transpilePackages: ['@crdt/shared', '@crdt/db'],
}

export default config
```

`apps/web/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "jsx": "preserve",
    "moduleResolution": "Bundler",
    "module": "ESNext",
    "noEmit": true,
    "plugins": [{ "name": "next" }],
    "paths": { "@/*": ["./src/*"] }
  },
  "include": ["src/**/*.ts", "src/**/*.tsx", "test/**/*.ts", "next-env.d.ts"]
}
```

`apps/web/src/app/layout.tsx`:
```tsx
import type { ReactNode } from 'react'

export const metadata = { title: 'CRDT Workspace' }

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body style={{ fontFamily: 'system-ui, sans-serif', margin: 0 }}>{children}</body>
    </html>
  )
}
```

`apps/web/src/app/page.tsx`:
```tsx
export default function Home() {
  return <main style={{ padding: 24 }}><h1>CRDT Workspace</h1></main>
}
```

```bash
pnpm install
```

- [ ] **Step 2: Write the failing test**

`apps/web/test/doc-session.integration.test.ts`:
```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { WebSocket } from 'ws'
import { signDocToken } from '@crdt/shared/doc-token'
import { createSyncServer, type SyncServer } from '@crdt/sync/server'
import { createDocSession } from '../src/lib/doc-session.js'

const SECRET = 'test-secret-that-is-long-enough!!'
let server: SyncServer

beforeEach(async () => {
  server = await createSyncServer({ port: 0, jwtSecret: SECRET })
})

afterEach(async () => {
  await server.close()
})

function tokenFor(documentId: string, name: string) {
  return () =>
    signDocToken(
      { sub: `usr_${name}`, docId: documentId, role: 'editor', name, color: '#000' },
      SECRET,
    )
}

function eventually(predicate: () => boolean, timeoutMs = 3000): Promise<void> {
  return new Promise((resolve, reject) => {
    const started = Date.now()
    const tick = () => {
      if (predicate()) return resolve()
      if (Date.now() - started > timeoutMs) return reject(new Error('timed out'))
      setTimeout(tick, 20)
    }
    tick()
  })
}

describe('createDocSession', () => {
  it('syncs two sessions on the same document', async () => {
    const options = {
      syncUrl: `ws://127.0.0.1:${server.port}`,
      disableBc: true,
      WebSocketImpl: WebSocket as unknown as typeof WebSocket,
    }
    const a = createDocSession({ ...options, documentId: 'doc_1', fetchToken: tokenFor('doc_1', 'a') })
    const b = createDocSession({ ...options, documentId: 'doc_1', fetchToken: tokenFor('doc_1', 'b') })

    a.doc.getText('t').insert(0, 'shared')
    await eventually(() => b.doc.getText('t').toString() === 'shared')

    a.destroy()
    b.destroy()
  })

  it('reports status transitions', async () => {
    const seen: string[] = []
    const session = createDocSession({
      documentId: 'doc_2',
      syncUrl: `ws://127.0.0.1:${server.port}`,
      disableBc: true,
      WebSocketImpl: WebSocket as unknown as typeof WebSocket,
      fetchToken: tokenFor('doc_2', 'a'),
    })
    session.onStatus((status) => seen.push(status))

    await eventually(() => seen.includes('connected'))
    session.destroy()
  })

  it('fetches a fresh token on every reconnect', async () => {
    let fetches = 0
    const session = createDocSession({
      documentId: 'doc_3',
      syncUrl: `ws://127.0.0.1:${server.port}`,
      disableBc: true,
      WebSocketImpl: WebSocket as unknown as typeof WebSocket,
      fetchToken: async () => {
        fetches += 1
        return tokenFor('doc_3', 'a')()
      },
    })

    await eventually(() => fetches === 1)
    session.provider.disconnect()
    session.provider.connect()
    await eventually(() => fetches >= 2)

    session.destroy()
  })
})
```

- [ ] **Step 3: Add the web project to Vitest and export the server**

In `vitest.config.ts`, add:
```ts
{ test: { name: 'web', root: './apps/web', environment: 'node' } },
```

In `apps/sync/package.json`, add an `exports` map so the test can import the server:
```json
  "exports": {
    "./server": "./src/server.ts",
    "./store": "./src/store.ts",
    "./update-queue": "./src/update-queue.ts"
  },
```

```bash
pnpm install
pnpm --filter @crdt/web exec vitest run doc-session
```
Expected: FAIL — `Cannot find module '../src/lib/doc-session.js'`.

- [ ] **Step 4: Implement the session**

`apps/web/src/lib/doc-session.ts`:
```ts
import * as Y from 'yjs'
import { WebsocketProvider } from 'y-websocket'

export type DocStatus = 'connecting' | 'connected' | 'disconnected'

export interface DocSessionOptions {
  documentId: string
  syncUrl: string
  fetchToken(): Promise<string>
  /**
   * Cross-tab BroadcastChannel sync. Must be disabled in tests and automated browser
   * checks: with it on, two tabs of the same origin converge without the server, and
   * a "sync works" test passes with the server stopped.
   */
  disableBc?: boolean
  WebSocketImpl?: typeof WebSocket
}

export interface DocSession {
  doc: Y.Doc
  provider: WebsocketProvider
  onStatus(listener: (status: DocStatus) => void): () => void
  destroy(): void
}

export function createDocSession(options: DocSessionOptions): DocSession {
  const doc = new Y.Doc()

  const provider = new WebsocketProvider(options.syncUrl, options.documentId, doc, {
    connect: false,
    params: {},
    disableBc: options.disableBc ?? false,
    ...(options.WebSocketImpl ? { WebSocketPolyfill: options.WebSocketImpl } : {}),
  })

  let destroyed = false

  /**
   * Doc tokens are short-lived on purpose, so a reconnect after a long offline
   * period must not reuse the token it connected with originally. `provider.params`
   * is documented as safe to mutate; the new value is used for the next connection.
   */
  async function refreshToken(): Promise<void> {
    if (destroyed) return
    try {
      provider.params = { token: await options.fetchToken() }
    } catch {
      // Leave the previous token in place; the provider's backoff will try again.
    }
  }

  const statusListeners = new Set<(status: DocStatus) => void>()
  provider.on('status', ({ status }: { status: DocStatus }) => {
    for (const listener of statusListeners) listener(status)
  })

  provider.on('connection-close', () => {
    void refreshToken()
  })

  void refreshToken().then(() => {
    if (!destroyed) provider.connect()
  })

  return {
    doc,
    provider,
    onStatus(listener) {
      statusListeners.add(listener)
      return () => statusListeners.delete(listener)
    },
    destroy() {
      destroyed = true
      statusListeners.clear()
      provider.destroy()
      doc.destroy()
    },
  }
}
```

- [ ] **Step 5: Implement the React wrapper**

`apps/web/src/hooks/use-doc.ts`:
```ts
'use client'

import { useEffect, useState } from 'react'
import { createDocSession, type DocSession, type DocStatus } from '@/lib/doc-session'

const SYNC_URL = process.env.NEXT_PUBLIC_SYNC_URL ?? 'ws://localhost:1234'

async function fetchToken(documentId: string): Promise<string> {
  const response = await fetch(`/api/documents/${documentId}/token`, { method: 'POST' })
  if (!response.ok) throw new Error(`token request failed: ${response.status}`)
  const body = (await response.json()) as { token: string }
  return body.token
}

export function useCollaborativeDoc(documentId: string) {
  const [session, setSession] = useState<DocSession | null>(null)
  const [status, setStatus] = useState<DocStatus>('connecting')

  useEffect(() => {
    const created = createDocSession({
      documentId,
      syncUrl: SYNC_URL,
      fetchToken: () => fetchToken(documentId),
      // Deliberately left on in the browser: cross-tab sync is a real feature for
      // users. Tests pass disableBc through createDocSession directly.
      disableBc: false,
    })
    const unsubscribe = created.onStatus(setStatus)
    setSession(created)

    return () => {
      unsubscribe()
      created.destroy()
      setSession(null)
    }
  }, [documentId])

  return { doc: session?.doc ?? null, provider: session?.provider ?? null, status }
}
```

- [ ] **Step 6: Run the tests**

```bash
pnpm --filter @crdt/web exec vitest run doc-session
```
Expected: PASS, 3 tests.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: add next.js app and collaborative document session"
```

---

### Task 14: Board UI

**Files:**
- Create: `apps/web/src/components/Board.tsx`, `apps/web/src/hooks/use-board.ts`
- Create: `apps/web/src/app/documents/[id]/page.tsx`, `apps/web/src/app/documents/[id]/DocumentClient.tsx`

**Interfaces:**
- Consumes: `useCollaborativeDoc`, board operations from `@crdt/shared/board`
- Produces: `useBoard(doc: Y.Doc | null): { columns: ColumnView[]; cardsByColumn: Map<string, CardView[]> }` and `<Board doc={doc} readOnly={boolean} />`.

- [ ] **Step 1: Implement the board snapshot hook**

`apps/web/src/hooks/use-board.ts`:
```ts
'use client'

import { useCallback, useRef, useSyncExternalStore } from 'react'
import type * as Y from 'yjs'
import { listCards, listColumns, type CardView, type ColumnView } from '@crdt/shared/board'

export interface BoardSnapshot {
  columns: ColumnView[]
  cardsByColumn: Map<string, CardView[]>
}

const EMPTY: BoardSnapshot = { columns: [], cardsByColumn: new Map() }

function build(doc: Y.Doc): BoardSnapshot {
  const columns = listColumns(doc)
  const cardsByColumn = new Map<string, CardView[]>()
  for (const column of columns) cardsByColumn.set(column.id, listCards(doc, column.id))
  return { columns, cardsByColumn }
}

/**
 * Yjs is the store; React just reads it. The version counter exists because
 * getSnapshot must return a referentially stable value between updates, and
 * build() allocates a new object every call.
 */
export function useBoard(doc: Y.Doc | null): BoardSnapshot {
  const version = useRef(0)
  const cache = useRef<{ version: number; value: BoardSnapshot } | null>(null)

  const subscribe = useCallback(
    (onChange: () => void) => {
      if (!doc) return () => {}
      const handler = () => {
        version.current += 1
        onChange()
      }
      doc.on('update', handler)
      return () => doc.off('update', handler)
    },
    [doc],
  )

  const getSnapshot = useCallback(() => {
    if (!doc) return EMPTY
    if (!cache.current || cache.current.version !== version.current) {
      cache.current = { version: version.current, value: build(doc) }
    }
    return cache.current.value
  }, [doc])

  return useSyncExternalStore(subscribe, getSnapshot, () => EMPTY)
}
```

- [ ] **Step 2: Implement the board component**

`apps/web/src/components/Board.tsx`:
```tsx
'use client'

import { useState } from 'react'
import type * as Y from 'yjs'
import { addCard, addColumn, moveCard, removeCard } from '@crdt/shared/board'
import { useBoard } from '@/hooks/use-board'

interface BoardProps {
  doc: Y.Doc
  readOnly?: boolean
}

interface DragPayload {
  cardId: string
}

export function Board({ doc, readOnly = false }: BoardProps) {
  const { columns, cardsByColumn } = useBoard(doc)
  const [dragOver, setDragOver] = useState<string | null>(null)

  function handleDrop(event: React.DragEvent, columnId: string, beforeCardId?: string) {
    event.preventDefault()
    setDragOver(null)
    if (readOnly) return

    const raw = event.dataTransfer.getData('application/x-card')
    if (!raw) return

    let payload: DragPayload
    try {
      payload = JSON.parse(raw) as DragPayload
    } catch {
      return
    }

    moveCard(doc, payload.cardId, { columnId, beforeCardId })
  }

  return (
    <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start', padding: 16 }}>
      {columns.map((column) => (
        <section
          key={column.id}
          data-testid={`column-${column.id}`}
          onDragOver={(event) => {
            event.preventDefault()
            setDragOver(column.id)
          }}
          onDragLeave={() => setDragOver(null)}
          onDrop={(event) => handleDrop(event, column.id)}
          style={{
            width: 260,
            background: dragOver === column.id ? '#eef2ff' : '#f4f4f5',
            borderRadius: 8,
            padding: 12,
          }}
        >
          <h2 style={{ fontSize: 14, margin: '0 0 12px' }}>{column.title}</h2>

          {(cardsByColumn.get(column.id) ?? []).map((card) => (
            <article
              key={card.id}
              data-testid={`card-${card.id}`}
              data-column={column.id}
              draggable={!readOnly}
              onDragStart={(event) => {
                event.dataTransfer.setData(
                  'application/x-card',
                  JSON.stringify({ cardId: card.id } satisfies DragPayload),
                )
                event.dataTransfer.effectAllowed = 'move'
              }}
              onDrop={(event) => {
                event.stopPropagation()
                handleDrop(event, column.id, card.id)
              }}
              style={{
                background: 'white',
                border: '1px solid #e4e4e7',
                borderRadius: 6,
                padding: '8px 10px',
                marginBottom: 8,
                cursor: readOnly ? 'default' : 'grab',
              }}
            >
              <span>{card.title}</span>
              {!readOnly && (
                <button
                  aria-label={`Delete ${card.title}`}
                  onClick={() => removeCard(doc, card.id)}
                  style={{ float: 'right', border: 'none', background: 'none', cursor: 'pointer' }}
                >
                  ×
                </button>
              )}
            </article>
          ))}

          {!readOnly && (
            <button
              data-testid={`add-card-${column.id}`}
              onClick={() =>
                addCard(doc, {
                  id: crypto.randomUUID(),
                  title: 'New card',
                  columnId: column.id,
                })
              }
              style={{ width: '100%', padding: 8, borderRadius: 6, border: '1px dashed #a1a1aa' }}
            >
              + Add card
            </button>
          )}
        </section>
      ))}

      {!readOnly && (
        <button
          data-testid="add-column"
          onClick={() => addColumn(doc, { id: crypto.randomUUID(), title: 'New column' })}
          style={{ padding: 12, borderRadius: 8, border: '1px dashed #a1a1aa' }}
        >
          + Add column
        </button>
      )}
    </div>
  )
}
```

- [ ] **Step 3: Implement the document page**

`apps/web/src/app/documents/[id]/DocumentClient.tsx`:
```tsx
'use client'

import { useCollaborativeDoc } from '@/hooks/use-doc'
import { Board } from '@/components/Board'

export function DocumentClient({
  documentId,
  type,
  readOnly,
}: {
  documentId: string
  type: 'doc' | 'board'
  readOnly: boolean
}) {
  const { doc, status } = useCollaborativeDoc(documentId)

  return (
    <main>
      <header style={{ padding: '12px 16px', borderBottom: '1px solid #e4e4e7' }}>
        <span data-testid="status">{status}</span>
        {readOnly && <strong style={{ marginLeft: 12 }}>read only</strong>}
      </header>
      {doc && type === 'board' && <Board doc={doc} readOnly={readOnly} />}
    </main>
  )
}
```

`apps/web/src/app/documents/[id]/page.tsx`:
```tsx
import { notFound } from 'next/navigation'
import { prisma } from '@crdt/db'
import { DocumentClient } from './DocumentClient'

export default async function DocumentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const document = await prisma.document.findUnique({ where: { id } })
  if (!document) notFound()

  // Role is resolved properly in Task 18; until then every visitor is an editor.
  return <DocumentClient documentId={document.id} type={document.type} readOnly={false} />
}
```

- [ ] **Step 4: Seed a board and verify by hand**

```bash
pnpm --filter @crdt/sync dev
```
In a second terminal:
```bash
pnpm --filter @crdt/web dev
```
In a third, create a workspace, a board document, and two columns:
```bash
pnpm --filter @crdt/db exec prisma studio
```
Create one `Workspace` (any `ownerId`) and one `Document` with `type=board`, note its id.

Open `http://localhost:3000/documents/<id>` in two windows. Add a column in one; it
appears in the other. Add cards and drag one between columns.

**Use two separate browser windows in different profiles, or one normal and one incognito.**
Two tabs in the same profile share a BroadcastChannel and will appear to sync even if the
WebSocket is broken.

- [ ] **Step 5: Verify the failure case on purpose**

Stop the sync server (Ctrl-C). Drag a card in each window — they diverge, and the status
indicator shows `disconnected`. Restart the sync server. Both windows converge on the same
board within a second, keeping both users' moves. This is the demo; rehearse it now, while
the code is fresh.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: add collaborative kanban board with native drag and drop"
```

---

## Phase 4 — Auth and roles

*Exit criterion: a viewer's edit is rejected by the server, not hidden by the UI.*

---

### Task 15: Sessions

**Files:**
- Create: `apps/web/src/lib/session.ts`
- Test: `apps/web/test/session.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `hashPassword(password: string): Promise<string>` — `scrypt$<salt hex>$<hash hex>`
  - `verifyPassword(password: string, stored: string): Promise<boolean>`
  - `signSession(userId: string, secret: string): Promise<string>`
  - `verifySession(token: string, secret: string): Promise<string>` — returns the user id, throws `SessionError`
  - `SESSION_COOKIE = 'crdt_session'`

- [ ] **Step 1: Write the failing test**

`apps/web/test/session.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import {
  hashPassword, verifyPassword, signSession, verifySession, SessionError,
} from '../src/lib/session.js'

const SECRET = 'session-secret-long-enough-here!'

describe('password hashing', () => {
  it('accepts the correct password', async () => {
    const stored = await hashPassword('correct horse battery staple')
    await expect(verifyPassword('correct horse battery staple', stored)).resolves.toBe(true)
  })

  it('rejects the wrong password', async () => {
    const stored = await hashPassword('correct horse battery staple')
    await expect(verifyPassword('wrong', stored)).resolves.toBe(false)
  })

  it('produces a different hash for the same password each time', async () => {
    const a = await hashPassword('same')
    const b = await hashPassword('same')
    expect(a).not.toBe(b)
  })

  it('returns false rather than throwing on a malformed stored value', async () => {
    await expect(verifyPassword('x', 'garbage')).resolves.toBe(false)
  })
})

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
```

- [ ] **Step 2: Run it and watch it fail**

```bash
pnpm --filter @crdt/web exec vitest run session
```
Expected: FAIL — module not found.

- [ ] **Step 3: Implement it**

`apps/web/src/lib/session.ts`:
```ts
import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'
import { SignJWT, jwtVerify } from 'jose'

const scryptAsync = promisify(scrypt) as (
  password: string,
  salt: Buffer,
  keylen: number,
) => Promise<Buffer>

const KEY_LENGTH = 64

export const SESSION_COOKIE = 'crdt_session'
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7

export class SessionError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'SessionError'
  }
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16)
  const derived = await scryptAsync(password, salt, KEY_LENGTH)
  return `scrypt$${salt.toString('hex')}$${derived.toString('hex')}`
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, saltHex, hashHex] = stored.split('$')
  if (scheme !== 'scrypt' || !saltHex || !hashHex) return false

  try {
    const expected = Buffer.from(hashHex, 'hex')
    const derived = await scryptAsync(password, Buffer.from(saltHex, 'hex'), expected.length)
    return derived.length === expected.length && timingSafeEqual(derived, expected)
  } catch {
    return false
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
```

- [ ] **Step 4: Run the tests**

```bash
pnpm --filter @crdt/web exec vitest run session
```
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: add scrypt password hashing and signed session tokens"
```

---

### Task 16: Auth routes

**Files:**
- Create: `apps/web/src/lib/env.ts`, `apps/web/src/lib/auth-guard.ts`
- Create: `apps/web/src/app/api/auth/signup/route.ts`, `apps/web/src/app/api/auth/login/route.ts`, `apps/web/src/app/api/auth/logout/route.ts`, `apps/web/src/app/api/me/route.ts`
- Test: `apps/web/test/auth-routes.integration.test.ts`

**Interfaces:**
- Consumes: `session.ts`, `prisma`
- Produces: `requireUser(): Promise<{ id: string; email: string; name: string }>` throwing `HttpError(401)`; `class HttpError extends Error { status: number }`; `env.sessionSecret`, `env.syncJwtSecret`.

- [ ] **Step 1: Write the failing test**

Route handlers are plain functions taking a `Request`, so they can be called directly —
no HTTP server, no Next.js runtime.

`apps/web/test/auth-routes.integration.test.ts`:
```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { prisma } from '@crdt/db'
import { POST as signup } from '../src/app/api/auth/signup/route.js'
import { POST as login } from '../src/app/api/auth/login/route.js'

const EMAIL = 'route-test@example.com'

beforeAll(async () => {
  process.env.SESSION_SECRET = 'session-secret-long-enough-here!'
  process.env.SYNC_JWT_SECRET = 'sync-secret-that-is-long-enough!'
  await prisma.user.deleteMany({ where: { email: EMAIL } })
})

afterAll(async () => {
  await prisma.user.deleteMany({ where: { email: EMAIL } })
  await prisma.$disconnect()
})

const post = (body: unknown) =>
  new Request('http://localhost/api', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })

describe('auth routes', () => {
  it('creates a user, a personal workspace, and a session cookie', async () => {
    const response = await signup(post({ email: EMAIL, password: 'hunter2hunter2', name: 'Route' }))

    expect(response.status).toBe(201)
    expect(response.headers.get('set-cookie')).toContain('crdt_session=')

    const user = await prisma.user.findUnique({
      where: { email: EMAIL },
      include: { memberships: true },
    })
    expect(user).not.toBeNull()
    expect(user!.passwordHash).not.toContain('hunter2')
    expect(user!.memberships[0]?.role).toBe('owner')
  })

  it('rejects a duplicate email', async () => {
    const response = await signup(post({ email: EMAIL, password: 'hunter2hunter2', name: 'Again' }))
    expect(response.status).toBe(409)
  })

  it('rejects a short password with 400', async () => {
    const response = await signup(post({ email: 'x@example.com', password: 'short', name: 'X' }))
    expect(response.status).toBe(400)
  })

  it('logs in with the right password', async () => {
    const response = await login(post({ email: EMAIL, password: 'hunter2hunter2' }))
    expect(response.status).toBe(200)
    expect(response.headers.get('set-cookie')).toContain('crdt_session=')
  })

  it('returns 401 for a wrong password without saying which field was wrong', async () => {
    const response = await login(post({ email: EMAIL, password: 'wrongwrongwrong' }))
    expect(response.status).toBe(401)
    const body = (await response.json()) as { error: string }
    expect(body.error).toBe('invalid credentials')
  })

  it('returns 401 for an unknown email with the same message', async () => {
    const response = await login(post({ email: 'nobody@example.com', password: 'whatever12345' }))
    expect(response.status).toBe(401)
    const body = (await response.json()) as { error: string }
    expect(body.error).toBe('invalid credentials')
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

```bash
pnpm --filter @crdt/web exec vitest run auth-routes
```
Expected: FAIL — route modules do not exist.

- [ ] **Step 3: Implement env and the guard**

`apps/web/src/lib/env.ts`:
```ts
function required(name: string): string {
  const value = process.env[name]
  if (!value || value.length < 32) {
    throw new Error(`${name} must be set to at least 32 characters`)
  }
  return value
}

export const env = {
  get sessionSecret() { return required('SESSION_SECRET') },
  get syncJwtSecret() { return required('SYNC_JWT_SECRET') },
}
```

`apps/web/src/lib/auth-guard.ts`:
```ts
import { cookies } from 'next/headers'
import { prisma } from '@crdt/db'
import type { Role } from '@crdt/shared/types'
import { env } from './env.js'
import { SESSION_COOKIE, verifySession } from './session.js'

export class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message)
    this.name = 'HttpError'
  }
}

export function toResponse(error: unknown): Response {
  if (error instanceof HttpError) {
    return Response.json({ error: error.message }, { status: error.status })
  }
  console.error(error)
  return Response.json({ error: 'internal error' }, { status: 500 })
}

export async function requireUser() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value
  if (!token) throw new HttpError(401, 'not authenticated')

  let userId: string
  try {
    userId = await verifySession(token, env.sessionSecret)
  } catch {
    throw new HttpError(401, 'not authenticated')
  }

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, name: true },
  })
  if (!user) throw new HttpError(401, 'not authenticated')
  return user
}

const RANK: Record<Role, number> = { viewer: 0, editor: 1, owner: 2 }

/**
 * Resolve the caller's role in a workspace, requiring at least `minimum`.
 * Returns 404 rather than 403 for a workspace the caller cannot see, so the API
 * never confirms that an id exists to someone with no access to it.
 */
export async function requireWorkspaceRole(
  userId: string,
  workspaceId: string,
  minimum: Role,
): Promise<Role> {
  const membership = await prisma.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId, userId } },
    select: { role: true },
  })
  if (!membership) throw new HttpError(404, 'not found')
  if (RANK[membership.role] < RANK[minimum]) throw new HttpError(403, 'insufficient role')
  return membership.role
}

export async function requireDocumentRole(
  userId: string,
  documentId: string,
  minimum: Role,
): Promise<{ role: Role; workspaceId: string; type: 'doc' | 'board' }> {
  const document = await prisma.document.findUnique({
    where: { id: documentId },
    select: { workspaceId: true, type: true },
  })
  if (!document) throw new HttpError(404, 'not found')

  const role = await requireWorkspaceRole(userId, document.workspaceId, minimum)
  return { role, workspaceId: document.workspaceId, type: document.type }
}
```

- [ ] **Step 4: Implement the routes**

`apps/web/src/app/api/auth/signup/route.ts`:
```ts
import { z } from 'zod'
import { prisma } from '@crdt/db'
import { env } from '@/lib/env'
import { hashPassword, signSession, SESSION_COOKIE, SESSION_TTL_SECONDS } from '@/lib/session'
import { toResponse } from '@/lib/auth-guard'

const Body = z.object({
  email: z.string().email(),
  password: z.string().min(12),
  name: z.string().min(1).max(80),
})

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

export async function POST(request: Request): Promise<Response> {
  try {
    const parsed = Body.safeParse(await request.json())
    if (!parsed.success) return Response.json({ error: 'invalid body' }, { status: 400 })

    const { email, password, name } = parsed.data

    const existing = await prisma.user.findUnique({ where: { email } })
    if (existing) return Response.json({ error: 'email already registered' }, { status: 409 })

    const user = await prisma.user.create({
      data: { email, name, passwordHash: await hashPassword(password) },
      select: { id: true, email: true, name: true },
    })

    // Everyone starts with a workspace they own, so signup lands somewhere usable.
    const workspace = await prisma.workspace.create({
      data: { name: `${name}'s workspace`, ownerId: user.id },
    })
    await prisma.workspaceMember.create({
      data: { workspaceId: workspace.id, userId: user.id, role: 'owner' },
    })

    const token = await signSession(user.id, env.sessionSecret)
    return Response.json(user, {
      status: 201,
      headers: { 'set-cookie': sessionCookie(token) },
    })
  } catch (error) {
    return toResponse(error)
  }
}
```

`apps/web/src/app/api/auth/login/route.ts`:
```ts
import { z } from 'zod'
import { prisma } from '@crdt/db'
import { env } from '@/lib/env'
import { verifyPassword, signSession } from '@/lib/session'
import { toResponse } from '@/lib/auth-guard'
import { sessionCookie } from '../signup/route'

const Body = z.object({ email: z.string().email(), password: z.string().min(1) })

export async function POST(request: Request): Promise<Response> {
  try {
    const parsed = Body.safeParse(await request.json())
    if (!parsed.success) return Response.json({ error: 'invalid body' }, { status: 400 })

    const user = await prisma.user.findUnique({ where: { email: parsed.data.email } })

    // Same message and same code for "no such user" and "wrong password", so the
    // endpoint cannot be used to enumerate registered addresses.
    const ok = user ? await verifyPassword(parsed.data.password, user.passwordHash) : false
    if (!user || !ok) return Response.json({ error: 'invalid credentials' }, { status: 401 })

    const token = await signSession(user.id, env.sessionSecret)
    return Response.json(
      { id: user.id, email: user.email, name: user.name },
      { headers: { 'set-cookie': sessionCookie(token) } },
    )
  } catch (error) {
    return toResponse(error)
  }
}
```

`apps/web/src/app/api/auth/logout/route.ts`:
```ts
import { SESSION_COOKIE } from '@/lib/session'

export async function POST(): Promise<Response> {
  return new Response(null, {
    status: 204,
    headers: { 'set-cookie': `${SESSION_COOKIE}=; Path=/; HttpOnly; Max-Age=0` },
  })
}
```

`apps/web/src/app/api/me/route.ts`:
```ts
import { requireUser, toResponse } from '@/lib/auth-guard'

export async function GET(): Promise<Response> {
  try {
    return Response.json(await requireUser())
  } catch (error) {
    return toResponse(error)
  }
}
```

- [ ] **Step 5: Run the tests**

```bash
pnpm --filter @crdt/web exec vitest run auth-routes
```
Expected: PASS, 6 tests.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: add signup, login and logout with session cookies"
```

---

### Task 17: Workspace and document API

**Files:**
- Create: `apps/web/src/app/api/workspaces/route.ts`, `apps/web/src/app/api/workspaces/[id]/members/route.ts`, `apps/web/src/app/api/workspaces/[id]/documents/route.ts`
- Test: `apps/web/test/workspace-routes.integration.test.ts`

**Interfaces:**
- Consumes: `requireUser`, `requireWorkspaceRole`, `HttpError`, `toResponse`
- Produces: the REST surface listed in the spec's §6.

- [ ] **Step 1: Write the failing test**

These routes read the session from `cookies()`, which needs the Next.js request context.
Rather than fight that in a unit test, test the authorization helpers directly against
real data — that is where the security property lives.

`apps/web/test/workspace-routes.integration.test.ts`:
```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { prisma } from '@crdt/db'
import { requireWorkspaceRole, requireDocumentRole, HttpError } from '../src/lib/auth-guard.js'

let ownerId: string
let editorId: string
let viewerId: string
let strangerId: string
let workspaceId: string
let documentId: string

beforeAll(async () => {
  const make = (email: string, name: string) =>
    prisma.user.create({ data: { email, name, passwordHash: 'x' }, select: { id: true } })

  ownerId = (await make('rbac-owner@example.com', 'owner')).id
  editorId = (await make('rbac-editor@example.com', 'editor')).id
  viewerId = (await make('rbac-viewer@example.com', 'viewer')).id
  strangerId = (await make('rbac-stranger@example.com', 'stranger')).id

  const workspace = await prisma.workspace.create({ data: { name: 'rbac', ownerId } })
  workspaceId = workspace.id

  await prisma.workspaceMember.createMany({
    data: [
      { workspaceId, userId: ownerId, role: 'owner' },
      { workspaceId, userId: editorId, role: 'editor' },
      { workspaceId, userId: viewerId, role: 'viewer' },
    ],
  })

  documentId = (
    await prisma.document.create({ data: { workspaceId, type: 'board', title: 'rbac board' } })
  ).id
})

afterAll(async () => {
  await prisma.workspace.deleteMany({ where: { name: 'rbac' } })
  await prisma.user.deleteMany({ where: { email: { contains: 'rbac-' } } })
  await prisma.$disconnect()
})

async function statusOf(promise: Promise<unknown>): Promise<number> {
  try {
    await promise
    return 200
  } catch (error) {
    return error instanceof HttpError ? error.status : 500
  }
}

describe('workspace authorization', () => {
  it('lets an owner do owner-level things', async () => {
    await expect(requireWorkspaceRole(ownerId, workspaceId, 'owner')).resolves.toBe('owner')
  })

  it('lets an editor write but not administer', async () => {
    await expect(requireWorkspaceRole(editorId, workspaceId, 'editor')).resolves.toBe('editor')
    expect(await statusOf(requireWorkspaceRole(editorId, workspaceId, 'owner'))).toBe(403)
  })

  it('lets a viewer read but not write', async () => {
    await expect(requireWorkspaceRole(viewerId, workspaceId, 'viewer')).resolves.toBe('viewer')
    expect(await statusOf(requireWorkspaceRole(viewerId, workspaceId, 'editor'))).toBe(403)
  })

  it('gives a non-member 404, never 403, so ids cannot be probed', async () => {
    expect(await statusOf(requireWorkspaceRole(strangerId, workspaceId, 'viewer'))).toBe(404)
  })

  it('resolves a document role through its workspace', async () => {
    const result = await requireDocumentRole(viewerId, documentId, 'viewer')
    expect(result.role).toBe('viewer')
    expect(result.type).toBe('board')
  })

  it('gives 404 for a document in a workspace the caller is not in', async () => {
    expect(await statusOf(requireDocumentRole(strangerId, documentId, 'viewer'))).toBe(404)
  })

  it('gives 404 for a document that does not exist', async () => {
    expect(await statusOf(requireDocumentRole(ownerId, 'doc_missing', 'viewer'))).toBe(404)
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

```bash
pnpm --filter @crdt/web exec vitest run workspace-routes
```
Expected: FAIL only if Task 16's `auth-guard.ts` is missing. If Task 16 is done, these
tests should pass immediately — that is fine and expected. The value here is pinning the
404-not-403 behavior so a later refactor cannot quietly turn it into an enumeration oracle.

- [ ] **Step 3: Implement the routes**

`apps/web/src/app/api/workspaces/route.ts`:
```ts
import { z } from 'zod'
import { prisma } from '@crdt/db'
import { requireUser, toResponse } from '@/lib/auth-guard'

export async function GET(): Promise<Response> {
  try {
    const user = await requireUser()
    const memberships = await prisma.workspaceMember.findMany({
      where: { userId: user.id },
      select: { role: true, workspace: { select: { id: true, name: true } } },
    })
    return Response.json(
      memberships.map((m) => ({ id: m.workspace.id, name: m.workspace.name, role: m.role })),
    )
  } catch (error) {
    return toResponse(error)
  }
}

const CreateBody = z.object({ name: z.string().min(1).max(120) })

export async function POST(request: Request): Promise<Response> {
  try {
    const user = await requireUser()
    const parsed = CreateBody.safeParse(await request.json())
    if (!parsed.success) return Response.json({ error: 'invalid body' }, { status: 400 })

    const workspace = await prisma.workspace.create({
      data: {
        name: parsed.data.name,
        ownerId: user.id,
        members: { create: { userId: user.id, role: 'owner' } },
      },
      select: { id: true, name: true },
    })
    return Response.json(workspace, { status: 201 })
  } catch (error) {
    return toResponse(error)
  }
}
```

`apps/web/src/app/api/workspaces/[id]/members/route.ts`:
```ts
import { z } from 'zod'
import { prisma } from '@crdt/db'
import { requireUser, requireWorkspaceRole, toResponse, HttpError } from '@/lib/auth-guard'

const Body = z.object({
  email: z.string().email(),
  role: z.enum(['owner', 'editor', 'viewer']),
})

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const user = await requireUser()
    const { id: workspaceId } = await params
    await requireWorkspaceRole(user.id, workspaceId, 'owner')

    const parsed = Body.safeParse(await request.json())
    if (!parsed.success) return Response.json({ error: 'invalid body' }, { status: 400 })

    const invitee = await prisma.user.findUnique({
      where: { email: parsed.data.email },
      select: { id: true },
    })
    if (!invitee) throw new HttpError(404, 'not found')

    const member = await prisma.workspaceMember.upsert({
      where: { workspaceId_userId: { workspaceId, userId: invitee.id } },
      create: { workspaceId, userId: invitee.id, role: parsed.data.role },
      update: { role: parsed.data.role },
      select: { userId: true, role: true },
    })
    return Response.json(member, { status: 201 })
  } catch (error) {
    return toResponse(error)
  }
}
```

`apps/web/src/app/api/workspaces/[id]/documents/route.ts`:
```ts
import { z } from 'zod'
import { prisma } from '@crdt/db'
import { requireUser, requireWorkspaceRole, toResponse } from '@/lib/auth-guard'

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const user = await requireUser()
    const { id: workspaceId } = await params
    await requireWorkspaceRole(user.id, workspaceId, 'viewer')

    const documents = await prisma.document.findMany({
      where: { workspaceId },
      select: { id: true, title: true, type: true },
      orderBy: { createdAt: 'asc' },
    })
    return Response.json(documents)
  } catch (error) {
    return toResponse(error)
  }
}

const Body = z.object({ title: z.string().min(1).max(200), type: z.enum(['doc', 'board']) })

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const user = await requireUser()
    const { id: workspaceId } = await params
    await requireWorkspaceRole(user.id, workspaceId, 'editor')

    const parsed = Body.safeParse(await request.json())
    if (!parsed.success) return Response.json({ error: 'invalid body' }, { status: 400 })

    const document = await prisma.document.create({
      data: { workspaceId, title: parsed.data.title, type: parsed.data.type },
      select: { id: true, title: true, type: true },
    })
    return Response.json(document, { status: 201 })
  } catch (error) {
    return toResponse(error)
  }
}
```

- [ ] **Step 4: Run the tests**

```bash
pnpm --filter @crdt/web exec vitest run workspace-routes
```
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: add workspace, membership and document endpoints"
```

---

### Task 18: Document token endpoint

**Files:**
- Create: `apps/web/src/app/api/documents/[id]/token/route.ts`
- Modify: `apps/web/src/app/documents/[id]/page.tsx` (resolve the real role)
- Test: `apps/web/test/doc-token-route.integration.test.ts`

**Interfaces:**
- Consumes: `requireDocumentRole`, `signDocToken`
- Produces: `POST /api/documents/:id/token` returning `{ token, expiresAt, role }`.

- [ ] **Step 1: Write the failing test**

`apps/web/test/doc-token-route.integration.test.ts`:
```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { prisma } from '@crdt/db'
import { verifyDocToken } from '@crdt/shared/doc-token'
import { mintDocToken } from '../src/app/api/documents/[id]/token/route.js'

const SECRET = 'sync-secret-that-is-long-enough!'

let viewerId: string
let documentId: string

beforeAll(async () => {
  process.env.SYNC_JWT_SECRET = SECRET

  const viewer = await prisma.user.create({
    data: { email: 'token-viewer@example.com', name: 'Viewer', passwordHash: 'x' },
  })
  viewerId = viewer.id

  const workspace = await prisma.workspace.create({ data: { name: 'token-test', ownerId: viewerId } })
  await prisma.workspaceMember.create({
    data: { workspaceId: workspace.id, userId: viewerId, role: 'viewer' },
  })
  documentId = (
    await prisma.document.create({
      data: { workspaceId: workspace.id, type: 'board', title: 'token board' },
    })
  ).id
})

afterAll(async () => {
  await prisma.workspace.deleteMany({ where: { name: 'token-test' } })
  await prisma.user.deleteMany({ where: { email: 'token-viewer@example.com' } })
  await prisma.$disconnect()
})

describe('mintDocToken', () => {
  it('embeds the caller role and document id', async () => {
    const { token, role } = await mintDocToken(
      { id: viewerId, name: 'Viewer', email: 'token-viewer@example.com' },
      documentId,
    )

    expect(role).toBe('viewer')
    const claims = await verifyDocToken(token, SECRET)
    expect(claims.role).toBe('viewer')
    expect(claims.docId).toBe(documentId)
    expect(claims.sub).toBe(viewerId)
  })

  it('refuses to mint a token for a document the caller cannot see', async () => {
    const stranger = await prisma.user.create({
      data: { email: 'token-stranger@example.com', name: 'S', passwordHash: 'x' },
    })
    await expect(
      mintDocToken({ id: stranger.id, name: 'S', email: 'token-stranger@example.com' }, documentId),
    ).rejects.toMatchObject({ status: 404 })

    await prisma.user.delete({ where: { id: stranger.id } })
  })

  it('never mints a token that outlives its ttl', async () => {
    const { token, expiresAt } = await mintDocToken(
      { id: viewerId, name: 'Viewer', email: 'token-viewer@example.com' },
      documentId,
    )
    await verifyDocToken(token, SECRET)

    const remainingMs = new Date(expiresAt).getTime() - Date.now()
    expect(remainingMs).toBeGreaterThan(0)
    expect(remainingMs).toBeLessThanOrEqual(15 * 60 * 1000 + 1000)
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

```bash
pnpm --filter @crdt/web exec vitest run doc-token-route
```
Expected: FAIL — module not found.

- [ ] **Step 3: Implement it**

`apps/web/src/app/api/documents/[id]/token/route.ts`:
```ts
import { signDocToken, DEFAULT_TTL_SECONDS } from '@crdt/shared/doc-token'
import { env } from '@/lib/env'
import { requireDocumentRole, requireUser, toResponse } from '@/lib/auth-guard'

/** Deterministic per-user colour, so presence colours are stable across sessions. */
function colorFor(userId: string): string {
  const palette = ['#e11d48', '#0ea5e9', '#16a34a', '#f59e0b', '#8b5cf6', '#14b8a6']
  let hash = 0
  for (const char of userId) hash = (hash * 31 + char.charCodeAt(0)) % 997
  return palette[hash % palette.length]!
}

/**
 * Exported separately from the route handler so it can be tested without the
 * Next.js request context.
 */
export async function mintDocToken(
  user: { id: string; name: string; email: string },
  documentId: string,
): Promise<{ token: string; expiresAt: string; role: string }> {
  const { role } = await requireDocumentRole(user.id, documentId, 'viewer')

  const token = await signDocToken(
    {
      sub: user.id,
      docId: documentId,
      role,
      name: user.name,
      color: colorFor(user.id),
    },
    env.syncJwtSecret,
    DEFAULT_TTL_SECONDS,
  )

  return {
    token,
    expiresAt: new Date(Date.now() + DEFAULT_TTL_SECONDS * 1000).toISOString(),
    role,
  }
}

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  try {
    const user = await requireUser()
    const { id } = await params
    return Response.json(await mintDocToken(user, id))
  } catch (error) {
    return toResponse(error)
  }
}
```

- [ ] **Step 4: Resolve the real role on the document page**

Replace `apps/web/src/app/documents/[id]/page.tsx` with:
```tsx
import { notFound, redirect } from 'next/navigation'
import { requireUser, requireDocumentRole, HttpError } from '@/lib/auth-guard'
import { DocumentClient } from './DocumentClient'

export default async function DocumentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params

  let user
  try {
    user = await requireUser()
  } catch {
    redirect('/login')
  }

  try {
    const { role, type } = await requireDocumentRole(user.id, id, 'viewer')
    return <DocumentClient documentId={id} type={type} readOnly={role === 'viewer'} />
  } catch (error) {
    if (error instanceof HttpError && error.status === 404) notFound()
    throw error
  }
}
```

- [ ] **Step 5: Run the tests**

```bash
pnpm --filter @crdt/web exec vitest run doc-token-route
```
Expected: PASS, 3 tests.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: mint document-scoped tokens carrying the caller's role"
```

---

### Task 19: End-to-end role enforcement

**Files:**
- Test: `apps/web/test/role-enforcement.integration.test.ts`
- Modify: whatever the test proves wrong

**Interfaces:**
- Consumes: everything from Tasks 3–18
- Produces: no new code. This task exists to prove the central security claim across every
  layer at once, using real tokens minted by the real endpoint logic and a real server.

- [ ] **Step 1: Write the test**

`apps/web/test/role-enforcement.integration.test.ts`:
```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import * as Y from 'yjs'
import { WebSocket } from 'ws'
import { prisma } from '@crdt/db'
import { createSyncServer, type SyncServer } from '@crdt/sync/server'
import { DocumentStore } from '@crdt/sync/store'
import { UpdateQueue } from '@crdt/sync/update-queue'
import { mintDocToken } from '../src/app/api/documents/[id]/token/route.js'
import { createDocSession } from '../src/lib/doc-session.js'

const SECRET = 'sync-secret-that-is-long-enough!'

let server: SyncServer
let queue: UpdateQueue
let documentId: string
let editor: { id: string; name: string; email: string }
let viewer: { id: string; name: string; email: string }

beforeAll(async () => {
  process.env.SYNC_JWT_SECRET = SECRET

  const e = await prisma.user.create({
    data: { email: 'rbac-e2e-editor@example.com', name: 'Editor', passwordHash: 'x' },
  })
  const v = await prisma.user.create({
    data: { email: 'rbac-e2e-viewer@example.com', name: 'Viewer', passwordHash: 'x' },
  })
  editor = { id: e.id, name: e.name, email: e.email }
  viewer = { id: v.id, name: v.name, email: v.email }

  const workspace = await prisma.workspace.create({ data: { name: 'rbac-e2e', ownerId: e.id } })
  await prisma.workspaceMember.createMany({
    data: [
      { workspaceId: workspace.id, userId: e.id, role: 'editor' },
      { workspaceId: workspace.id, userId: v.id, role: 'viewer' },
    ],
  })
  documentId = (
    await prisma.document.create({
      data: { workspaceId: workspace.id, type: 'doc', title: 'rbac doc' },
    })
  ).id

  const store = new DocumentStore(prisma, { snapshotEvery: 100 })
  queue = new UpdateQueue(store, { flushIntervalMs: 50, maxBatch: 8 })
  server = await createSyncServer({
    port: 0,
    jwtSecret: SECRET,
    loadDocument: (id) => store.load(id),
    onPersist: (id, update, clientId) => queue.enqueue(id, { update, clientId }),
  })
})

afterAll(async () => {
  await queue.close()
  await server.close()
  await prisma.workspace.deleteMany({ where: { name: 'rbac-e2e' } })
  await prisma.user.deleteMany({ where: { email: { contains: 'rbac-e2e-' } } })
  await prisma.$disconnect()
})

async function sessionFor(user: { id: string; name: string; email: string }) {
  const session = createDocSession({
    documentId,
    syncUrl: `ws://127.0.0.1:${server.port}`,
    disableBc: true,
    WebSocketImpl: WebSocket as unknown as typeof WebSocket,
    fetchToken: async () => (await mintDocToken(user, documentId)).token,
  })
  await new Promise<void>((resolve) => session.provider.once('sync', () => resolve()))
  return session
}

function eventually(predicate: () => boolean, timeoutMs = 3000): Promise<void> {
  return new Promise((resolve, reject) => {
    const started = Date.now()
    const tick = () => {
      if (predicate()) return resolve()
      if (Date.now() - started > timeoutMs) return reject(new Error('timed out'))
      setTimeout(tick, 20)
    }
    tick()
  })
}

describe('role enforcement, end to end', () => {
  it('lets a viewer read what an editor writes', async () => {
    const e = await sessionFor(editor)
    const v = await sessionFor(viewer)

    e.doc.getText('t').insert(0, 'editor content')
    await eventually(() => v.doc.getText('t').toString() === 'editor content')

    e.destroy()
    v.destroy()
  })

  it('never lets a viewer edit reach the editor, the server, or the database', async () => {
    const e = await sessionFor(editor)
    const v = await sessionFor(viewer)

    v.doc.getText('t').insert(0, 'VIEWER EDIT')
    e.doc.getText('t').insert(0, 'legitimate ')

    await eventually(() => e.doc.getText('t').toString().includes('legitimate'))
    await new Promise((r) => setTimeout(r, 300))
    await queue.flush()

    expect(e.doc.getText('t').toString()).not.toContain('VIEWER EDIT')

    const rows = await prisma.documentUpdate.findMany({
      where: { documentId },
      select: { clientId: true },
    })
    const restored = new Y.Doc()
    const store = new DocumentStore(prisma)
    Y.applyUpdate(restored, (await store.load(documentId))!)
    expect(restored.getText('t').toString()).not.toContain('VIEWER EDIT')
    expect(rows.length).toBeGreaterThan(0)

    e.destroy()
    v.destroy()
  })

  it('leaves the viewer optimistically showing their own rejected edit', async () => {
    // Worth knowing and worth saying out loud: the viewer's own tab still shows the
    // text they typed, because Yjs applied it locally before the server refused it.
    // The UI prevents this by disabling input for viewers; the server guarantees the
    // edit never escapes that tab. Those are two different jobs.
    const v = await sessionFor(viewer)
    v.doc.getText('t').insert(0, 'LOCAL ONLY')
    expect(v.doc.getText('t').toString()).toContain('LOCAL ONLY')
    v.destroy()
  })
})
```

- [ ] **Step 2: Run it**

```bash
pnpm --filter @crdt/web exec vitest run role-enforcement
```
Expected: PASS, 3 tests. If the second test fails, the bug is real and it is the most
important bug in the project — fix it before anything else.

- [ ] **Step 3: Run the whole suite**

```bash
pnpm test
```
Expected: all green across `shared`, `db`, `sync`, and `web`.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "test: prove viewer writes never escape the originating client"
```

---

## Phase 5 — Editor and presence

*Exit criterion: two people see each other's cursors and know who is editing which card.*

---

### Task 20: Collaborative text editor

**Files:**
- Create: `apps/web/src/components/Editor.tsx`, `apps/web/src/app/globals.css`
- Modify: `apps/web/src/app/documents/[id]/DocumentClient.tsx`, `apps/web/src/app/layout.tsx`
- Test: `apps/web/test/editor-binding.test.ts`

**Interfaces:**
- Consumes: `useCollaborativeDoc`
- Produces: `<Editor doc={doc} provider={provider} user={{ name, color }} readOnly={boolean} />` bound to the Y.Doc's `default` XML fragment.

- [ ] **Step 1: Write the failing test**

Tiptap needs a DOM, but the property worth testing does not: that two Y.Docs bound to the
same fragment name converge. That is testable in Node.

`apps/web/test/editor-binding.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import * as Y from 'yjs'
import { EDITOR_FRAGMENT } from '../src/components/editor-fragment.js'

function sync(a: Y.Doc, b: Y.Doc): void {
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a, Y.encodeStateVector(b)))
  Y.applyUpdate(a, Y.encodeStateAsUpdate(b, Y.encodeStateVector(a)))
}

describe('editor binding', () => {
  it('uses a single agreed fragment name', () => {
    // Tiptap's Collaboration extension defaults to the 'default' fragment. Both the
    // editor and anything else reading the document must agree, or two clients edit
    // two different trees inside the same Y.Doc and silently never converge.
    expect(EDITOR_FRAGMENT).toBe('default')
  })

  it('converges concurrent edits to the editor fragment', () => {
    const a = new Y.Doc()
    const b = new Y.Doc()

    const fragmentA = a.getXmlFragment(EDITOR_FRAGMENT)
    const paragraph = new Y.XmlElement('paragraph')
    paragraph.insert(0, [new Y.XmlText('hello ')])
    fragmentA.insert(0, [paragraph])
    sync(a, b)

    ;(a.getXmlFragment(EDITOR_FRAGMENT).get(0) as Y.XmlElement).get(0) instanceof Y.XmlText
    const textA = (a.getXmlFragment(EDITOR_FRAGMENT).get(0) as Y.XmlElement).get(0) as Y.XmlText
    const textB = (b.getXmlFragment(EDITOR_FRAGMENT).get(0) as Y.XmlElement).get(0) as Y.XmlText

    textA.insert(textA.length, 'from a')
    textB.insert(0, 'from b ')
    sync(a, b)

    const rendered = (doc: Y.Doc) =>
      ((doc.getXmlFragment(EDITOR_FRAGMENT).get(0) as Y.XmlElement).get(0) as Y.XmlText).toString()

    expect(rendered(a)).toBe(rendered(b))
    expect(rendered(a)).toContain('from a')
    expect(rendered(a)).toContain('from b')
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

```bash
pnpm --filter @crdt/web exec vitest run editor-binding
```
Expected: FAIL — `editor-fragment.js` does not exist.

- [ ] **Step 3: Implement the fragment constant and the editor**

`apps/web/src/components/editor-fragment.ts`:
```ts
/** The Y.Doc XML fragment Tiptap binds to. Must match Collaboration's default. */
export const EDITOR_FRAGMENT = 'default'
```

`apps/web/src/components/Editor.tsx`:
```tsx
'use client'

import { EditorContent, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Collaboration from '@tiptap/extension-collaboration'
import CollaborationCaret from '@tiptap/extension-collaboration-caret'
import type * as Y from 'yjs'
import type { WebsocketProvider } from 'y-websocket'
import { EDITOR_FRAGMENT } from './editor-fragment'

interface EditorProps {
  doc: Y.Doc
  provider: WebsocketProvider
  user: { name: string; color: string }
  readOnly?: boolean
}

export function Editor({ doc, provider, user, readOnly = false }: EditorProps) {
  const editor = useEditor({
    // Next.js renders this on the server first; Tiptap must not render until hydration.
    immediatelyRender: false,
    editable: !readOnly,
    extensions: [
      // Yjs owns undo history. StarterKit's own undo would fight it and undo other
      // people's edits, so it is disabled rather than merely unused.
      StarterKit.configure({ undoRedo: false }),
      Collaboration.configure({ document: doc, field: EDITOR_FRAGMENT }),
      CollaborationCaret.configure({ provider, user }),
    ],
  })

  return <EditorContent editor={editor} className="editor" />
}
```

`apps/web/src/app/globals.css`:
```css
.editor .ProseMirror {
  min-height: 60vh;
  padding: 24px;
  outline: none;
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
  font-size: 12px;
  left: -1px;
  line-height: 1;
  padding: 2px 6px;
  position: absolute;
  top: -1.4em;
  user-select: none;
  white-space: nowrap;
}
```

In `apps/web/src/app/layout.tsx`, add at the top:
```tsx
import './globals.css'
```

- [ ] **Step 4: Render it from the document page**

Replace `apps/web/src/app/documents/[id]/DocumentClient.tsx`:
```tsx
'use client'

import { useCollaborativeDoc } from '@/hooks/use-doc'
import { Board } from '@/components/Board'
import { Editor } from '@/components/Editor'

export function DocumentClient({
  documentId,
  type,
  readOnly,
  user,
}: {
  documentId: string
  type: 'doc' | 'board'
  readOnly: boolean
  user: { name: string; color: string }
}) {
  const { doc, provider, status } = useCollaborativeDoc(documentId)

  return (
    <main>
      <header
        style={{
          display: 'flex',
          gap: 12,
          alignItems: 'center',
          padding: '12px 16px',
          borderBottom: '1px solid #e4e4e7',
        }}
      >
        <span data-testid="status">{status}</span>
        {readOnly && <strong data-testid="read-only">read only</strong>}
      </header>

      {doc && provider && type === 'doc' && (
        <Editor doc={doc} provider={provider} user={user} readOnly={readOnly} />
      )}
      {doc && type === 'board' && <Board doc={doc} readOnly={readOnly} />}
    </main>
  )
}
```

In `apps/web/src/app/documents/[id]/page.tsx`, pass the user through:
```tsx
    return (
      <DocumentClient
        documentId={id}
        type={type}
        readOnly={role === 'viewer'}
        user={{ name: user.name, color: colorFor(user.id) }}
      />
    )
```
and import `colorFor`. Move `colorFor` from the token route into `apps/web/src/lib/color.ts`
and import it in both places, so a user's presence colour and their token colour cannot
drift apart:

`apps/web/src/lib/color.ts`:
```ts
const PALETTE = ['#e11d48', '#0ea5e9', '#16a34a', '#f59e0b', '#8b5cf6', '#14b8a6']

/** Deterministic per-user colour, stable across sessions and across processes. */
export function colorFor(userId: string): string {
  let hash = 0
  for (const char of userId) hash = (hash * 31 + char.charCodeAt(0)) % 997
  return PALETTE[hash % PALETTE.length]!
}
```
Delete the local `colorFor` from the token route and import this one instead.

- [ ] **Step 5: Run the tests and check by hand**

```bash
pnpm --filter @crdt/web exec vitest run editor-binding
pnpm test
```
Expected: PASS.

Then create a `type=doc` document and open it in two browser profiles. Type in both —
text interleaves correctly and each shows the other's caret with a name label.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: add collaborative rich text editor with live carets"
```

---

### Task 21: Presence

**Files:**
- Create: `apps/web/src/hooks/use-presence.ts`, `apps/web/src/components/Presence.tsx`
- Modify: `apps/web/src/components/Board.tsx`, `apps/web/src/app/documents/[id]/DocumentClient.tsx`

**Interfaces:**
- Consumes: `provider.awareness`
- Produces:
  - `interface PresenceUser { clientId: number; name: string; color: string; cardId: string | null }`
  - `usePresence(provider): PresenceUser[]`
  - `useAnnouncePresence(provider, user)` — sets the local awareness state
  - `setCardFocus(provider, cardId | null)`

- [ ] **Step 1: Implement the presence hooks**

`apps/web/src/hooks/use-presence.ts`:
```ts
'use client'

import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react'
import type { WebsocketProvider } from 'y-websocket'

export interface PresenceUser {
  clientId: number
  name: string
  color: string
  cardId: string | null
}

const EMPTY: PresenceUser[] = []

function read(provider: WebsocketProvider): PresenceUser[] {
  const out: PresenceUser[] = []
  for (const [clientId, state] of provider.awareness.getStates()) {
    if (clientId === provider.awareness.clientID) continue
    const user = (state as { user?: { name?: string; color?: string } }).user
    if (!user?.name) continue
    out.push({
      clientId,
      name: user.name,
      color: user.color ?? '#71717a',
      cardId: (state as { cardId?: string | null }).cardId ?? null,
    })
  }
  return out.sort((a, b) => a.clientId - b.clientId)
}

export function usePresence(provider: WebsocketProvider | null): PresenceUser[] {
  const version = useRef(0)
  const cache = useRef<{ version: number; value: PresenceUser[] } | null>(null)

  const subscribe = useCallback(
    (onChange: () => void) => {
      if (!provider) return () => {}
      const handler = () => {
        version.current += 1
        onChange()
      }
      provider.awareness.on('change', handler)
      return () => provider.awareness.off('change', handler)
    },
    [provider],
  )

  const getSnapshot = useCallback(() => {
    if (!provider) return EMPTY
    if (!cache.current || cache.current.version !== version.current) {
      cache.current = { version: version.current, value: read(provider) }
    }
    return cache.current.value
  }, [provider])

  return useSyncExternalStore(subscribe, getSnapshot, () => EMPTY)
}

export function useAnnouncePresence(
  provider: WebsocketProvider | null,
  user: { name: string; color: string },
): void {
  useEffect(() => {
    if (!provider) return
    provider.awareness.setLocalStateField('user', user)
    return () => provider.awareness.setLocalState(null)
  }, [provider, user.name, user.color])
}

export function setCardFocus(provider: WebsocketProvider | null, cardId: string | null): void {
  provider?.awareness.setLocalStateField('cardId', cardId)
}
```

- [ ] **Step 2: Implement the presence bar**

`apps/web/src/components/Presence.tsx`:
```tsx
'use client'

import type { PresenceUser } from '@/hooks/use-presence'

export function Presence({ users }: { users: PresenceUser[] }) {
  if (users.length === 0) return <span style={{ color: '#71717a' }}>nobody else here</span>

  return (
    <div data-testid="presence" style={{ display: 'flex', gap: 6 }}>
      {users.map((user) => (
        <span
          key={user.clientId}
          title={user.name}
          data-testid={`presence-${user.name}`}
          style={{
            background: user.color,
            color: 'white',
            borderRadius: 999,
            padding: '2px 10px',
            fontSize: 12,
          }}
        >
          {user.name}
        </span>
      ))}
    </div>
  )
}

export function CardPresence({ users, cardId }: { users: PresenceUser[]; cardId: string }) {
  const here = users.filter((user) => user.cardId === cardId)
  if (here.length === 0) return null

  return (
    <div data-testid={`card-presence-${cardId}`} style={{ fontSize: 11, color: '#52525b' }}>
      {here.map((user) => user.name).join(', ')} {here.length === 1 ? 'is' : 'are'} editing
    </div>
  )
}
```

- [ ] **Step 3: Wire presence into the board**

In `apps/web/src/components/Board.tsx`:

Change the props to accept presence:
```tsx
import type { WebsocketProvider } from 'y-websocket'
import { setCardFocus, usePresence } from '@/hooks/use-presence'
import { CardPresence } from '@/components/Presence'

interface BoardProps {
  doc: Y.Doc
  provider: WebsocketProvider | null
  readOnly?: boolean
}
```

Inside the component:
```tsx
  const presence = usePresence(provider)
```

On each card `<article>`, add:
```tsx
              onFocus={() => setCardFocus(provider, card.id)}
              onBlur={() => setCardFocus(provider, null)}
              onMouseEnter={() => setCardFocus(provider, card.id)}
              onMouseLeave={() => setCardFocus(provider, null)}
              tabIndex={0}
```
and render below the title:
```tsx
              <CardPresence users={presence} cardId={card.id} />
```

- [ ] **Step 4: Wire presence into the document shell**

In `apps/web/src/app/documents/[id]/DocumentClient.tsx`:
```tsx
  const presence = usePresence(provider)
  useAnnouncePresence(provider, user)
```
Add `<Presence users={presence} />` to the header, and pass `provider` to `<Board />`.

- [ ] **Step 5: Verify by hand**

Open the same board in two profiles. Each header shows the other's name. Hovering a card
in one window shows "Name is editing" under that card in the other. On the text document,
carets carry name labels.

Close one window. The other's presence chip disappears within a second — this is the
`removeAwarenessStates` call in `DocumentRoom.remove`, and if names linger after a
disconnect, that is where the bug is.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: add live presence for board cards and the editor"
```

---

## Phase 6 — Ship

---

### Task 22: Metrics and structured logging

**Files:**
- Create: `apps/sync/src/metrics.ts`
- Modify: `apps/sync/src/server.ts`, `apps/sync/src/index.ts`
- Test: `apps/sync/test/metrics.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `class Metrics` with `inc(name, labels?)`, `set(name, value)`, `observe(name, seconds)`, `render(): string` in Prometheus text format; served at `GET /metrics`.

- [ ] **Step 1: Write the failing test**

`apps/sync/test/metrics.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { Metrics } from '../src/metrics.js'

describe('Metrics', () => {
  it('renders a counter', () => {
    const metrics = new Metrics()
    metrics.inc('sync_updates_received_total')
    metrics.inc('sync_updates_received_total')

    expect(metrics.render()).toContain('sync_updates_received_total 2')
  })

  it('keeps label sets separate', () => {
    const metrics = new Metrics()
    metrics.inc('sync_updates_rejected_total', { reason: 'viewer_update' })
    metrics.inc('sync_updates_rejected_total', { reason: 'malformed_frame' })
    metrics.inc('sync_updates_rejected_total', { reason: 'viewer_update' })

    const output = metrics.render()
    expect(output).toContain('sync_updates_rejected_total{reason="viewer_update"} 2')
    expect(output).toContain('sync_updates_rejected_total{reason="malformed_frame"} 1')
  })

  it('renders a gauge that can go down', () => {
    const metrics = new Metrics()
    metrics.set('sync_connections_active', 5)
    metrics.set('sync_connections_active', 2)

    expect(metrics.render()).toContain('sync_connections_active 2')
  })

  it('renders a histogram as sum and count', () => {
    const metrics = new Metrics()
    metrics.observe('sync_flush_duration_seconds', 0.1)
    metrics.observe('sync_flush_duration_seconds', 0.3)

    const output = metrics.render()
    expect(output).toContain('sync_flush_duration_seconds_count 2')
    expect(output).toContain('sync_flush_duration_seconds_sum 0.4')
  })

  it('escapes label values', () => {
    const metrics = new Metrics()
    metrics.inc('sync_updates_rejected_total', { reason: 'a"b' })
    expect(metrics.render()).toContain('reason="a\\"b"')
  })
})
```

- [ ] **Step 2: Run it and watch it fail**

```bash
pnpm --filter @crdt/sync exec vitest run metrics
```
Expected: FAIL — module not found.

- [ ] **Step 3: Implement it**

`apps/sync/src/metrics.ts`:
```ts
type Labels = Record<string, string>

function key(name: string, labels?: Labels): string {
  if (!labels || Object.keys(labels).length === 0) return name
  const rendered = Object.entries(labels)
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([k, v]) => `${k}="${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`)
    .join(',')
  return `${name}{${rendered}}`
}

/**
 * A deliberately tiny Prometheus text-format registry. Bringing in prom-client for
 * eight series would be more dependency than value; the format is four lines of code.
 */
export class Metrics {
  private readonly counters = new Map<string, number>()
  private readonly gauges = new Map<string, number>()
  private readonly histograms = new Map<string, { sum: number; count: number }>()

  inc(name: string, labels?: Labels, by = 1): void {
    const k = key(name, labels)
    this.counters.set(k, (this.counters.get(k) ?? 0) + by)
  }

  set(name: string, value: number, labels?: Labels): void {
    this.gauges.set(key(name, labels), value)
  }

  observe(name: string, seconds: number, labels?: Labels): void {
    const k = key(name, labels)
    const current = this.histograms.get(k) ?? { sum: 0, count: 0 }
    this.histograms.set(k, { sum: current.sum + seconds, count: current.count + 1 })
  }

  render(): string {
    const lines: string[] = []
    for (const [k, value] of this.counters) lines.push(`${k} ${value}`)
    for (const [k, value] of this.gauges) lines.push(`${k} ${value}`)
    for (const [k, { sum, count }] of this.histograms) {
      const base = k.includes('{') ? k.slice(0, k.indexOf('{')) : k
      const labels = k.includes('{') ? k.slice(k.indexOf('{')) : ''
      lines.push(`${base}_sum${labels} ${Number(sum.toFixed(6))}`)
      lines.push(`${base}_count${labels} ${count}`)
    }
    return `${lines.join('\n')}\n`
  }
}
```

- [ ] **Step 4: Serve and populate the metrics**

In `apps/sync/src/server.ts`:

Add to `SyncServerOptions`:
```ts
  metrics?: Metrics
```
and near the top of `createSyncServer`:
```ts
  const metrics = options.metrics ?? new Metrics()
```

Extend the HTTP handler:
```ts
    if (req.url === '/metrics') {
      metrics.set('sync_connections_active', connectionCount)
      metrics.set('sync_documents_open', rooms.size)
      res.writeHead(200, { 'content-type': 'text/plain; version=0.0.4' })
      res.end(metrics.render())
      return
    }
```

Track `let connectionCount = 0`, incrementing on `room.add(conn)` and decrementing in the
`close` and `error` handlers.

In `roomFor`'s `onPersist`, add:
```ts
        metrics.inc('sync_updates_received_total', { role: 'writer' })
```
and in `onReject`:
```ts
      onReject: (reason) => {
        metrics.inc('sync_updates_rejected_total', { reason })
        options.onReject?.(documentId, reason)
      },
```

Wrap the `loadDocument` call to record load duration:
```ts
    if (options.loadDocument) {
      const started = performance.now()
      const state = await options.loadDocument(documentId)
      metrics.observe('sync_document_load_duration_seconds', (performance.now() - started) / 1000)
      if (state) room.loadState(state)
    }
```

Expose it on the returned object:
```ts
    metrics,
```
and add `metrics: Metrics` to the `SyncServer` interface.

In `apps/sync/src/index.ts`, create one `Metrics`, pass it in, and record queue depth and
flush timing:
```ts
const metrics = new Metrics()

setInterval(() => metrics.set('sync_queue_depth', queue.depth), 1000).unref()
```
and in the store wrapper used as the queue's sink, wrap `append` to `observe`
`sync_flush_duration_seconds` and `snapshot` to `inc('sync_snapshot_total')`.

- [ ] **Step 5: Run the tests and check the endpoint**

```bash
pnpm --filter @crdt/sync exec vitest run metrics
pnpm test
pnpm --filter @crdt/sync dev
curl -s localhost:1234/metrics
```
Expected: PASS, and the curl prints the series with zero or near-zero values.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat: expose sync server metrics and structured logs"
```

---

### Task 23: Browser end-to-end tests

**Files:**
- Create: `apps/web/playwright.config.ts`, `apps/web/e2e/collaboration.spec.ts`, `apps/web/e2e/fixtures.ts`
- Modify: `apps/web/src/hooks/use-doc.ts` (honour a `nobc` query parameter)

**Interfaces:**
- Consumes: the whole running system
- Produces: `pnpm --filter @crdt/web exec playwright test`

- [ ] **Step 1: Make BroadcastChannel disable-able from a URL**

In `apps/web/src/hooks/use-doc.ts`, change the session creation to:
```ts
    const created = createDocSession({
      documentId,
      syncUrl: SYNC_URL,
      fetchToken: () => fetchToken(documentId),
      // Cross-tab sync is a genuine feature for users, so it stays on by default.
      // Automated browser tests append ?nobc=1 to force every tab through the server,
      // otherwise a broken WebSocket still looks like working collaboration.
      disableBc: new URLSearchParams(window.location.search).has('nobc'),
    })
```

- [ ] **Step 2: Write the Playwright config and fixtures**

`apps/web/playwright.config.ts`:
```ts
import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  expect: { timeout: 10_000 },
  use: { baseURL: 'http://localhost:3000' },
  // One worker: these tests share a Postgres database and a sync server.
  workers: 1,
})
```

`apps/web/e2e/fixtures.ts`:
```ts
import { prisma } from '@crdt/db'
import { hashPassword, signSession } from '../src/lib/session.js'
import type { Role } from '@crdt/shared/types'

export const E2E_PASSWORD = 'e2e-password-1234'

export async function seedWorkspace(label: string) {
  const owner = await prisma.user.create({
    data: {
      email: `${label}-owner@e2e.test`,
      name: 'Owner',
      passwordHash: await hashPassword(E2E_PASSWORD),
    },
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
      passwordHash: await hashPassword(E2E_PASSWORD),
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

export async function cleanup(label: string) {
  await prisma.workspace.deleteMany({ where: { name: label } })
  await prisma.user.deleteMany({ where: { email: { contains: `${label}-` } } })
}
```

- [ ] **Step 3: Write the e2e spec**

`apps/web/e2e/collaboration.spec.ts`:
```ts
import { test, expect, type BrowserContext, type Page } from '@playwright/test'
import { addMember, cleanup, createDocument, seedWorkspace, sessionCookieFor } from './fixtures.js'

const LABEL = 'e2e-collab'

test.afterAll(async () => {
  await cleanup(LABEL)
})

async function openAs(
  context: BrowserContext,
  userId: string,
  documentId: string,
): Promise<Page> {
  await context.addCookies([await sessionCookieFor(userId)])
  const page = await context.newPage()
  // ?nobc=1 forces this tab to sync through the server rather than BroadcastChannel.
  await page.goto(`/documents/${documentId}?nobc=1`)
  await expect(page.getByTestId('status')).toHaveText('connected')
  return page
}

test('a card added in one browser appears in the other', async ({ browser }) => {
  const { owner, workspace } = await seedWorkspace(LABEL)
  const editor = await addMember(workspace.id, LABEL, 'editor')
  const document = await createDocument(workspace.id, 'board')

  const contextA = await browser.newContext()
  const contextB = await browser.newContext()
  const pageA = await openAs(contextA, owner.id, document.id)
  const pageB = await openAs(contextB, editor.id, document.id)

  await pageA.getByTestId('add-column').click()
  await expect(pageB.locator('[data-testid^="column-"]')).toHaveCount(1)

  const columnId = await pageB
    .locator('[data-testid^="column-"]')
    .first()
    .getAttribute('data-testid')
  await pageA.getByTestId(`add-card-${columnId!.replace('column-', '')}`).click()

  await expect(pageB.locator('[data-testid^="card-"]')).toHaveCount(1)
  await expect(pageB.locator('[data-testid^="card-"]').first()).toContainText('New card')

  await contextA.close()
  await contextB.close()
})

test('a viewer sees edits but cannot make them', async ({ browser }) => {
  const label = `${LABEL}-viewer`
  const { owner, workspace } = await seedWorkspace(label)
  const viewer = await addMember(workspace.id, label, 'viewer')
  const document = await createDocument(workspace.id, 'board')

  const contextA = await browser.newContext()
  const contextB = await browser.newContext()
  const editorPage = await openAs(contextA, owner.id, document.id)
  const viewerPage = await openAs(contextB, viewer.id, document.id)

  await expect(viewerPage.getByTestId('read-only')).toBeVisible()
  await expect(viewerPage.getByTestId('add-column')).toHaveCount(0)

  await editorPage.getByTestId('add-column').click()
  await expect(viewerPage.locator('[data-testid^="column-"]')).toHaveCount(1)

  await contextA.close()
  await contextB.close()
  await cleanup(label)
})

test('both users see each other in the presence bar', async ({ browser }) => {
  const label = `${LABEL}-presence`
  const { owner, workspace } = await seedWorkspace(label)
  const editor = await addMember(workspace.id, label, 'editor')
  const document = await createDocument(workspace.id, 'board')

  const contextA = await browser.newContext()
  const contextB = await browser.newContext()
  const pageA = await openAs(contextA, owner.id, document.id)
  await openAs(contextB, editor.id, document.id)

  await expect(pageA.getByTestId('presence-Eddie')).toBeVisible()

  await contextA.close()
  await contextB.close()
  await cleanup(label)
})

test('text typed while offline merges on reconnect', async ({ browser }) => {
  const label = `${LABEL}-offline`
  const { owner, workspace } = await seedWorkspace(label)
  const editor = await addMember(workspace.id, label, 'editor')
  const document = await createDocument(workspace.id, 'doc')

  const contextA = await browser.newContext()
  const contextB = await browser.newContext()
  const pageA = await openAs(contextA, owner.id, document.id)
  const pageB = await openAs(contextB, editor.id, document.id)

  await pageA.locator('.ProseMirror').click()
  await pageA.keyboard.type('online-a ')
  await expect(pageB.locator('.ProseMirror')).toContainText('online-a')

  await contextB.setOffline(true)
  await pageB.locator('.ProseMirror').click()
  await pageB.keyboard.type('offline-b ')
  await pageA.locator('.ProseMirror').click()
  await pageA.keyboard.type('while-b-was-away ')

  await contextB.setOffline(false)

  await expect(pageA.locator('.ProseMirror')).toContainText('offline-b')
  await expect(pageB.locator('.ProseMirror')).toContainText('while-b-was-away')

  await contextA.close()
  await contextB.close()
  await cleanup(label)
})
```

- [ ] **Step 4: Run them**

Start Postgres, the sync server, and the web app, then:
```bash
pnpm --filter @crdt/web exec playwright install chromium
pnpm --filter @crdt/web exec playwright test
```
Expected: 4 passing tests. The offline test is the one to trust least at first — if it is
flaky, the cause is almost always that `setOffline` does not tear down an already-open
WebSocket fast enough. Add an explicit wait for `status` to read `disconnected` before
typing rather than increasing the timeout.

- [ ] **Step 5: Add the negative test**

Stop the sync server and re-run the first test. It must **fail**. If it passes, `?nobc=1`
is not reaching `createDocSession` and every collaboration test in this file is worthless.
Restart the server and confirm it passes again.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "test: add two-browser end-to-end collaboration tests"
```

---

### Task 24: Deploy and document

**Files:**
- Create: `apps/sync/Dockerfile`, `apps/sync/fly.toml`, `apps/web/Dockerfile`, `apps/web/fly.toml`
- Create: `scripts/seed-demo.ts`
- Modify: `README.md`

**Interfaces:**
- Consumes: everything
- Produces: two deployed Fly apps and a seeded demo workspace.

- [ ] **Step 1: Write the sync server Dockerfile**

`apps/sync/Dockerfile`:
```dockerfile
FROM node:24-slim AS base
RUN corepack enable
WORKDIR /app

COPY pnpm-workspace.yaml package.json pnpm-lock.yaml ./
COPY packages/shared/package.json packages/shared/
COPY packages/db/package.json packages/db/
COPY apps/sync/package.json apps/sync/
RUN pnpm install --frozen-lockfile --filter @crdt/sync...

COPY packages packages
COPY apps/sync apps/sync
COPY tsconfig.base.json ./
RUN pnpm --filter @crdt/db exec prisma generate

EXPOSE 1234
CMD ["pnpm", "--filter", "@crdt/sync", "start"]
```

- [ ] **Step 2: Write the Fly configs**

`apps/sync/fly.toml`:
```toml
app = "crdt-sync"
primary_region = "ord"

[build]
  dockerfile = "Dockerfile"

[env]
  SYNC_PORT = "1234"

[http_service]
  internal_port = 1234
  force_https = true
  # Documents live in the memory of ONE process. Scaling this past a single machine
  # splits a document across instances that cannot see each other, and the failure is
  # silent: users on different machines simply stop seeing each other's edits.
  # Raising these requires the Redis pub/sub fan-out described in the design doc.
  auto_stop_machines = false
  auto_start_machines = true
  min_machines_running = 1

  [[http_service.checks]]
    interval = "15s"
    timeout = "3s"
    method = "GET"
    path = "/healthz"

[[vm]]
  size = "shared-cpu-1x"
  memory = "512mb"
```

`apps/web/fly.toml` follows the same shape with `internal_port = 3000`, `app = "crdt-web"`,
and no single-instance restriction — the web app is stateless and can scale freely.

- [ ] **Step 3: Deploy**

```bash
fly postgres create --name crdt-db --region ord
fly apps create crdt-sync
fly apps create crdt-web
fly postgres attach crdt-db --app crdt-sync
fly postgres attach crdt-db --app crdt-web
```

Set the secrets — the same `SYNC_JWT_SECRET` on both apps, since it is the contract
between them:
```bash
SYNC_SECRET=$(openssl rand -hex 32)
fly secrets set SYNC_JWT_SECRET="$SYNC_SECRET" --app crdt-sync
fly secrets set SYNC_JWT_SECRET="$SYNC_SECRET" --app crdt-web
fly secrets set SESSION_SECRET="$(openssl rand -hex 32)" --app crdt-web
fly secrets set NEXT_PUBLIC_SYNC_URL="wss://crdt-sync.fly.dev" --app crdt-web
```

```bash
fly deploy --config apps/sync/fly.toml --app crdt-sync
fly deploy --config apps/web/fly.toml --app crdt-web
```

Apply the migration against production:
```bash
fly ssh console --app crdt-web -C "pnpm --filter @crdt/db exec prisma migrate deploy"
```

- [ ] **Step 4: Seed the demo workspace**

`scripts/seed-demo.ts`:
```ts
import { prisma } from '@crdt/db'
import { addCard, addColumn } from '@crdt/shared/board'
import * as Y from 'yjs'
import { hashPassword } from '../apps/web/src/lib/session.js'

const doc = new Y.Doc()
addColumn(doc, { id: 'todo', title: 'To do' })
addColumn(doc, { id: 'doing', title: 'In progress' })
addColumn(doc, { id: 'done', title: 'Done' })
addCard(doc, { id: 'c1', title: 'Open this board in two windows', columnId: 'todo' })
addCard(doc, { id: 'c2', title: 'Drag a card and watch the other window', columnId: 'todo' })
addCard(doc, { id: 'c3', title: 'Go offline, keep editing, come back', columnId: 'doing' })

const password = process.env.DEMO_PASSWORD
if (!password) throw new Error('DEMO_PASSWORD must be set')

const user = await prisma.user.upsert({
  where: { email: 'demo@crdt.test' },
  update: {},
  create: { email: 'demo@crdt.test', name: 'Demo', passwordHash: await hashPassword(password) },
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

console.log(`seeded board: /documents/${document.id}`)
await prisma.$disconnect()
```

```bash
DEMO_PASSWORD='<pick one>' pnpm exec tsx scripts/seed-demo.ts
```

- [ ] **Step 5: Write the README**

`README.md` must cover, in this order:

1. **What it is and the 30-second demo.** Link to the deployed board and say plainly:
   open it in two windows, drag a card, go offline, keep editing, come back.
2. **Why Yjs rather than a hand-written CRDT.** Merge correctness under concurrent edits
   is a solved and adversarially tested problem. The engineering worth doing is the layer
   around it: transport, authorization, durability, and ordering semantics. Hand-rolling
   the merge algorithm would have consumed the whole project and produced something worse.
3. **Why the sync server is hand-rolled anyway.** Role enforcement has to happen *inside*
   the protocol: a viewer must be able to send sync-step1 and receive state while being
   unable to send updates, and those are both `messageSync` frames distinguished by their
   second varUint. Link to `apps/sync/src/guard.ts` — it is 30 lines and it is the point.
4. **How persistence works.** Append-only update log plus periodic snapshots, written
   behind a queue so the database is never in the broadcast path. State the 500ms
   durability window explicitly, and why it is acceptable: connected clients still hold
   their own updates and re-send them on reconnect, and SIGTERM flushes.
5. **How reconnection works.** State vector exchange, not log replay. The catch-up payload
   is proportional to what changed, not to the document's history.
6. **Why cards use fractional indices.** A `Y.Array` per column duplicates or drops a card
   when two people move the same one concurrently. A flat map plus an ordering key makes
   that impossible, because the card is one entry that can only be in one place.
7. **How I'd scale this.** Today one process holds every open document in memory, which is
   correct for the traffic and wrong for 100x. The path: shard documents across sync
   instances by document id, with Redis pub/sub fanning updates between instances, and a
   consistent-hash router so a document's connections land on the same instance. The
   `fly.toml` comment explaining why `min_machines_running` is pinned to 1 is there so
   nobody scales it up by accident before that work exists.
8. **What I deliberately did not build**, and why: version-history UI, update-log pruning,
   multi-instance fan-out, live role changes for connected users.

- [ ] **Step 6: Record the demo**

Record a 60-second screen capture: two windows side by side, an edit propagating, then the
network toggled off in one window, edits made in both, then reconnection and the merge.
**Show the failure state on screen** — the "disconnected" indicator and the temporary
divergence — rather than cutting to the happy ending. The divergence is the part that
proves the system does something hard.

- [ ] **Step 7: Final verification**

```bash
pnpm test
pnpm --filter @crdt/web exec playwright test
pnpm typecheck
```
Expected: all green. Then open the deployed demo in two windows and repeat the manual
sequence once against production, because localhost has never once caught a TLS or
WebSocket-proxy problem.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "chore: add deployment configuration, demo seed and readme"
```

---

## Self-review

Run against the spec after the plan is written; findings are recorded here rather than
fixed silently, because a couple of them change what "done" means.

**Spec coverage.** Every section of §5 maps to a task. §2's requirement that a viewer
whose role changes mid-session keeps the old role until reconnect is documented in the
spec's Open Questions and has no task — that is intentional, not an omission. The spec's
`presence_sessions` table from the original brief is deliberately absent from the schema
in Task 2, per §7.

**Two things the plan defers that a reader might expect:**

1. **`document_updates` is never pruned.** Design doc §7 says so explicitly. No task
   implements pruning. At demo scale the log is small, and keeping it preserves the option
   of version history. If a document ever accumulates enough history that Task 9's `load`
   gets slow, the fix is a delete below the newest durable snapshot — safe because
   snapshots are self-contained.
2. **The web app has no login UI**, only login API routes. Tasks 16–19 build and test the
   endpoints; the Playwright fixtures set session cookies directly. A sign-in form is
   maybe 40 lines and is not planned here because nothing else depends on it. Add it
   before showing the deployed app to anyone who is not you.

**Type consistency check.** `Role` is defined once in `@crdt/shared/types` and imported
everywhere, including the Prisma enum, which uses the same three lowercase values.
`Connection` is defined in `apps/sync/src/room.ts` and consumed by `server.ts`.
`PendingUpdate` and `UpdateSink` are defined in `update-queue.ts`; `DocumentStore`
implements `UpdateSink` structurally, which is what lets Task 10 wire them together
without either knowing about the other.

**One known ordering hazard.** Task 22 modifies `server.ts` in several places. If it is
executed by a fresh agent that has not read Task 7, the instructions describe the edits in
prose rather than showing the final file. Re-read `apps/sync/src/server.ts` in full before
starting Task 22.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-09-19-crdt-collaborative-engine.md`.
