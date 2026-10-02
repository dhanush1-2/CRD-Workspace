# History, Authorship and Telemetry — Design

**Status:** decisions made by the design owner on 2026-10-02. This is the spec that the
backend plan and the history/offline plan argue from.

**Scope:** the backend capability the remaining Glass features need — version history
with authorship, restore, a version number and sync telemetry for the status popover and
the offline pills, and card notes for the card detail sheet.

---

## Decision 1 — Authorship lives on the update row

**Chosen: a `userId` column on `DocumentUpdate`.**

Today each saved update records `clientId` — a Yjs client number, not a person — so "who
changed this?" is unanswerable. The alternative considered was a `clientId → userId`
session table, keeping update rows lean at the cost of a lookup. Rejected: at roughly 25
bytes per row, a hundred thousand updates is about 2.5 MB, and the join table adds a
failure mode (a missing session row) for no benefit at this scale.

**This is cheaper than it first looked.** The sync server already authenticates every
socket with a signed doc token and keeps the result on the room: `server.ts` verifies the
token and sets `userId: claims.sub`, and `room.ts` already declares `readonly userId:
string`. So the writer has the user id in hand at the moment it persists an update — no
new plumbing, just a column and passing a value that already exists.

**Consequences:**
- A migration adding `userId String?` to `DocumentUpdate`, nullable because existing rows
  have no author and backfilling one would be inventing history.
- A relation to `User` with `onDelete: SetNull` — deleting an account must not delete
  document history.
- Anything reading authorship must handle `null` and render it as "Unknown", not crash
  and not silently attribute it to someone.
- An index on `[documentId, id]` already exists and still serves the history query.

## Decision 2 — Restore is a new update, and concurrent edits survive

**Chosen: accept the merge.**

A CRDT never overwrites; it only merges. So "restore version 5" cannot stamp old state
over current state — there is no overwrite primitive to use. Restore is therefore applied
as *another update*: compute the document state at the chosen snapshot, derive the
transaction that turns current state into that state, and commit it like any other edit.

If someone is typing when that lands, both apply. The result is the restored version
*plus* their in-flight edit — strictly neither the old nor the new version.

The alternatives were locking the document for the duration (exact restore, but freezing
a collaborative document mid-sentence is baffling to the person it happens to) and
restoring into a copy (nothing can be lost, but it leaves two documents and the question
of which is real). Both rejected.

**Consequences:**
- Restore needs no locking, no new document state, and no special-casing in the sync
  server — it is an ordinary update, which means it is also undoable by restoring again.
- A restore is attributed to whoever performed it, via Decision 1, so history reads
  "Dhanush restored to Sep 27, 14:20" rather than appearing as an anonymous change.
- The UI must tell the truth about the merge: after a restore with other people present,
  say so rather than implying an exact revert. Exact copy is specifically what this
  design does not promise.
- Viewers cannot restore. The existing role check covers it; the restore route must
  enforce `editor` or better rather than relying on the UI hiding the button.

## Decision 3 — Offline edits survive a disconnect, not a tab close

**Chosen: keep today's behaviour. No `y-indexeddb`.**

Today, losing the network is already handled: edits accumulate in the page and sync on
reconnect. What is *not* handled is closing the tab while offline, which discards them.

Adding browser-side persistence was considered and rejected for now, because it creates a
second source of truth whose disagreements have no obviously-correct answer: a viewer
whose cached edits replay after being downgraded to read-only; cached edits for a document
deleted server-side; a week-stale copy resurrecting deliberately deleted content. Each is
solvable, but each needs a decided answer, and the cost of guessing is text appearing or
disappearing inexplicably — the failure mode that makes people stop trusting a writing
tool.

### A consequence that contradicts the handoff, and must be resolved

`docs/design/glass-handoff.md:199` specifies this offline copy:

> "You're offline. Keep working, your changes are saved on this device."
> With queued changes: "You're offline. N changes saved on this device will sync when
> you're back."

**Under this decision that copy is false.** Nothing is saved on the device; the edits live
in the page and die with it. Shipping it would promise durability the system does not
have, in the exact moment a user is deciding whether it is safe to close their laptop.

Two ways out, and this needs the owner's answer before the offline pill is built:

1. **Change the copy** to what is true — "Keep working. Your changes will sync when you're
   back." / "N changes will sync when you're back." Keeps the simpler architecture.
2. **Keep the copy and build `y-indexeddb`**, which reverses this decision and requires
   answers to the three conflict cases above.

Recommendation: option 1. The copy is a sentence; the persistence layer is a subsystem.

## Derived: what the backend must expose

From the three decisions, the capabilities the UI plans need:

| Capability | Shape | Serves |
|---|---|---|
| Snapshot list | `GET /api/documents/[id]/history` → `[{ id, createdAt, author: { id, name } \| null, description }]` | History panel rows |
| Snapshot content | `GET /api/documents/[id]/history/[snapshotId]` → the state needed to preview | Version preview bar |
| Restore | `POST /api/documents/[id]/history/[snapshotId]/restore` → applies as a new update | Restore action |
| Version number | a monotonic sequence the client can display | Status popover "Version" |
| Queued-edit count | count of unsynced updates held in the page | Offline pill "N changes" |
| Latency | round-trip measurement against the sync server | Status popover "Response time" |
| Card notes | `description` plus an activity log on the card's `Y.Map` | Card detail sheet |

The version number and the queued count are **not** the same thing and must not be
conflated: the version is server-assigned and shared, the queued count is per-client and
local. `DocumentUpdate.id` is already a `BigInt` autoincrement, so the highest id for a
document is a usable version sequence with no new column.

Card notes need no backend at all — a `Y.Map` field is CRDT state, not database schema —
so they can be split out and shipped independently of the history work.

## Open question

Only one: the offline copy above (option 1 or option 2).
