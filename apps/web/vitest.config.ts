import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    name: 'web',
    environment: 'node',
    // Vitest's default exclude is only node_modules/.git, so without this it would
    // also try to run apps/web/e2e/*.spec.ts as vitest tests. Those files import
    // `test`/`expect` from @playwright/test (a real browser, fixtures, no `browser`
    // context here) and belong to `playwright test` only, run separately.
    exclude: ['**/node_modules/**', '**/.git/**', 'e2e/**'],
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
})
