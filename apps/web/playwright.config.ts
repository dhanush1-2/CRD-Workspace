// Playwright does not read .env itself. Load it here so fixtures that sign
// session cookies (process.env.SESSION_SECRET) and connect to the database
// (process.env.DATABASE_URL) have what they need.
try {
  process.loadEnvFile(new URL('../../.env', import.meta.url))
} catch {
  // .env is absent in CI/production, where these arrive from the host
  // environment instead. Fall through; env.ts's own validation will throw
  // a clear error at first use if something is genuinely missing.
}

import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  expect: { timeout: 10_000 },
  use: { baseURL: 'http://localhost:3000' },
  // One worker: these tests share a Postgres database and a sync server.
  workers: 1,
  // Start the Next dev server if one is not already listening. Without this every
  // run required a separately-started server, and a forgotten one turned every
  // assertion into an ECONNREFUSED. reuseExistingServer keeps a developer's own
  // `pnpm dev` in charge when they have one running.
  //
  // This starts the web server only. collaboration.spec.ts additionally needs the
  // sync server (`pnpm --filter @crdt/sync dev`) running on port 1234; that is
  // unchanged from before and still started by hand.
  webServer: {
    command: 'pnpm run dev',
    url: 'http://localhost:3000',
    reuseExistingServer: true,
    timeout: 120_000,
  },
})
