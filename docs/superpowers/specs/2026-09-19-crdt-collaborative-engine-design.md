# CRDT Collaborative Engine — Technical Design

**Status:** Approved for planning
**Date:** 2026-09-19
**Author:** Dhanush Chandra Shekar
**Source brief:** `docs/project-description.md`

---

## 1. Problem

Two people editing the same kanban board or document today, in a naive app, means
last-write-wins. One person's work silently disappears. The same is true of a single
person on a flaky connection: edits made offline are either lost or overwrite whatever
happened while they were gone.

Concretely, the system must satisfy this statement:

> Two users editing the same board — one of them offline for five minutes — both see
> every edit from both sessions within 200ms of the offline user reconnecting, with no
> edit lost, no card duplicated, and no card left in two columns.

That is the whole problem. Everything else in this document exists to make that true and
to make it observable.

### Who the user is

Two audiences, and they want different things:

1. **The demo viewer** (a hiring manager, an interviewer) who opens two browser tabs,
   types in one, sees it in the other, kills the network in one, keeps typing, restores
   it, and watches the merge. They need the failure to be *visible and survivable*.
2. **A small team** (2–10 people) using it as a real lightweight workspace. They need
   auth, roles, and their data to survive a server restart.

### Success criteria

| Criterion | Measure |
|---|---|
| Propagation latency | p95 < 200ms local-network client-to-client |
| Offline merge | 5-minute offline session with 100+ local edits merges with zero loss |
| Durability | `kill -9` the sync server; at most the last 500ms of updates lost; clients resync the rest automatically |
| Load time | A document with 10,000 historical updates loads in < 1s (via snapshot) |
| Access control | A `viewer`'s update never reaches another client and never reaches Postgres |
| Board convergence | Two concurrent moves of the same card converge to one deterministic position on every replica |

### Explicitly out of scope

- Operational Transform, or any hand-written CRDT algorithm. Yjs is the merge engine.
- Multi-instance sync-server scale-out. Designed for, not built (see §10).
- Comments, mentions, notifications, file uploads, rich media embeds.
- Mobile apps or responsive polish beyond "not broken on a laptop."
- Version-history scrubbing UI. The data model supports it; the UI is cut from v1.
- SSO, SAML, password reset emails, email verification.
- Undo/redo beyond what Yjs `UndoManager` gives for free in the text editor.

---

## 2. Requirements

### Happy path

1. User signs up, lands in a workspace they own.
2. Creates a board. Adds columns and cards. Drags a card between columns.
3. Invites a second user as `editor`. Both open the board.
4. Either user's edit appears on the other's screen in under 200ms.
5. Each sees the other's avatar, and which card the other is focused on.
6. Either user closes their laptop, edits offline, reopens. Everything merges.

### Edge cases that must be handled

| Case | Required behavior |
|---|---|
| Two users drag the same card to different columns simultaneously | Both replicas converge on the same column and position. Card is never duplicated, never orphaned. |
| Two users insert a card at the same position | Both cards exist, in a deterministic order, on every replica. |
| A user is offline for longer than their doc token's lifetime | Reconnect mints a fresh token transparently; the user sees no interruption. |
| A document has never been opened before | Server creates an empty Y.Doc, no error. |
| A user opens the same document in two tabs | Both tabs sync. Tests must disable the cross-tab BroadcastChannel or they pass without the server. |
| A `viewer` has the board open when their role is changed to `editor` | Takes effect on their next connect. Documented, not live-upgraded. |
| Update arrives for a document the sender is not a member of | Connection closed 4403 before any state is sent. |

### Failure cases

| Failure | Required behavior |
|---|---|
| Sync server unreachable | Client keeps working fully offline against its local Y.Doc, shows a "reconnecting" indicator, retries with exponential backoff. |
| Postgres unreachable | Sync and broadcast continue. Persistence queue buffers, retries, and logs loudly. If the buffer exceeds 10,000 updates, the server sheds by forcing a snapshot attempt and alerting. |
| Sync server crashes mid-session | Up to 500ms of updates lost from Postgres. Every connected client still holds them and re-sends on reconnect, so the true data loss window is only "updates from a client that also disappeared." |
| Malformed binary frame | Log, close that connection 4500, never let it take down the room. |
| A client floods updates | Per-connection rate limit; exceeding it closes 4429. |

