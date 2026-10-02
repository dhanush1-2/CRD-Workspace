import { test, expect, type Locator, type Page } from '@playwright/test'
import { cleanup, createDocument, seedWorkspace, signIn } from './fixtures.js'

const LABEL = 'e2e-board'

test.afterAll(async () => {
  await cleanup(LABEL)
})

/** Opens a fresh board with `columns` empty columns; returns the page and the column ids. */
async function openBoard(page: Page, label: string, columns: number) {
  const { owner, workspace } = await seedWorkspace(label)
  const document = await createDocument(workspace.id, 'board')
  await signIn(page, owner.id)
  await page.goto(`/documents/${document.id}`)
  await expect(page.getByTestId('status')).toHaveText('connected')

  for (let i = 1; i <= columns; i++) {
    await page.getByTestId('add-column').click()
    await expect(page.locator('[data-testid^="column-"]')).toHaveCount(i)
  }
  const testIds = await page
    .locator('[data-testid^="column-"]')
    .evaluateAll((els) => els.map((el) => el.getAttribute('data-testid')!))
  return testIds.map((testId) => testId.replace('column-', ''))
}

/** Adds a card to the column and returns its id once it has rendered. */
async function addCard(page: Page, columnId: string) {
  const column = page.getByTestId(`column-${columnId}`)
  const before = await column.locator('[data-testid^="card-"]').count()
  await page.getByTestId(`add-card-${columnId}`).click()
  await expect(column.locator('[data-testid^="card-"]')).toHaveCount(before + 1)
  const testId = await column
    .locator('[data-testid^="card-"]')
    .nth(before)
    .getAttribute('data-testid')
  return testId!.replace('card-', '')
}

/** Card ids in a column, top to bottom as rendered. */
async function cardOrder(page: Page, columnId: string) {
  const testIds = await page
    .getByTestId(`column-${columnId}`)
    .locator('[data-testid^="card-"]')
    .evaluateAll((els) => els.map((el) => el.getAttribute('data-testid')!))
  return testIds.map((testId) => testId.replace('card-', ''))
}

/**
 * Drags `source` onto `target` with real pointer input. Chromium turns the mouse
 * gesture into genuine dragstart/dragover/drop events sharing one DataTransfer,
 * so the component's own application/x-card payload travels end to end.
 */
async function drag(source: Locator, target: Locator) {
  await source.dragTo(target)
}

test('a card dragged onto another column moves there', async ({ page }) => {
  const label = `${LABEL}-move`
  const [first, second] = await openBoard(page, label, 2)
  const cardId = await addCard(page, first!)
  const card = page.getByTestId(`card-${cardId}`)
  await expect(card).toHaveAttribute('data-column', first!)

  await drag(card, page.getByTestId(`column-${second}`))

  // data-column is rendered from the Yjs doc, so it only changes if the move was
  // actually written there. A card that merely looked moved would keep the old id.
  await expect(card).toHaveAttribute('data-column', second!)
  await expect(page.getByTestId(`column-${second}`).getByTestId(`card-${cardId}`)).toHaveCount(1)
  await expect(page.getByTestId(`column-${first}`).locator('[data-testid^="card-"]')).toHaveCount(0)

  await cleanup(label)
})

test('a card dropped onto a sibling reorders within its column', async ({ page }) => {
  const label = `${LABEL}-reorder`
  const [column] = await openBoard(page, label, 1)
  const top = await addCard(page, column!)
  const bottom = await addCard(page, column!)
  expect(await cardOrder(page, column!)).toEqual([top, bottom])

  // Dropping on a card passes its id as beforeCardId, a different path from
  // dropping on the column body: the dragged card lands ahead of the target.
  await drag(page.getByTestId(`card-${bottom}`), page.getByTestId(`card-${top}`))

  await expect.poll(() => cardOrder(page, column!)).toEqual([bottom, top])
  // Still one column: a reorder must not change the card's column.
  await expect(page.getByTestId(`card-${bottom}`)).toHaveAttribute('data-column', column!)

  await cleanup(label)
})

test('a card is not left dimmed after a completed drop', async ({ page }) => {
  const label = `${LABEL}-stuck`
  const [first, second] = await openBoard(page, label, 2)
  const cardId = await addCard(page, first!)
  const card = page.getByTestId(`card-${cardId}`)

  await drag(card, page.getByTestId(`column-${second}`))
  await expect(card).toHaveAttribute('data-column', second!)

  // The dragging class sets opacity 0.4. Its name is hashed by CSS Modules, so
  // matching it would pin a build detail; the computed opacity is what the user
  // sees. Polled, because the card remounts under its new column and its entry
  // animation can still be running for a moment.
  await expect
    .poll(() => card.evaluate((el) => getComputedStyle(el).opacity))
    .toBe('1')

  await cleanup(label)
})
