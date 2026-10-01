import { test } from '@playwright/test'

test('loading a page pings the sync server so it starts waking up', async ({ page }) => {
  const ping = page.waitForRequest((request) => request.url() === 'http://localhost:1234/healthz')
  await page.goto('/login')
  await ping
})