### Permissions and security

- Three roles per workspace: `owner`, `editor`, `viewer`.
- `viewer` may read document state and publish awareness (cursor/presence), but may not
  mutate the document. Enforced **at the sync server relay**, not in the UI.
- `editor` may read and write documents. `owner` additionally manages membership.
- The sync server is a separate process from the Next.js app and does not share a session
  store. Authorization crosses that boundary as a short-lived signed token, not a session
  cookie.

### Performance and scale expectations

- Target: 10 concurrent documents, 5 concurrent editors each, ~50 updates/sec aggregate.
  This is a demo-and-small-team system; these numbers are two orders of magnitude below
  where the single-process design breaks.
- Memory: each open document holds its full Y.Doc in server memory. A large text document
  is on the order of 1MB. Documents are evicted 30 seconds after the last client leaves.
- Postgres writes are batched, never per-keystroke.

### Compatibility

Greenfield. No backwards compatibility burden. The one forward-compatibility decision:
the wire protocol is the standard Yjs sync protocol (`y-protocols`), so any standard
`y-websocket` client can talk to this server, and this server could later be swapped for
Hocuspocus without touching a line of client code.

---

## 3. Current system

There isn't one. `/Users/dhanush/Desktop/Projects/CRDT` contains only
`docs/project-description.md`. Every file in this design is new.

This is worth stating plainly because it changes the risk profile: there is no existing
abstraction to reuse and no legacy behavior to preserve, but also no guardrails. The
design compensates by putting the two genuinely hard pieces — the wire protocol and the
ordering algorithm — behind small, pure, heavily unit-tested modules that never touch a
socket or a database.

---

## 4. Constraints

| Constraint | Value | Consequence |
|---|---|---|
| Deadline | None hard; this is portfolio and interview material | Favor explainability over cleverness. Every non-obvious line must be defensible out loud. |
| Traffic | Demo scale (see §2) | Single sync instance is correct. Building for scale now would be YAGNI. |
| Stack | TypeScript end to end, Node, Postgres, Next.js | Already decided in the brief. |
| Hosting | Fly.io | Requires persistent WebSocket connections, so the sync server cannot be a serverless function. Two Fly apps, one Postgres. |
| Cost | Hobby tier | Single small VM per app, smallest Postgres. Rules out Redis for v1 — presence lives in memory. |
| Library policy | Do not hand-roll CRDT math | Yjs owns merge correctness. The project owns transport, persistence, authorization, and ordering semantics. |
| Sync server | Hand-rolled on `y-protocols`, not Hocuspocus | ~400 lines owned outright. Buys the ability to enforce roles mid-protocol, which a library hook cannot do as precisely. Costs protocol-bug risk, mitigated by integration tests against real clients. |

---

## 5. Proposed design

```text
          Browser tab A                         Browser tab B
     ┌──────────────────────┐             ┌──────────────────────┐
     │ Next.js page         │             │ Next.js page         │
     │  ├─ Tiptap  ──┐      │             │  ├─ Tiptap  ──┐      │
     │  ├─ Board UI ─┤      │             │  ├─ Board UI ─┤      │
     │  └─ Presence ─┤      │             │  └─ Presence ─┤      │
     │        ┌──────▼────┐ │             │        ┌──────▼────┐ │
     │        │  Y.Doc    │ │             │        │  Y.Doc    │ │
     │        │ Awareness │ │             │        │ Awareness │ │
     │        └──────┬────┘ │             │        └──────┬────┘ │
     └───────────────┼──────┘             └───────────────┼──────┘
                     │ WebsocketProvider                  │
                     │ ?token=<doc JWT>                   │
                     └──────────────┬─────────────────────┘
                                    │  binary Yjs frames
                    ┌───────────────▼────────────────────────┐
                    │        Sync server (Node + ws)         │
                    │                                        │
                    │  verifyDocToken ──► role on connection │
                    │         │                              │
                    │         ▼                              │
                    │  guard(role, msg) ──► reject writes    │
                    │         │             from viewers     │
                    │         ▼                              │
                    │  DocumentRoom (Y.Doc + Awareness)      │
                    │     ├─ broadcast to peers  (sync path) │
                    │     └─ UpdateQueue         (async path)│
                    └───────────────┬────────────────────────┘
                                    │ batched every 500ms / 64 updates
                    ┌───────────────▼────────────────────────┐
                    │  Postgres                              │
                    │   document_updates   (append-only log)  │
                    │   document_snapshots (compacted state)  │
                    └────────────────────────────────────────┘

    Next.js API (separate process, same Postgres)
      /api/auth/*         session cookie (jose HS256)
      /api/workspaces/*   membership CRUD
      /api/documents/:id/token  ──► mints the short-lived doc JWT above
```

