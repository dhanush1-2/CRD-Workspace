import { test, expect } from '@playwright/test'
import { cleanup, cleanupUser, seedWorkspace, E2E_PASSWORD } from './fixtures.js'

const LABEL = 'e2e-auth'
const NEW_EMAIL = 'e2e-auth-signup@e2e.test'

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

test('a network failure during sign-in shows an error instead of hanging', async ({ page }) => {
  const label = `${LABEL}-offline`
  const { owner } = await seedWorkspace(label)

  await page.goto('/login')
  await page.route('**/api/auth/login', (route) => route.abort())

  await page.getByLabel('Email').fill(owner.email)
  await page.getByLabel('Password').fill(E2E_PASSWORD)
  await page.getByTestId('submit').click()

  await expect(page.getByTestId('auth-error')).toContainText('Could not reach the server')
  // The button must return to its idle state — the bug this covers left it disabled forever.
  await expect(page.getByTestId('submit')).toBeEnabled()

  await cleanup(label)
})

test('a new visitor can create an account and lands on the dashboard', async ({ page }) => {
  await cleanupUser(NEW_EMAIL)

  await page.goto('/signup')
  await page.getByLabel('Name').fill('Ada Lovelace')
  await page.getByLabel('Email').fill(NEW_EMAIL)
  await page.getByLabel('Password').fill('correct-horse-battery')
  await page.getByTestId('submit').click()

  await expect(page).toHaveURL('/')
  await cleanupUser(NEW_EMAIL)
})

test('a password under 12 characters is refused', async ({ page }) => {
  await page.goto('/signup')
  await page.getByLabel('Name').fill('Too Short')
  await page.getByLabel('Email').fill('e2e-auth-short@e2e.test')
  await page.getByLabel('Password').fill('short')
  await page.getByTestId('submit').click()

  await expect(page.getByTestId('auth-error')).toHaveText('Password must be at least 12 characters.')
  await expect(page).toHaveURL('/signup')
})

test('a network failure during sign-up shows an error instead of hanging', async ({ page }) => {
  await cleanupUser(NEW_EMAIL)

  await page.goto('/signup')
  await page.route('**/api/auth/signup', (route) => route.abort())

  await page.getByLabel('Name').fill('Ada Lovelace')
  await page.getByLabel('Email').fill(NEW_EMAIL)
  await page.getByLabel('Password').fill('correct-horse-battery')
  await page.getByTestId('submit').click()

  await expect(page.getByTestId('auth-error')).toContainText('Could not reach the server')
  // The button must return to its idle state — the bug this covers left it disabled forever.
  await expect(page.getByTestId('submit')).toBeEnabled()

  await cleanupUser(NEW_EMAIL)
})
