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

/** process.env without undefined values, as Playwright's webServer.env requires. */
function definedEnv(): Record<string, string> {
  return Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
  )
}

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
  // Both servers the suite needs, started here so a run is self-contained.
  // Either is reused if you already have one running.
  webServer: [
    {
      command: 'pnpm run dev',
      url: 'http://localhost:3000',
      reuseExistingServer: true,
      timeout: 120_000,
      // The login page only renders a button for a provider whose credentials are
      // set, and the OAuth routes build redirect URIs from APP_URL. The e2e suite
      // never completes a real sign-in, so placeholders are enough; a developer's
      // real credentials from .env are used instead when present. APP_URL is forced,
      // because the tests assert redirect URIs against localhost:3000.
      //
      // This only applies when Playwright starts the server. A dev server you
      // started yourself is reused as-is, and then needs these in your .env.
      env: {
        ...definedEnv(),
        APP_URL: 'http://localhost:3000',
        GITHUB_CLIENT_ID: process.env.GITHUB_CLIENT_ID || 'e2e-github-client-id',
        GITHUB_CLIENT_SECRET: process.env.GITHUB_CLIENT_SECRET || 'e2e-github-client-secret',
        GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID || 'e2e-google-client-id',
        GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET || 'e2e-google-client-secret',
      },
    },
    {
      // collaboration.spec.ts needs a live relay. `start`, not `dev`: no file
      // watcher in a test run.
      command: 'pnpm --filter @crdt/sync run start',
      url: 'http://localhost:1234/healthz',
      reuseExistingServer: true,
      timeout: 60_000,
    },
  ],
})