### The one idea that makes this work

**Broadcast and persistence are on different paths.** An incoming update is relayed to
peers synchronously — that is the 200ms budget — and handed to an in-memory queue that
writes to Postgres on its own schedule. A slow or dead database cannot slow down or stop
collaboration. The cost is a small, bounded, well-understood durability window, which §9
addresses head-on.

### Components

Each is a separate module with one job, and the two hardest ones are pure functions with
no I/O.

| Component | Responsibility | Depends on |
|---|---|---|
| `packages/shared/fractional-index` | Generate an ordering key strictly between two keys. Pure. | nothing |
| `packages/shared/board` | Board operations expressed as Y.Doc mutations. | `yjs` |
| `packages/shared/doc-token` | Sign and verify the short-lived document JWT. | `jose` |
| `apps/sync/protocol` | Encode/decode Yjs wire frames; peek a frame's type without consuming it. | `y-protocols`, `lib0` |
| `apps/sync/guard` | Given a role and a decoded frame type, allow or deny. Pure. | `protocol` |
| `apps/sync/room` | One open document: Y.Doc, Awareness, connections, broadcast. | `yjs`, `protocol` |
| `apps/sync/update-queue` | Write-behind buffer with flush-on-timer and flush-on-size. | a sink interface |
| `apps/sync/store` | Load a document from snapshot + log; append updates; compact. | `@prisma/client` |
| `apps/sync/server` | HTTP upgrade, token verification, wiring the above. | all of the above |
| `apps/web` | Next.js UI, auth routes, workspace/document REST. | `packages/db`, `packages/shared` |

### Data flow: a keystroke

1. User types. Tiptap mutates the local `Y.Doc`. **UI updates immediately** — no network
   in this path.
2. The Y.Doc emits an `update` event with a binary delta (tens of bytes).
3. `WebsocketProvider` wraps it as `[messageSync, messageYjsUpdate, <delta>]` and sends.
4. Server reads the first varUint, sees `messageSync`; peeks the second, sees
   `messageYjsUpdate`; asks `guard(role, ...)`. A `viewer` stops here.
5. Server applies the delta to the room's server-side Y.Doc with `origin = connection`.
6. The room's `update` observer broadcasts the delta to every connection **except** the
   originator, and enqueues it.
7. `UpdateQueue` buffers. On 500ms elapsed or 64 updates, it batch-inserts into
   `document_updates` and, if the un-snapshotted count crosses 100, writes a snapshot.
8. Peer clients apply the delta to their local Y.Docs. Tiptap re-renders.

### Data flow: a reconnect after 5 minutes offline

1. Client's local Y.Doc has diverged. It holds every offline edit.
2. Provider reconnects with a fresh token, sends **SyncStep1** — its state vector, not its
   data. This is the point: the client says what it *has*, not what it *did*.
3. Server replies **SyncStep2** with exactly the updates the client is missing, then its
   own **SyncStep1**.
4. Client replies **SyncStep2** with exactly what the server is missing — the offline
   edits.
5. Both sides now hold the union. Yjs's merge guarantees make the result identical on
   every replica regardless of arrival order.

The catch-up payload is proportional to what changed, not to the document's history. This
is why the server must hold the *current* Y.Doc rather than a log it replays per request,
and why snapshots exist.

### Ordering: why cards need fractional indices

The obvious kanban model — a `Y.Array` of card ids per column — breaks under concurrent
moves. Moving a card between columns is a delete from one array plus an insert into
another. Two users moving the same card to two different columns concurrently produces two
deletes and two inserts, and the card ends up duplicated or gone.

