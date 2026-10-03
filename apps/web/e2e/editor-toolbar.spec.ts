import { test, expect, type Page } from '@playwright/test'
import { addMember, cleanup, createDocument, seedWorkspace, signIn } from './fixtures.js'

const LABEL = 'e2e-toolbar'

test.afterAll(async () => {
  await cleanup(LABEL)
})

/** Signs in as the workspace owner and opens a fresh document, ready to type in. */
async function openDocument(page: Page, label: string) {
  const { owner, workspace } = await seedWorkspace(label)
  const document = await createDocument(workspace.id, 'doc')
  await signIn(page, owner.id)
  await page.goto(`/documents/${document.id}`)
  await expect(page.getByTestId('status')).toHaveAttribute('data-status', 'connected')
  await expect(page.locator('.editor .ProseMirror')).toHaveAttribute('contenteditable', 'true')
  return { owner, workspace, document }
}

const prose = (page: Page) => page.locator('.editor .ProseMirror')

test('the toolbar sits above the document sheet, not inside it', async ({ page }) => {
  await openDocument(page, `${LABEL}-above`)

  const toolbar = (await page.getByTestId('tb-root').boundingBox())!
  const sheet = (await page.getByTestId('document-page').boundingBox())!
  // Bottom edge of the ribbon clears the top edge of the sheet: two panels, stacked.
  expect(toolbar.y + toolbar.height).toBeLessThanOrEqual(sheet.y)

  // And it is not a descendant of the sheet, which would put it inside the glass page.
  const nested = await page
    .getByTestId('tb-root')
    .evaluate((el) => el.closest('[data-testid="document-page"]') !== null)
  expect(nested).toBe(false)
})

test('the toolbar stays 80px from the top while the page scrolls', async ({ page }) => {
  // A short window, so a nearly empty document is still taller than the viewport.
  await page.setViewportSize({ width: 1280, height: 320 })
  await openDocument(page, `${LABEL}-sticky`)

  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(100)

  const toolbar = (await page.getByTestId('tb-root').boundingBox())!
  expect(toolbar.y).toBeCloseTo(80, 0)
})

test('an editor gets Home, Insert and View, with Home open', async ({ page }) => {
  await openDocument(page, `${LABEL}-tabs`)

  await expect(page.getByRole('tab')).toHaveText(['Home', 'Insert', 'View'])
  await expect(page.getByTestId('tb-tab-home')).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByTestId('tb-tab-insert')).toHaveAttribute('aria-selected', 'false')
  await expect(page.getByTestId('tb-row-home')).toBeVisible()
  // An editor has no "View only" chip.
  await expect(page.getByTestId('tb-viewonly')).toHaveCount(0)
})

test('clicking a tab shows that tab’s row and only that row', async ({ page }) => {
  await openDocument(page, `${LABEL}-rows`)

  await page.getByTestId('tb-tab-insert').click()
  await expect(page.getByTestId('tb-tab-insert')).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByTestId('tb-row-insert')).toBeVisible()
  await expect(page.getByTestId('tb-row-home')).toHaveCount(0)

  await page.getByTestId('tb-tab-view').click()
  await expect(page.getByTestId('tb-tab-view')).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByTestId('tb-row-view')).toBeVisible()
  await expect(page.getByTestId('tb-row-insert')).toHaveCount(0)

  await page.getByTestId('tb-tab-home').click()
  await expect(page.getByTestId('tb-row-home')).toBeVisible()
})

test('switching tabs keeps the editor’s selection', async ({ page }) => {
  await openDocument(page, `${LABEL}-selection`)

  await prose(page).click()
  await page.keyboard.type('keep this selected')
  await page.keyboard.press('ControlOrMeta+a')
  const selected = () => page.evaluate(() => window.getSelection()?.toString() ?? '')
  expect(await selected()).toBe('keep this selected')

  // A real mouse click: mousedown is where the browser moves focus. Without
  // preventDefault there, the editor blurs and every toolbar command applies to nothing.
  await page.getByTestId('tb-tab-insert').click()

  await expect(page.getByTestId('tb-row-insert')).toBeVisible()
  expect(await selected()).toBe('keep this selected')
  expect(
    await page.evaluate(() => document.activeElement?.closest('.ProseMirror') !== null),
  ).toBe(true)
})

