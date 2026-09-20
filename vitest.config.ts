import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    projects: [
      { test: { name: 'shared', root: './packages/shared', environment: 'node' } },
      { test: { name: 'db', root: './packages/db', environment: 'node' } },
      { test: { name: 'sync', root: './apps/sync', environment: 'node' } },
      // The web project is defined in its own config file (rather than inline here)
      // because its `resolve.alias` for `@/*` must also apply when Vitest is invoked
      // directly from apps/web (e.g. `pnpm --filter @crdt/web exec vitest run`) —
      // that invocation resolves config by upward directory search from cwd and does
      // not merge an inline project's sibling `resolve` block the same way.
      './apps/web/vitest.config.ts',
    ],
  },
})