Instead, a card is one entry in a single `Y.Map`, and it carries where it lives:

```text
ydoc.getMap('board')
  ├─ columns    : Y.Map<Y.Map>   columnId -> { title, order }
  └─ cards      : Y.Map<Y.Map>   cardId   -> { title, columnId, order }
```

A move is a mutation of two fields on one map entry. Concurrent moves are concurrent
writes to the same map keys, which Yjs resolves deterministically by client id — one wins,
globally, on every replica. The card cannot duplicate, because there was only ever one
entry.

`order` is a fractional index: a short string over `0-9A-Za-z`, where "between `a` and `b`"
is always expressible without renumbering neighbors. Inserting between two cards touches
only the inserted card. Ties (two clients generating the same key concurrently) break on
card id, which is deterministic everywhere.

### Error handling

| Layer | Strategy |
|---|---|
| Wire frame | Every frame decode is wrapped. A malformed frame closes that one connection (4500) and is logged with the doc id and first 32 bytes, hex. It never throws into the room. |
| Room | An update that fails to apply is logged and dropped. The room survives. Clients resync on their next SyncStep1. |
| Queue | Postgres errors retry with exponential backoff, keeping the batch. Depth is a metric; above 10,000 it logs at `error` and forces a snapshot attempt. |
| API | Zod-validated request bodies; `400` on shape, `401` unauthenticated, `403` unauthorized, `404` for a resource the caller may not see (never `403`, which would leak existence). |
| Client | Provider reconnects with exponential backoff, capped. Close codes 4400–4499 are permanent (y-websocket default) and surface a real error in the UI instead of an infinite retry loop. |

### Caching

None in v1, deliberately. The open Y.Doc in server memory *is* the cache — it is the
reason catch-up does not replay history. Adding Redis before there is a second server
instance would be infrastructure with no consumer.

### Retry strategy

| Path | Policy |
|---|---|
| Client → server socket | Exponential backoff to a 2.5s ceiling, unless the close code is 4400–4499. |
| Doc token fetch | 3 attempts, then surface "cannot reach server" in the UI. |
| Queue → Postgres | Exponential backoff from 100ms to 10s, unbounded attempts, batch preserved. |
| Snapshot write | Best-effort. Failure is logged, not retried; the next threshold crossing tries again. |

---

## 6. API changes

All new. `apps/web` serves REST; `apps/sync` serves only the WebSocket.

### REST (Next.js route handlers)

```text
POST   /api/auth/signup     {email, password, name}   201 {id, email, name} + Set-Cookie
POST   /api/auth/login      {email, password}         200 {id, email, name} + Set-Cookie
POST   /api/auth/logout                               204
GET    /api/me                                        200 {id, email, name}

GET    /api/workspaces                                200 [{id, name, role}]
POST   /api/workspaces      {name}                    201 {id, name}          caller becomes owner
POST   /api/workspaces/:id/members  {email, role}     201 {userId, role}      owner only
DELETE /api/workspaces/:id/members/:userId            204                     owner only

GET    /api/workspaces/:id/documents                  200 [{id, title, type}]
POST   /api/workspaces/:id/documents {title, type}    201 {id, title, type}   editor+

POST   /api/documents/:id/token                       200 {token, expiresAt, role}
```

### The doc token

The contract between the two processes. Signed HS256 with `SYNC_JWT_SECRET`, shared by
both and by nothing else.

```jsonc
{
  "sub":  "usr_...",            // user id
  "docId":"doc_...",            // this token authorizes exactly one document
  "role": "editor",             // owner | editor | viewer
  "name": "Dhanush",            // for presence, so the sync server never queries users
  "color":"#e11d48",
  "iat":  1758240000,
  "exp":  1758240900            // 15 minutes
}
```

Three properties worth defending:

- **Scoped to one document.** A stolen token cannot be replayed against another document.
- **Short-lived.** Revoking access takes effect within 15 minutes without the sync server
  needing a revocation list or a database read on every frame.
- **Carries display identity.** The sync server never touches the `users` table, so it can
  keep running when the web app is down.

### WebSocket

```text
wss://<sync-host>/<documentId>?token=<jwt>
```

