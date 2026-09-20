# CRDT Collaborative Engine

A real-time collaborative workspace built with Yjs CRDT, WebSocket sync server, and Next.js frontend.

## Setup

```bash
pnpm install
```

## Development

Run tests:
```bash
pnpm test
pnpm test:watch
```

Type check:
```bash
pnpm typecheck
```

## Workspace Structure

- `packages/shared` - Shared types, utilities, and CRDT abstractions
- `apps/sync` - WebSocket sync server (added in Task 4)
- `apps/web` - Next.js web frontend (added in later tasks)
