# CRDT Collaborative Engine — project description

> Source description, captured 2026-09-19. This is the starting brief, **not** a
> validated spec. Nothing has been built yet. Open questions are listed at the bottom.

## What it is

A real-time collaborative workspace — a lightweight Notion/Figma hybrid — where multiple
users edit the same document or board simultaneously, offline edits merge automatically
without conflicts, and every user sees live cursors and changes as they happen.

The product wrapper: a kanban board + rich-text doc editor. Concrete enough to demo in
seconds, general enough to show off both structured (board/cards) and unstructured (text)
conflict resolution.

## Core features

- Multi-user real-time editing of a document or kanban board, sub-200ms propagation
- Offline editing that merges cleanly on reconnect — no "last write wins" data loss
- Live cursors and presence ("Sarah is editing this card")
- Version history / time-travel through past states
- Per-workspace access control (owner, editor, viewer)

## Architecture

```
┌─────────────┐   WebSocket    ┌────────────────┐
│  Client A   │◀──────────────▶│                │
│ (Yjs doc +  │                │  Sync Server   │
│  Tiptap UI) │                │  (Node.js +    │
└─────────────┘                │  y-websocket   │
┌─────────────┐   WebSocket    │  or Hocuspocus)│
│  Client B   │◀──────────────▶│                │
└─────────────┘                └───────┬────────┘
                                       │
                            ┌──────────▼───────────┐
                            │  Persistence layer   │
                            │  (Postgres:          │
                            │   snapshots +        │
                            │   update log)        │
                            └──────────────────────┘
```

Each client holds a local Yjs CRDT document. Edits apply instantly and optimistically on
the client (no waiting for a server round-trip), then broadcast as small binary "update"
deltas over WebSocket. The server relays updates to other connected clients and persists
them — it doesn't need to understand document semantics at all. That's the elegant part of
CRDTs: the server is a dumb relay + durability layer, and correctness lives entirely in
the client-side merge algorithm.

## Tech stack

- **CRDT library:** Yjs. Don't hand-roll the CRDT math — use the well-tested library and
  spend the engineering on the product layer around it.
- **Rich text editor:** Tiptap (first-class Yjs binding) for the doc; a custom board
  component bound to a `Y.Map` / `Y.Array` for kanban.
- **Sync server:** Hocuspocus (a Yjs-aware WebSocket server), or a hand-rolled
  y-websocket server if you want more to explain in interviews.
- **Persistence:** Postgres storing periodic snapshots + an append-only update log, so
  state can be replayed/rebuilt and version history works.
- **Frontend:** Next.js
- **Auth:** NextAuth or a simple JWT setup
- **Deployment:** Fly.io or Railway. Needs persistent WebSocket connections, so avoid
  serverless functions for the sync server itself.

## Data model

```sql
workspaces (id, name, owner_id, created_at)

documents (
  id, workspace_id, type, -- 'doc' | 'board'
  title, created_at
)

document_snapshots (
  id, document_id, yjs_state_binary, -- serialized Yjs doc state
  snapshot_at
)

document_updates (
  id, document_id, update_binary, -- individual Yjs update, for replay/audit
  client_id, created_at
)

workspace_members (
  id, workspace_id, user_id, role -- owner | editor | viewer
)

presence_sessions ( -- ephemeral, can live in Redis instead of Postgres
  id, document_id, user_id, cursor_position, connected_at
)
```

Snapshots exist so you don't replay thousands of tiny updates on every load. Periodically
compact the update log into a snapshot (every 100 updates, or every 5 minutes) — the same
pattern as event sourcing with snapshotting.

## The genuinely hard parts (and where the interview answers come from)

1. **Persistence without losing atomicity.** Writing every incoming Yjs update to Postgres
   while also broadcasting it to other clients has to happen without blocking real-time
   delivery. Solve with a write-behind queue — buffer updates, batch-write to Postgres
   async — rather than synchronous writes on every keystroke.
2. **Reconnection and catch-up.** When a client reconnects after being offline it needs
   the current state efficiently, not a replay of every historical update. This is where
   snapshotting matters.
3. **Access control intersecting with CRDTs.** CRDTs assume all replicas eventually
   converge, but a "viewer" shouldn't be able to write. Enforce that at the server relay
   layer (reject their updates) without breaking merge guarantees for everyone else.
4. **Scaling beyond one server.** A single Node process handling all WebSocket connections
   is fine for a demo but won't scale. Shard documents across multiple sync-server
   instances with Redis pub/sub coordinating cross-instance broadcast. A strong "how would
   you scale this" answer even if the actual deployment is single-instance.

## Suggested build order

1. Get two browser tabs syncing a single Yjs text doc through a local Hocuspocus server —
   no auth, no persistence, just prove the sync works.
2. Add Postgres persistence (snapshot + update log) so state survives a server restart.
3. Build the kanban board on top of `Y.Map`, wire up drag-and-drop.
4. Add auth + workspace/member model + role enforcement.
5. Add presence / live cursors.
6. Add version history UI (scrub through snapshots).
7. Deploy, seed a public demo workspace, record the two-tab demo video.

## What goes in the README

A section explaining: why Yjs over building CRDT logic yourself (time-to-market +
correctness — this is a solved, adversarially-tested problem), how persistence and
reconnection work, and a "how I'd scale this" paragraph covering multi-instance
coordination. That last part converts a solo weekend-scale project into a legitimate
systems-design conversation.

## Open questions (unresolved, decide before building)

- **Sync server: Hocuspocus or hand-rolled y-websocket?** The description argues both
  sides. Hand-rolled gives more to explain in interviews; Hocuspocus gives working
  persistence hooks on day one.
- **Server framework.** The description says Node + Hocuspocus; a follow-up line mentions
  NestJS. Not the same decision — pick one.
- **Scope for a first cut.** Steps 1–3 alone are a working demo. Steps 4–7 roughly triple
  the surface area.