test('the word count follows the document, across paragraphs, and survives a reload', async ({
  page,
}) => {
  await openDocument(page, `${LABEL}-words`)
  const count = page.getByTestId('tb-wordcount')

  await expect(count).toHaveText('0 words')

  await prose(page).click()
  await page.keyboard.type('one two three')
  // Debounced, so poll rather than read once.
  await expect.poll(() => count.textContent()).toBe('3 words')

  // A second paragraph: "four" and "three" must not fuse into one token.
  await page.keyboard.press('Enter')
  await page.keyboard.type('four')
  await expect.poll(() => count.textContent()).toBe('4 words')

  await page.keyboard.press('ControlOrMeta+a')
  await page.keyboard.press('Backspace')
  await expect.poll(() => count.textContent()).toBe('0 words')

  await page.keyboard.type('just one')
  await expect.poll(() => count.textContent()).toBe('2 words')

  // The count is of the document, not of what was typed this session.
  await page.waitForTimeout(500)
  await page.reload()
  await expect(prose(page)).toContainText('just one')
  await expect.poll(() => count.textContent()).toBe('2 words')
})

test('a viewer gets the View tab and a View only chip, and nothing else', async ({ page }) => {
  const label = `${LABEL}-viewer`
  const { workspace } = await seedWorkspace(label)
  const viewer = await addMember(workspace.id, label, 'viewer')
  const document = await createDocument(workspace.id, 'doc')
  await signIn(page, viewer.id)
  await page.goto(`/documents/${document.id}`)
  await expect(page.getByTestId('status')).toHaveAttribute('data-status', 'connected')

  await expect(page.getByRole('tab')).toHaveText(['View'])
  await expect(page.getByTestId('tb-tab-view')).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByTestId('tb-viewonly')).toHaveText('View only')
  // Absent, not disabled.
  await expect(page.getByTestId('tb-tab-home')).toHaveCount(0)
  await expect(page.getByTestId('tb-tab-insert')).toHaveCount(0)
  await expect(page.getByTestId('tb-row-view')).toBeVisible()
  await expect(prose(page)).toHaveAttribute('contenteditable', 'false')
})

test('a board has no toolbar at all', async ({ page }) => {
  const label = `${LABEL}-board`
  const { owner, workspace } = await seedWorkspace(label)
  const board = await createDocument(workspace.id, 'board')
  await signIn(page, owner.id)
  await page.goto(`/documents/${board.id}`)
  await expect(page.getByTestId('add-column')).toBeVisible()

  await expect(page.getByTestId('tb-root')).toHaveCount(0)
  await expect(page.getByRole('tab')).toHaveCount(0)
})

test('the tabs are reachable and operable from the keyboard', async ({ page }) => {
  await openDocument(page, `${LABEL}-keys`)

  // One Tab stop for the whole strip, landing on the open tab: shift-tab from the page
  // reaches it.
  await prose(page).click()
  await page.keyboard.press('Shift+Tab')
  await expect(page.getByTestId('tb-tab-home')).toBeFocused()

  await page.keyboard.press('ArrowRight')
  await expect(page.getByTestId('tb-tab-insert')).toBeFocused()
  await expect(page.getByTestId('tb-tab-insert')).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByTestId('tb-row-insert')).toBeVisible()

  await page.keyboard.press('End')
  await expect(page.getByTestId('tb-tab-view')).toBeFocused()
  await expect(page.getByTestId('tb-row-view')).toBeVisible()

  // Wraps, as a tablist does.
  await page.keyboard.press('ArrowRight')
  await expect(page.getByTestId('tb-tab-home')).toBeFocused()
  await expect(page.getByTestId('tb-row-home')).toBeVisible()

  await page.keyboard.press('ArrowLeft')
  await expect(page.getByTestId('tb-tab-view')).toBeFocused()
  await page.keyboard.press('Home')
  await expect(page.getByTestId('tb-tab-home')).toBeFocused()
})
