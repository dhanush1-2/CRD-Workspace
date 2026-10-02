import { test, expect } from '@playwright/test'
import { cleanup, seedWorkspace, signIn } from './fixtures.js'

const LABEL = 'e2e-doc-type'

test.afterAll(async () => {
  await cleanup(LABEL)
})

test('the document type control is a keyboard-operable radio group', async ({ page }) => {
  await cleanup(LABEL)
  const { owner, workspace } = await seedWorkspace(LABEL)
  await signIn(page, owner.id)
  await page.goto(`/workspaces/${workspace.id}`)

  const pageRadio = page.getByRole('radio', { name: 'Page' })
  const boardRadio = page.getByRole('radio', { name: 'Board' })

  // 1. The radios are invisible and clipped by design, so a keyboard user sees focus
  // only through the ring drawn on the segment. No ring means no visible focus.
  await page.getByTestId('document-title').focus()
  await page.keyboard.press('Tab')
  await expect(pageRadio).toBeFocused()
  const outlineStyle = await page
    .locator('label:has(input:focus-visible)')
    .evaluate((el) => getComputedStyle(el).outlineStyle)
  expect(outlineStyle).not.toBe('none')

  // 2. Arrow keys move the selection, which is what makes it a radio group rather
  // than two unrelated buttons.
  await page.keyboard.press('ArrowRight')
  await expect(boardRadio).toBeChecked()

  // 3. Creating a document puts the control back to its default, as the old select did.
  await page.getByTestId('document-title').fill('A board')
  await page.getByTestId('create-document').click()
  await expect(page.getByTestId('document-list')).toContainText('A board')
  await expect(pageRadio).toBeChecked()
  await expect(boardRadio).not.toBeChecked()
})
