import { test, expect } from '@playwright/test'
import {
  cleanup,
  cleanupUser,
  seedWorkspace,
  createDocument,
  addMember,
  E2E_PASSWORD,
} from './fixtures.js'

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

test('the dashboard lists the workspaces you belong to and can create another', async ({
  page,
}) => {
  const label = `${LABEL}-dash`
  const { owner, workspace } = await seedWorkspace(label)

  await page.goto('/login')
  await page.getByLabel('Email').fill(owner.email)
  await page.getByLabel('Password').fill(E2E_PASSWORD)
  await page.getByTestId('submit').click()

  await expect(page).toHaveURL('/')
  await expect(page.getByTestId('current-user')).toHaveText('Owner')
  await expect(page.getByTestId(`workspace-${workspace.id}`)).toContainText(label)

  await page.getByTestId('workspace-name').fill(`${label}-second`)
  await page.getByTestId('create-workspace').click()
  await expect(page.getByText(`${label}-second`)).toBeVisible()

  await page.getByTestId('sign-out').click()
  await expect(page).toHaveURL('/login')

  await cleanup(label)
  await cleanup(`${label}-second`)
})

test('signing out, then visiting the dashboard, sends you back to sign-in', async ({ page }) => {
  await page.goto('/')
  await expect(page).toHaveURL(/\/login/)
})

test('a workspace page lists its documents and can create a board', async ({ page }) => {
  const label = `${LABEL}-ws`
  const { owner, workspace } = await seedWorkspace(label)
  const existing = await createDocument(workspace.id, 'doc')

  await page.goto('/login')
  await page.getByLabel('Email').fill(owner.email)
  await page.getByLabel('Password').fill(E2E_PASSWORD)
  await page.getByTestId('submit').click()
  await expect(page).toHaveURL('/')

  await page.getByTestId(`workspace-${workspace.id}`).click()
  await expect(page).toHaveURL(`/workspaces/${workspace.id}`)
  await expect(page.getByTestId(`document-${existing.id}`)).toContainText('e2e doc')

  await page.getByTestId('document-title').fill('Launch board')
  await page.getByTestId('document-type').selectOption('board')
  await page.getByTestId('create-document').click()
  await expect(page.getByText('Launch board')).toBeVisible()

  await cleanup(label)
})

test('a workspace you are not a member of is not found, not forbidden', async ({ page }) => {
  const mine = `${LABEL}-mine`
  const theirs = `${LABEL}-theirs`
  const { owner } = await seedWorkspace(mine)
  const other = await seedWorkspace(theirs)

  await page.goto('/login')
  await page.getByLabel('Email').fill(owner.email)
  await page.getByLabel('Password').fill(E2E_PASSWORD)
  await page.getByTestId('submit').click()
  await expect(page).toHaveURL('/')

  // 404, never 403: a 403 would confirm the id exists to somebody with no access
  // to it, which is the rule requireWorkspaceRole already enforces on the API.
  const response = await page.goto(`/workspaces/${other.workspace.id}`)
  expect(response?.status()).toBe(404)

  await cleanup(mine)
  await cleanup(theirs)
})

test('an owner sees the member list and can invite an existing user', async ({ page }) => {
  const label = `${LABEL}-members`
  const { owner, workspace } = await seedWorkspace(label)
  const invitee = await addMember(workspace.id, `${label}-pre`, 'viewer')
  // Someone who exists but is not yet in this workspace.
  const outsider = await seedWorkspace(`${label}-outsider`)

  await page.goto('/login')
  await page.getByLabel('Email').fill(owner.email)
  await page.getByLabel('Password').fill(E2E_PASSWORD)
  await page.getByTestId('submit').click()
  // Wait for sign-in to land before navigating away: page.goto right after click()
  // can outrun the login form's own async fetch-then-cookie-set, hitting the
  // workspace page unauthenticated and bouncing back to /login.
  await expect(page).toHaveURL('/')
  await page.goto(`/workspaces/${workspace.id}`)

  await expect(page.getByTestId(`member-${invitee.id}`)).toContainText('viewer')

  await page.getByTestId('member-email').fill(outsider.owner.email)
  await page.getByTestId('member-role').selectOption('editor')
  await page.getByTestId('add-member').click()

  await expect(page.getByTestId(`member-${outsider.owner.id}`)).toContainText('editor')

  await cleanup(label)
  await cleanup(`${label}-outsider`)
})

test('inviting an email with no account explains the problem', async ({ page }) => {
  const label = `${LABEL}-noaccount`
  const { owner, workspace } = await seedWorkspace(label)

  await page.goto('/login')
  await page.getByLabel('Email').fill(owner.email)
  await page.getByLabel('Password').fill(E2E_PASSWORD)
  await page.getByTestId('submit').click()
  // See the sibling test above: wait for sign-in to land before navigating away.
  await expect(page).toHaveURL('/')
  await page.goto(`/workspaces/${workspace.id}`)

  await page.getByTestId('member-email').fill('nobody-at-all@e2e.test')
  await page.getByTestId('add-member').click()

  // The API returns a bare 404 here. Shown raw it reads as "page not found",
  // which is the wrong story entirely — the panel has to translate it.
  await expect(page.getByTestId('member-error')).toContainText('No account')

  await cleanup(label)
})

test('an unauthenticated visit to a document returns to it after signing in', async ({ page }) => {
  const label = `${LABEL}-doc`
  const { owner, workspace } = await seedWorkspace(label)
  const document = await createDocument(workspace.id, 'board')

  await page.goto(`/documents/${document.id}`)
  // Not a bare 404, and not a dead-end message — the login page, carrying the
  // destination so signing in lands back on the document that was asked for.
  await expect(page).toHaveURL(`/login?next=${encodeURIComponent(`/documents/${document.id}`)}`)

  await page.getByLabel('Email').fill(owner.email)
  await page.getByLabel('Password').fill(E2E_PASSWORD)
  await page.getByTestId('submit').click()

  await expect(page).toHaveURL(`/documents/${document.id}`)
  await expect(page.getByTestId('document-title')).toHaveText('e2e board')
  await expect(page.getByTestId('workspace-link')).toHaveText(label)
  await expect(page.getByTestId('role')).toHaveText('owner')

  await cleanup(label)
})