Binary frames only, standard Yjs sync protocol. Close codes:

| Code | Meaning | Client retries? |
|---|---|---|
| 4401 | Missing, malformed, or expired token | No (permanent range) |
| 4403 | Token valid but `docId` does not match the URL | No |
| 4429 | Rate limit exceeded | No |
| 4500 | Server-side frame handling error | Yes |
| 1011 | Unhandled server error | Yes |

---

## 7. Data model

Postgres via Prisma. Binary columns are `bytea`.

```prisma
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

enum Role { owner editor viewer }

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

enum DocumentType { doc board }

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
  id               BigInt   @id @default(autoincrement())
  documentId       String
  state            Bytes
  throughUpdateId  BigInt
  snapshotAt       DateTime @default(now())
  document         Document @relation(fields: [documentId], references: [id], onDelete: Cascade)

  @@index([documentId, id])
}
```

### Why `throughUpdateId` exists

It is the only non-obvious column. Loading a document is:

```sql
-- latest snapshot
SELECT state, through_update_id FROM document_snapshots
 WHERE document_id = $1 ORDER BY id DESC LIMIT 1;

-- everything the snapshot does not already contain
SELECT update FROM document_updates
 WHERE document_id = $1 AND id > $2 ORDER BY id ASC;
```

Without it, you cannot tell which updates a snapshot already includes, so you either
re-apply everything (correct but slow, and it defeats the point) or guess by timestamp
(a race waiting to happen). `BigInt` autoincrement gives a total order that timestamps do
not.

Applying an update twice is harmless — Yjs updates are idempotent — so the boundary is a
performance concern, not a correctness one. That is a useful thing to be able to say.

### Retention

`document_updates` grows without bound in v1. Once a snapshot with
`through_update_id = N` is durable, every update with `id <= N` is redundant and could be
pruned. Not implemented in v1, deliberately: keeping them means version history and audit
remain possible later, and at demo scale the storage is trivial. Noted as a known
unbounded growth path rather than left as a surprise.

### Presence

Not in Postgres. Awareness state lives in the sync server's memory and dies with the
connection, which is correct — a cursor position has no meaning after its owner
disconnects. The brief's `presence_sessions` table is intentionally dropped; persisting
ephemeral state would be a real design error, not a simplification.

---

## 8. Alternatives considered

### A. Sync server: hand-rolled vs Hocuspocus

```text
Option A: Hocuspocus                    Option B: hand-rolled on y-protocols  ← CHOSEN
+ onAuthenticate / onStoreDocument      + role enforcement can inspect the frame type
  hooks work on day one                   mid-protocol, allowing SyncStep1 from a viewer
+ battle-tested protocol handling         while rejecting their Updates
+ less code to maintain                 + the write-behind queue is ours to tune
- authorization granularity is the      + ~400 lines that are entirely explainable
  hook's, not ours: "can this user      - protocol bugs are now our bugs
  write" is per-connection, not         - more integration tests needed to compensate
  per-frame
- the interesting mechanism is
  inside the library
```

Chosen B. The decisive factor is requirement-driven, not preference: a `viewer` must be
able to *receive* state while being unable to *send* it, and in the Yjs protocol both are
`messageSync` frames distinguished only by their second varUint. Enforcing that correctly
means reading the frame. The interview value is real but secondary.

Risk accepted: protocol bugs. Mitigated by testing the server against real `y-websocket`
clients rather than against our own encoder, so a symmetric misunderstanding of the
protocol cannot pass the tests.

### B. Persistence: synchronous vs write-behind

```text
Option A: write to Postgres in the      Option B: write-behind queue        ← CHOSEN
request path, then broadcast
+ zero durability window                + broadcast latency independent of the database
+ trivially simple                      + batched inserts, ~64x fewer round trips
- every keystroke is a round trip       + a Postgres outage degrades durability, not
- p95 latency becomes Postgres p95        collaboration
- a slow database stops collaboration   - up to 500ms of updates lost on a hard crash
  entirely                              - more moving parts to reason about
```

Chosen B, and §9 treats the durability window as a first-class scenario rather than
hiding it. The window is defensible precisely because CRDT clients hold their own state:
a lost update is only truly lost if the client that authored it also vanished.

