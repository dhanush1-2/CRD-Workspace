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

## Decision 3 — Offline edits survive a tab close (revised)

**Chosen: build local persistence. Match what Google Docs does.**

This reverses an earlier decision in this same document. The first pass kept today's
behaviour — edits survive a disconnect but die with the tab — on the grounds that a
second source of truth creates conflicts with no obviously-correct answer. The owner
asked what Google Docs does and to do the same, which settles it, and answering the
question properly also corrected an error of mine.

**What Google Docs does:** it persists offline edits locally, so they survive closing
the tab, quitting the browser and a reboot, and it says so ("Working offline", "All
changes saved offline"). It is opt-in — per document, or account-wide, and in Chrome via
the Docs offline extension. For conflicts its pattern is *offer to save a copy*: lost
edit permission while offline, or a document deleted while you were away, both end with
"save your version as a separate file".

**The correction.** The earlier text warned that a stale local copy could "resurrect
deliberately deleted content". That is a genuine hazard in Google's architecture, which
replays offline operations against the server's current state. It is largely **not** a
hazard here: Yjs records deletions as tombstones, so if a peer deleted a paragraph while
this client was offline and this client never touched it, merging leaves it deleted.
Resurrection happens only if the offline edits actually re-inserted that content, which
is correct behaviour rather than a bug.

So the hardest part of Google's offline system — rebasing operations against a moving
server state — does not exist for us. The CRDT already handles it. This is materially
cheaper than the first pass priced it.

**What to build:** `y-indexeddb` alongside the existing websocket provider, so the Yjs
document is backed by browser storage as well as the server. The handoff's copy at
line 199 ("your changes are saved on this device") becomes true and stays as written.

**The two conflict cases that remain, and their answers, following Docs:**

1. **Edit permission lost while offline.** On reconnect the sync server rejects the
   updates — the existing per-frame role enforcement already does this, which is why
   this is a UI problem and not a protocol one. The client must detect the rejection,
   stop trying, and offer to save the local version as a new document. Silently
   discarding an hour of someone's writing is the one outcome that is not acceptable.
2. **Document deleted while offline.** Same resolution: the document is gone, the local
   copy is not, and the user is offered a copy. The sync server already logs "dropping
   updates for a document that no longer exists", so the server side of this exists; the
   client currently ignores it.

**One deliberate divergence from Docs, flagged for the owner.** Docs makes offline
opt-in, because of storage quota on shared machines and because its offline mode needed
an extension. Neither reason applies here: `y-indexeddb` is a few hundred KB of library
and stores only documents the user actually opened. Always-on is simpler to build, has
no settings surface, and means nobody loses work because they forgot to flip a switch.
Recommendation: always-on. Say so if you want the toggle instead.

**Consequences for the plans:**
- A new dependency, `y-indexeddb`, and a provider composition change in
  `hooks/use-doc.ts` — the one place that owns the provider lifecycle.
- The "N changes waiting to sync" count can now come from persisted state rather than
  only from memory, which makes the offline pill's number meaningful after a reload.
- Two new client flows (permission-lost, document-deleted) that need the "save a copy"
  path, which needs a create-document-from-state capability the app does not have yet.
- This is the largest single item in the remaining work and should be its own plan,
  separate from history and from the status telemetry.

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
| Local persistence | `y-indexeddb` beside the websocket provider, plus the two "save a copy" flows | Offline edits surviving a tab close |

The version number and the queued count are **not** the same thing and must not be
conflated: the version is server-assigned and shared, the queued count is per-client and
local. `DocumentUpdate.id` is already a `BigInt` autoincrement, so the highest id for a
document is a usable version sequence with no new column.

Card notes need no backend at all — a `Y.Map` field is CRDT state, not database schema —
so they can be split out and shipped independently of the history work.

## Decision 4 — Offline persistence is always-on

**Chosen: always-on. No toggle.**

Google Docs makes offline opt-in, but both of its reasons are artifacts of its own
situation: storage quota on shared machines, and an offline mode that needed a browser
extension. Neither applies here — `y-indexeddb` is a small library and stores only
documents the user actually opened.

So there is no settings surface, nothing to discover, and nobody loses work because they
did not know a switch existed. The cost is that every opened document occupies some
browser storage; if that ever becomes a problem the answer is eviction by age, not a
toggle.

**Consequence:** the two conflict flows in Decision 3 are not edge cases for a minority
who opted in — they are on the main path for everyone. The "save a copy" path must be
built properly, not stubbed.

## No open questions

All four decisions are settled. The backend plan can be written from this document.
