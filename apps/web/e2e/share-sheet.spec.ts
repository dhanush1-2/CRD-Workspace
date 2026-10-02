import { test, expect } from '@playwright/test'
import { addMember, cleanup, seedWorkspace, signIn } from './fixtures.js'

const LABEL = 'e2e-share-sheet'

test.afterAll(async () => {
  await cleanup(LABEL)
})

test('the share sheet traps focus, closes on Escape and returns focus', async ({ page }) => {
  const label = `${LABEL}-focus`
  const { owner, workspace } = await seedWorkspace(label)
  await signIn(page, owner.id)
  await page.goto(`/workspaces/${workspace.id}`)

  await page.getByTestId('share').click()
  await expect(page.getByTestId('sheet')).toBeVisible()
  await expect(page.getByTestId('sheet')).toContainText('Share')
  // Focus must be inside the dialog, not left on the Share button.
  const inside = await page
    .getByTestId('sheet')
    .evaluate((el) => el.contains(document.activeElement))
  expect(inside).toBe(true)

  // Tab for longer than the sheet has controls. A trap that works keeps focus
  // inside the dialog however far this goes; without one it walks out into the
  // page behind (the sheet has an email field, a role select, Add and one role
  // select for the owner, so 12 presses is more than a full lap).
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press('Tab')
    const stillInside = await page
      .getByTestId('sheet')
      .evaluate((el) => el.contains(document.activeElement))
    expect(stillInside, `focus left the sheet after ${i + 1} Tab presses`).toBe(true)
  }
  // And backwards, which wraps from the first control to the last.
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press('Shift+Tab')
    const stillInside = await page
      .getByTestId('sheet')
      .evaluate((el) => el.contains(document.activeElement))
    expect(stillInside, `focus left the sheet after ${i + 1} Shift+Tab presses`).toBe(true)
  }

  await page.keyboard.press('Escape')
  await expect(page.getByTestId('sheet')).toHaveCount(0)
  await expect(page.getByTestId('share')).toBeFocused()

  await cleanup(label)
})

test('a backdrop click closes the sheet but a click inside does not', async ({ page }) => {
  const label = `${LABEL}-backdrop`
  const { owner, workspace } = await seedWorkspace(label)
  await signIn(page, owner.id)
  await page.goto(`/workspaces/${workspace.id}`)

  await page.getByTestId('share').click()
  await page.getByTestId('sheet').click({ position: { x: 10, y: 10 } })
  await expect(page.getByTestId('sheet')).toBeVisible()

  await page.getByTestId('sheet-overlay').click({ position: { x: 5, y: 5 } })
  await expect(page.getByTestId('sheet')).toHaveCount(0)

  await cleanup(label)
})

test('inviting someone who already has access explains instead of changing their role', async ({
  page,
}) => {
  const label = `${LABEL}-dupe`
  const { owner, workspace } = await seedWorkspace(label)
  const viewer = await addMember(workspace.id, label, 'viewer')
  await signIn(page, owner.id)
  await page.goto(`/workspaces/${workspace.id}`)

  await page.getByTestId('share').click()
  // Scoped to the sheet, which is where these controls live.
  const sheet = page.getByTestId('sheet')

  // A viewer, invited with the form's default role (Can edit). The members route
  // upserts, so without the guard this would silently promote them.
  await sheet.getByTestId('member-email').fill(viewer.email)
  await sheet.getByTestId('add-member').click()
  await expect(sheet.getByTestId('member-error')).toContainText(`${viewer.email} already has access`)
  await expect(sheet.getByTestId(`role-for-${viewer.id}`)).toHaveValue('viewer')
  await expect(page.getByTestId('toast')).toHaveCount(0)

  // The sole owner too, matched case-insensitively. Without the guard the route's
  // own last-owner check would answer with a different message.
  await sheet.getByTestId('member-email').fill(owner.email.toUpperCase())
  await sheet.getByTestId('add-member').click()
  await expect(sheet.getByTestId('member-error')).toContainText('already has access')
  await expect(sheet.getByTestId(`role-for-${owner.id}`)).toHaveValue('owner')

  await cleanup(label)
})

test('changing a role in the sheet raises a toast and saves the change', async ({ page }) => {
  const label = `${LABEL}-toast`
  const { owner, workspace } = await seedWorkspace(label)
  const viewer = await addMember(workspace.id, label, 'viewer')
  await signIn(page, owner.id)
  await page.goto(`/workspaces/${workspace.id}`)

  await page.getByTestId('share').click()
  const sheet = page.getByTestId('sheet')
  await expect(page.getByTestId('toast')).toHaveCount(0)
  await sheet.getByTestId(`role-for-${viewer.id}`).selectOption('editor')

  // The toast renders in the provider, outside the sheet, so look on the page.
  await expect(page.getByTestId('toast')).toHaveText('Vera can edit now')
  // And the toast is not a lie: the role really changed, and the row shows it
  // once the refresh lands.
  await expect(sheet.getByTestId(`role-for-${viewer.id}`)).toHaveValue('editor')

  await cleanup(label)
})

test('the People panel link opens the share sheet, labelled for the role', async ({ page }) => {
  const label = `${LABEL}-link`
  const { owner, workspace } = await seedWorkspace(label)
  const viewer = await addMember(workspace.id, label, 'viewer')

  await signIn(page, owner.id)
  await page.goto(`/workspaces/${workspace.id}`)
  await expect(page.getByTestId('open-share')).toHaveText('Manage')
  await expect(page.getByTestId('sheet')).toHaveCount(0)
  await page.getByTestId('open-share').click()
  await expect(page.getByTestId('sheet')).toBeVisible()

  // A viewer cannot manage, so the same link offers a look instead.
  await page.context().clearCookies()
  await signIn(page, viewer.id)
  await page.goto(`/workspaces/${workspace.id}`)
  await expect(page.getByTestId('open-share')).toHaveText('See who has access')
  await expect(page.getByTestId('sheet')).toHaveCount(0)
  await page.getByTestId('open-share').click()
  await expect(page.getByTestId('sheet')).toBeVisible()

  await cleanup(label)
})