### C. Card ordering: Y.Array per column vs fractional index in a flat Y.Map

```text
Option A: Y.Array<cardId> per column    Option B: flat Y.Map + fractional index  ← CHOSEN
+ order is explicit and obvious         + a card is exactly one map entry, so it cannot
+ no index algorithm to write             duplicate or vanish under concurrent moves
- a cross-column move is delete+insert  + insert touches one card, not its neighbors
  across two arrays, not atomic         + moves are plain field writes, resolved by Yjs
- concurrent moves of one card can      - fractional index generation must be written
  duplicate it or drop it                 and tested (~60 lines)
- renumbering on insert touches         - ordering keys grow slowly under repeated
  neighbors                               midpoint insertion at the same spot
```

Chosen B. Option A fails the stated success criterion "no card left in two columns" under
exactly the scenario the demo is built to show.

### D. Auth: Auth.js v5 vs hand-rolled jose sessions

Auth.js v5 is still `5.0.0-beta.32` as of 2026-09. It would also need a second mechanism
to get identity across to the sync server, since that process has no session store.
Hand-rolled is `jose` + `node:crypto` scrypt, roughly 80 lines, and it makes both token
types — session cookie and doc token — the same library and the same mental model. Chosen
hand-rolled. If this became a product, Auth.js or a hosted provider is the right answer;
the boundary is small enough to swap.

### E. Drag and drop: `@dnd-kit` vs native HTML5

`@dnd-kit/core`'s last release was 2024-12 and React 19 support is uncertain. Native HTML5
`dragstart`/`dragover`/`drop` is about 40 lines for a board, has no dependency, and keeps
the attention on the CRDT move operation, which is the part worth showing. Chosen native.

---

## 9. Failure scenarios

The questions a design review actually asks.

### "What happens if the sync server is down?"

Clients keep editing. The local Y.Doc is the source of truth for the UI, so the editor
never blocks. The provider retries with exponential backoff and the UI shows a
"reconnecting" badge. On recovery, SyncStep1/SyncStep2 reconciles everything. This is the
same code path as the offline case, which means the offline path gets exercised constantly
rather than only in a demo.

### "What happens if Postgres is down?"

Collaboration is unaffected — it is not in the broadcast path. `UpdateQueue` retains its
batch and retries with backoff. Queue depth is exported as a metric and logged at `error`
past 10,000. Documents already in memory keep working; documents *not* yet loaded cannot
be opened, and that request fails with a clear error rather than serving an empty document,
which would look like data loss to the user.

### "You lose 500ms of writes on a crash. Defend that."

Three parts:

1. **The window is bounded and chosen.** 500ms / 64 updates, both configurable.
2. **A connected client still holds every update it authored.** On reconnect its SyncStep1
   reveals the gap and it re-sends. Real loss requires the server and the authoring client
   to fail within the same 500ms.
3. **`SIGTERM` flushes.** Planned restarts and deploys lose nothing; only `kill -9` and
   hardware failure hit the window.

If that trade were unacceptable — regulated data, financial records — the answer is not to
tune the window, it is to make the write synchronous and accept the latency. It is a
requirements decision, not a tuning knob.

### "Why a new table instead of one?"

`document_updates` and `document_snapshots` have different write rates (high, continuous
vs low, periodic), different sizes (bytes vs kilobytes-to-megabytes), and different
lifecycles (prunable vs retained). Merging them would mean a single table where 99% of rows
are tiny and 1% are large, and every load would scan past the small ones to find the large
one. This is event sourcing with snapshotting, and the split is the standard shape.

### "What happens at 10x traffic?"

10x demo scale (roughly 500 updates/sec, 50 documents) still fits one Node process — the
work per update is a Yjs apply plus N buffer writes. The first thing to break is memory, as
open documents accumulate, which the 30-second eviction addresses. At 100x, the single
process is the wall, and §10 is the answer. The honest version: this is not built for 100x,
and building it for 100x now would be speculative work with no user.

### "How do you roll back?"

