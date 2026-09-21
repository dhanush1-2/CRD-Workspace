import { test, expect } from '@playwright/test'
import { cleanup, seedWorkspace, E2E_PASSWORD } from './fixtures.js'

const LABEL = 'e2e-auth'

test.afterAll(async () => {
  await cleanup(LABEL)
})

test('an unauthenticated visitor is sent to the sign-in page and can sign in', async ({ page }) => {
  const { owner } = await seedWorkspace(LABEL)

  await page.goto('/login')
  await page.getByLabel('Email').fill(owner.email)
  await page.getByLabel('Password').fill(E2E_PASSWORD)
  await page.getByTestId('submit').click()

  // Signing in lands on the dashboard, not back on the form.
  await expect(page).toHaveURL('/')
})

test('a wrong password shows an error and stays on the form', async ({ page }) => {
  const { owner } = await seedWorkspace(`${LABEL}-bad`)

  await page.goto('/login')
  await page.getByLabel('Email').fill(owner.email)
  await page.getByLabel('Password').fill('definitely-not-the-password')
  await page.getByTestId('submit').click()

  await expect(page.getByTestId('auth-error')).toHaveText('invalid credentials')
  await expect(page).toHaveURL('/login')
  await cleanup(`${LABEL}-bad`)
})
