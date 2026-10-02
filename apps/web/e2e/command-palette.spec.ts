import { test, expect, type Page } from '@playwright/test'
import { prisma } from '@crdt/db'
import { cleanup, seedWorkspace, signIn } from './fixtures.js'

const LABEL = 'e2e-command-palette'

test.afterAll(async () => {
  await cleanup(LABEL)
})

async function seed(page: Page, label: string) {
  const { owner, workspace } = await seedWorkspace(label)
  const alpha = await prisma.document.create({
    data: { workspaceId: workspace.id, type: 'doc', title: 'Quarterly roadmap' },
  })
  const beta = await prisma.document.create({
    data: { workspaceId: workspace.id, type: 'doc', title: 'Hiring plan' },
  })
  await signIn(page, owner.id)
  await page.goto(`/workspaces/${workspace.id}`)
  return { workspace, alpha, beta }
}

/**
 * Presses the shortcut until the palette appears. The page is server-rendered, so a
 * key pressed before hydration reaches no listener; retrying is safe because opening
 * an already-open palette is a no-op.
 */
async function openWith(page: Page, shortcut: string) {
  await expect(async () => {
    await page.keyboard.press(shortcut)
    await expect(page.getByTestId('palette')).toBeVisible({ timeout: 500 })
  }).toPass({ timeout: 10_000 })
}

/** The click path, retried for the same hydration reason as openWith. */
async function openByClick(page: Page) {
  await expect(async () => {
    await page.getByTestId('search').click()
    await expect(page.getByTestId('palette')).toBeVisible({ timeout: 500 })
  }).toPass({ timeout: 10_000 })
}

test('Meta+K opens the palette', async ({ page }) => {
  const label = `${LABEL}-meta`
  await seed(page, label)
  await expect(page.getByTestId('palette')).toHaveCount(0)

  await openWith(page, 'Meta+k')
  await expect(page.getByTestId('palette-input')).toBeFocused()

  await cleanup(label)
})

test('Control+K opens the palette', async ({ page }) => {
  const label = `${LABEL}-control`
  await seed(page, label)
  await expect(page.getByTestId('palette')).toHaveCount(0)

  await openWith(page, 'Control+k')
  await expect(page.getByTestId('palette-input')).toBeFocused()

  await cleanup(label)
})

test('typing filters the list', async ({ page }) => {
  const label = `${LABEL}-filter`
  const { alpha, beta } = await seed(page, label)

  await openWith(page, 'Control+k')
  await expect(page.getByTestId(`palette-item-doc-${alpha.id}`)).toBeVisible()
  await expect(page.getByTestId(`palette-item-doc-${beta.id}`)).toBeVisible()

  await page.getByTestId('palette-input').fill('road')
  await expect(page.getByTestId(`palette-item-doc-${alpha.id}`)).toBeVisible()
  await expect(page.getByTestId(`palette-item-doc-${beta.id}`)).toHaveCount(0)

  await cleanup(label)
})

test('ArrowDown then Enter navigates to the selected document', async ({ page }) => {
  const label = `${LABEL}-navigate`
  const { alpha, beta } = await seed(page, label)

  await openWith(page, 'Control+k')
  // Documents come first in the list, so the first two options are the two seeded ones.
  const options = page.getByRole('option')
  await expect(options.first()).toHaveAttribute('aria-selected', 'true')
  const first = await options.first().getAttribute('data-testid')

  await page.keyboard.press('ArrowDown')
  await expect(options.nth(1)).toHaveAttribute('aria-selected', 'true')
  const second = await options.nth(1).getAttribute('data-testid')
  expect(second).not.toBe(first)

  await page.keyboard.press('Enter')

  const target = [alpha, beta].find((document) => second === `palette-item-doc-${document.id}`)
  if (!target) throw new Error(`the second option was not a document: ${second}`)
  await expect(page).toHaveURL(new RegExp(`/documents/${target.id}$`))
  await expect(page.getByTestId('palette')).toHaveCount(0)

  await cleanup(label)
})

test('Escape closes the palette and returns focus to the search control', async ({ page }) => {
  const label = `${LABEL}-escape`
  await seed(page, label)

  await openByClick(page)

  await page.keyboard.press('Escape')
  await expect(page.getByTestId('palette')).toHaveCount(0)
  await expect(page.getByTestId('search')).toBeFocused()

  await cleanup(label)
})

test('Escape after the keyboard shortcut returns focus to the search button', async ({ page }) => {
  const label = `${LABEL}-shortcut-focus`
  await seed(page, label)

  // Opened from the keyboard, so nothing but <body> held focus beforehand.
  await openWith(page, 'Control+k')

  await page.keyboard.press('Escape')
  await expect(page.getByTestId('palette')).toHaveCount(0)
  await expect(page.getByTestId('search')).toBeFocused()

  await cleanup(label)
})

test('the search button opens the palette as a combobox over a listbox', async ({ page }) => {
  const label = `${LABEL}-button`
  await seed(page, label)

  await openByClick(page)

  const input = page.getByRole('combobox')
  const list = page.getByRole('listbox')
  await expect(input).toHaveAttribute('aria-expanded', 'true')
  await expect(input).toHaveAttribute('aria-controls', (await list.getAttribute('id'))!)
  const active = await input.getAttribute('aria-activedescendant')
  await expect(page.locator(`#${active}`)).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByRole('dialog', { name: 'Search' })).toBeVisible()
  await expect(page.getByRole('menu')).toHaveCount(0)

  await cleanup(label)
})