Web and sync deploy independently. The wire protocol is standard and unversioned in v1, so
a sync-server rollback is `fly deploy --image <previous>` with no client coordination. The
one-way door is the Prisma migration: migrations are additive only (no column drops in
v1), so an older server runs against a newer schema. Rolling back a migration is a manual,
documented operation, not something a deploy does.

### "What happens to old clients?"

There are none in v1. The forward plan, if the frame format ever changes: the doc token
already carries a claim slot for a protocol version, so the server can branch on it and
support both for one release. Noted, not built.

### "Two users move the same card at the same instant. Walk me through it."

Both clients write `columnId` and `order` on the same `Y.Map` entry. Yjs resolves
concurrent writes to the same key by client id — deterministic and identical on every
replica, including the server's. One user sees their card jump to the other's column a
moment later. Nothing duplicates, nothing is lost, and there is no server round trip in the
decision. This is the scenario to demo on purpose.

---

## 10. Security considerations

| Concern | Treatment |
|---|---|
| Authorization across process boundaries | Short-lived, document-scoped HS256 JWT. The sync server trusts the token, never the client's claims about itself. |
| Role enforcement | At the relay, per frame. The UI also hides write controls from viewers, but that is convenience, not security. |
| Token in a query string | Accepted for v1 and noted: query strings land in access logs. Mitigated by a 15-minute TTL and single-document scope. The better fix — a `Sec-WebSocket-Protocol` header token — is listed in Open Questions. |
| Password storage | `node:crypto` `scrypt`, per-user random salt, constant-time comparison. |
| Session cookie | `httpOnly`, `secure`, `sameSite=lax`, 7 days. |
| Existence leaking | A document the caller cannot see returns `404`, not `403`. |
| Input validation | Zod at every route boundary. Binary frames are length-checked before decode. |
| Denial of service | Per-connection update rate limit and a max frame size. A single client cannot exhaust the room. |
| Secrets | `SYNC_JWT_SECRET` and `SESSION_SECRET` are distinct, from the environment, never committed. A startup check refuses to boot on a missing or default secret. |
| Dependency surface | The sync server's runtime dependencies are `ws`, `yjs`, `y-protocols`, `lib0`, `jose`, `@prisma/client`. Deliberately small. |

---

## 11. Rollout plan

Each phase leaves the system in a working, demoable state. That is the point of the
ordering — there is no phase whose failure leaves a half-built system.

```text
Phase 1  Sync core            two Y.Docs converge through a real server        ← demoable
Phase 2  Persistence          state survives a server restart                  ← demoable
Phase 3  Board + editor       kanban and rich text, still no auth              ← demoable
Phase 4  Auth + roles         viewer writes rejected at the relay              ← demoable
Phase 5  Presence             avatars and live cursors                         ← demoable
Phase 6  Ship                 metrics, e2e, Fly deploy, seeded demo workspace
```

Deployment sequence, once there is something to deploy:

```text
local (docker compose postgres)
    ↓
CI: unit + integration against ephemeral Postgres
    ↓
Fly staging: web app + sync app + Postgres
    ↓
seed demo workspace, two-tab smoke test by hand
    ↓
Fly production (same config, separate app)
```

Rollback at every step is redeploying the previous image. The sync server is pinned to
`count = 1`; scaling it up without the coordination in §12 would split documents across
instances that cannot see each other, which is a silent correctness failure rather than a
loud one. This is called out in the Fly config as a comment, because it is exactly the kind
of thing someone "helpfully" changes later.

---

## 12. Testing plan

```text
unit (vitest, no I/O)
  fractional index    · ordering, midpoints, ties, deep nesting
  board operations    · two Y.Docs, concurrent moves, convergence
  doc token           · sign, verify, expiry, wrong secret, wrong doc
  guard               · role × frame type matrix
  update queue        · flush on size, flush on timer, retry, ordering
      ↓
integration (vitest, real ws server + real Postgres)
  two real y-websocket clients converge
  offline client reconnects and catches up
  viewer's update is rejected, never reaches a peer, never reaches Postgres
  server restart: state reloads from snapshot + log
  snapshot compaction fires at threshold and load takes the fast path
      ↓
e2e (playwright, two browser contexts)
  type in tab A, assert in tab B
  drag a card in A, assert its column in B
  go offline in A, edit, come back, assert convergence
      ↓
manual smoke on staging (the two-tab demo, by hand)
```

