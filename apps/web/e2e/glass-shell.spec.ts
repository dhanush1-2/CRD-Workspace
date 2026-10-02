import { test, expect, type Page } from '@playwright/test'
import { cleanup, createDocument, seedWorkspace, signIn } from './fixtures.js'

const LABEL = 'e2e-glass-shell'

test.afterAll(async () => {
  await cleanup(LABEL)
})

test('the canvas background never intercepts a click', async ({ page }) => {
  await page.goto('/login')

  // Whatever sits at the centre of the viewport, it must not be the canvas.
  const tag = await page.evaluate(() => {
    const el = document.elementFromPoint(window.innerWidth / 2, window.innerHeight / 2)
    return el?.className ?? ''
  })
  expect(String(tag)).not.toContain('canvas')

  // Pinned directly, because nothing observable depends on it yet: on screens
  // whose content fills the viewport the content wrapper's z-index already wins,
  // so removing pointer-events:none changes nothing visible. It stops being
  // redundant the moment a screen is shorter than the viewport.
  const pointerEvents = await page
    .locator('[class*="canvas-background_canvas"]')
    .evaluate((el) => getComputedStyle(el).pointerEvents)
  expect(pointerEvents).toBe('none')

  // And the sign-in button is still genuinely clickable.
  await expect(page.getByTestId('signin-github')).toBeVisible()
  await page.getByTestId('signin-github').click({ trial: true })
})

test('role and type chips are actually styled, not bare text', async ({ page }) => {
  const label = `${LABEL}-chips`
  const { owner, workspace } = await seedWorkspace(label)
  const document = await createDocument(workspace.id, 'board')
  await signIn(page, owner.id)

  await page.goto(`/documents/${document.id}`)

  // A CSS-module class that no longer exists resolves to undefined and the chip
  // renders as plain text — invisible to every assertion that only locates it.
  const background = await page
    .getByTestId('role')
    .evaluate((el) => getComputedStyle(el).backgroundColor)
  expect(background).not.toBe('rgba(0, 0, 0, 0)')

  await cleanup(label)
})

test('account menu rows centre their labels vertically', async ({ page }) => {
  const label = `${LABEL}-menu`
  const { owner } = await seedWorkspace(label)
  await signIn(page, owner.id)

  await page.goto('/')
  await page.getByLabel('Account').click()

  // The two rows are different elements (a link and a button). Chromium centres
  // a button's label even at display:block but top-aligns a link's, so the rows
  // drift apart unless the row is a flex container. That passes typecheck and
  // every unit test, so measure it: each label's centre must sit on its row's.
  const offsets = await page.getByRole('menu').evaluate((menu) => {
    const rows = [
      menu.querySelector('a[role="menuitem"]'),
      menu.querySelector('button[role="menuitem"]'),
    ] as HTMLElement[]
    return rows.map((row) => {
      const range = document.createRange()
      range.selectNodeContents(row)
      const text = range.getBoundingClientRect()
      const box = row.getBoundingClientRect()
      return text.top + text.height / 2 - (box.top + box.height / 2)
    })
  })

  expect(offsets).toHaveLength(2)
  for (const offset of offsets) expect(Math.abs(offset)).toBeLessThanOrEqual(1)

  await cleanup(label)
})

/**
 * How far the sliding indicator is from the given tab, in px (the larger of the
 * horizontal offset and the width difference). The indicator is server-rendered
 * at width 0 and sized at hydration, and it slides for 0.55s after a change, so
 * callers poll this rather than read it once.
 */
async function indicatorGap(page: Page, tabTestId: string) {
  return page.evaluate((testId) => {
    const indicator = document.querySelector('[class*="indicator"]')
    const tab = document.querySelector(`[data-testid="${testId}"]`)
    if (!indicator || !tab) return Number.POSITIVE_INFINITY
    const a = indicator.getBoundingClientRect()
    const b = tab.getBoundingClientRect()
    return Math.max(Math.abs(a.x - b.x), Math.abs(a.width - b.width))
  }, tabTestId)
}

test('the nav shows a tab per document and marks the open one active', async ({ page }) => {
  const label = `${LABEL}-tabs`
  const { owner, workspace } = await seedWorkspace(label)
  const board = await createDocument(workspace.id, 'board')
  const doc = await createDocument(workspace.id, 'doc')
  await signIn(page, owner.id)

  await page.goto(`/documents/${board.id}`)

  await expect(page.getByTestId('tab-overview')).toBeVisible()
  await expect(page.getByTestId(`tab-${board.id}`)).toHaveAttribute('data-active', 'true')
  await expect(page.getByTestId(`tab-${board.id}`)).toHaveAttribute('aria-current', 'page')
  await expect(page.getByTestId(`tab-${doc.id}`)).toHaveAttribute('data-active', 'false')
  await expect(page.getByTestId(`tab-${doc.id}`)).not.toHaveAttribute('aria-current')

  // The indicator is measured from the active tab at hydration, so an unsized
  // or misplaced pill means the measurement never ran: the bug this test is for.
  await expect.poll(() => indicatorGap(page, `tab-${board.id}`)).toBeLessThanOrEqual(1)

  await cleanup(label)
})

test('the indicator tracks the active tab', async ({ page }) => {
  const label = `${LABEL}-slide`
  const { owner, workspace } = await seedWorkspace(label)
  const first = await createDocument(workspace.id, 'board')
  const second = await createDocument(workspace.id, 'doc')
  await signIn(page, owner.id)

  await page.goto(`/documents/${first.id}`)
  await expect.poll(() => indicatorGap(page, `tab-${first.id}`)).toBeLessThanOrEqual(1)

  await page.getByTestId(`tab-${second.id}`).click()
  await expect(page.getByTestId(`tab-${second.id}`)).toHaveAttribute('data-active', 'true')
  // Polled, not slept on: the slide takes 0.55s and the pill has to land on the
  // new tab's box, width included.
  await expect.poll(() => indicatorGap(page, `tab-${second.id}`)).toBeLessThanOrEqual(1)

  await cleanup(label)
})
