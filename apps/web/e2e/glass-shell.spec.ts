import { test, expect } from '@playwright/test'
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