**The trap that must be written down:** `y-websocket`'s `WebsocketProvider` syncs across
tabs of the same origin over `BroadcastChannel` by default. A two-tab test will pass with
the sync server stopped. Every Playwright test and every browser-based check must pass
`disableBc: true`, and there is a deliberate negative test that stops the server and
asserts the tabs *stop* converging.

Definition of done for a task: its tests pass, the full suite passes, and the change is
committed.

---

## 13. Monitoring

The sync server exposes `/healthz` (liveness) and `/metrics` (Prometheus text format).
Logs are structured JSON to stdout, which is what Fly collects.

| Metric | Type | Why it matters |
|---|---|---|
| `sync_connections_active` | gauge | Sessions. Sudden drop to zero means the server, not the users. |
| `sync_documents_open` | gauge | Memory proxy. Should return to ~0 when idle; if it does not, eviction is broken. |
| `sync_updates_received_total{role}` | counter | Throughput, split by role. |
| `sync_updates_rejected_total{reason}` | counter | Viewer writes, rate limits, malformed frames. A spike means a UI bug or an attack. |
| `sync_queue_depth` | gauge | The durability alarm. Sustained growth means Postgres is failing. |
| `sync_flush_duration_seconds` | histogram | Database write health. |
| `sync_snapshot_total` | counter | Compaction is actually running. |
| `sync_document_load_duration_seconds` | histogram | The thing snapshots exist to keep low. |

Success indicators after deploy: `sync_queue_depth` returns to 0 between flushes,
`sync_document_load_duration_seconds` p95 stays under 1s, `sync_updates_rejected_total`
stays flat except during the deliberate viewer demo.

Failure indicators that mean roll back: queue depth monotonically rising, load duration
growing with document age (means snapshots are not being used), or connections churning
(means tokens or close codes are wrong).

---

## 14. Open questions

1. **Token transport.** Query string is logged by proxies. Moving to
   `Sec-WebSocket-Protocol` is strictly better but has rougher browser ergonomics. Revisit
   after Phase 4, when there is something to measure.
2. **Update log retention.** Pruning below the newest durable snapshot is safe and
   unbuilt. Decide once a document exists with enough history to make the query slow.
3. **Awareness for viewers.** Currently allowed — a viewer's cursor is visible to editors.
   Defensible either way; flagged so it is a decision rather than an accident.
4. **Role change while connected.** Takes effect on next connect (up to 15 minutes).
   Closing affected sockets on a membership change would make it immediate; deferred
   because it needs a channel from the web app to the sync process, which is the same
   machinery multi-instance scale-out needs.
5. **TypeScript 7.** Pinned at `^7.0.2`. If a tool in the chain misbehaves with the Go-based
   compiler, fall back to `5.9.x`; nothing in the design depends on TS 7 features.

---

## 15. The six questions, answered plainly

1. **What problem am I solving?** Two people editing the same thing at the same time,
   including when one of them is offline, without anyone losing work.
2. **What exactly should the system do?** Propagate edits between clients in under 200ms,
   merge offline edits on reconnect with no loss, persist durably enough to survive a
   restart, and prevent a `viewer` from writing — enforced in code, not in the UI.
3. **What are the main components?** A client-side Y.Doc, a dumb relay server that does
   authorization and durability but understands nothing about document semantics, an
   append-only update log with periodic snapshots, and a Next.js app for identity and
   membership.
4. **How does data move?** Local mutation first, then a binary delta out over WebSocket,
   fanned out to peers synchronously and to Postgres asynchronously. Reconnect is a state
   vector exchange, not a replay.
5. **What can fail?** The server (clients keep working), the database (collaboration keeps
   working, durability degrades), a hard crash (bounded 500ms window that connected clients
   heal), a malformed frame (one connection dies, the room survives), and a viewer trying
   to write (rejected at the relay, counted, never broadcast).
6. **How will I know it works?** Pure units for the two hard algorithms, integration tests
   against real clients and a real database for the protocol and the persistence loop,
   Playwright with `disableBc: true` for the actual two-tab behavior, and metrics that make
   the durability window and the snapshot fast path visible rather than assumed.
