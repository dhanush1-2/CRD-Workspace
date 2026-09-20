import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    projects: [
      { test: { name: 'shared', root: './packages/shared', environment: 'node' } },
      { test: { name: 'db', root: './packages/db', environment: 'node' } },
      { test: { name: 'sync', root: './apps/sync', environment: 'node' } },
    ],
  },
})
