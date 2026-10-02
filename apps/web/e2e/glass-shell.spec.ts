import { test, expect, type Page } from '@playwright/test'
import { prisma } from '@crdt/db'
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

test('the nav logo actually renders at 36px', async ({ page }) => {
  const label = `${LABEL}-logo`
  const { owner } = await seedWorkspace(label)
  await signIn(page, owner.id)
  await page.goto('/')

  // The logo is an empty <span>. An inline non-replaced element ignores width and
  // height, so a missing display:block collapses it to nothing while every locator,
  // typecheck and unit test still passes. Measure the rendered box.
  const box = await page
    .getByRole('link', { name: 'All workspaces' })
    .locator('span')
    .evaluate((el) => {
      const rect = el.getBoundingClientRect()
      return { width: rect.width, height: rect.height }
    })
  expect(box.width).toBeCloseTo(36, 0)
  expect(box.height).toBeCloseTo(36, 0)

  await cleanup(label)
})

test('a very long workspace name truncates in the nav instead of scrolling the page', async ({
  page,
}) => {
  const label = `${LABEL}-longname`
  const { owner, workspace } = await seedWorkspace(label)
  await prisma.workspace.update({ where: { id: workspace.id }, data: { name: 'W'.repeat(120) } })
  await createDocument(workspace.id, 'doc')
  await signIn(page, owner.id)

  // Pinned, because the verdict depends on the viewport.
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.goto(`/workspaces/${workspace.id}`)

  // The workspace link does not wrap, so unless it shrinks, 120 characters
  // widen the nav past the viewport and the page scrolls horizontally.
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }))
  expect(scrollWidth - clientWidth).toBeLessThanOrEqual(2)

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

test('a strip the user has scrolled by hand is not pulled back to the active tab', async ({
  page,
}) => {
  const label = `${LABEL}-scroll`
  const { owner, workspace } = await seedWorkspace(label)
  // Pin the viewport so the document count below means something. The strip
  // shares the nav with the workspace name, so its width depends on that label
  // too. Measured with this label at 1280x720 and "e2e doc" tabs: 9 documents
  // overflow by about 108px, which is the scroll range this test needs. Fewer
  // documents were not measured with this label, so no claim is made about
  // where the strip stops overflowing. If fonts or padding change and it stops
  // overflowing, the premise check below fails loudly rather than the test
  // passing on nothing.
  await page.setViewportSize({ width: 1280, height: 720 })
  const documents = []
  for (let i = 0; i < 9; i++) documents.push(await createDocument(workspace.id, 'doc'))
  await signIn(page, owner.id)

  // The first document, so the active tab sits at the left edge and anything
  // scrolling the strip back toward it would be visible as scrollLeft dropping.
  await page.goto(`/documents/${documents[0]!.id}`)
  const strip = page.locator('[class*="strip"]')
  await expect(page.getByTestId(`tab-${documents[0]!.id}`)).toHaveAttribute('data-active', 'true')

  // Guard the premise: if the strip does not overflow there is nothing to scroll.
  await expect
    .poll(() => strip.evaluate((el) => el.scrollWidth - el.clientWidth))
    .toBeGreaterThan(40)

  await strip.hover()
  await page.mouse.wheel(2000, 0)

  // Wait for scrollLeft to hold still for 500ms, which outlasts the start of a
  // smooth scroll-back, instead of sleeping a fixed time and hoping.
  await strip.evaluate(
    (el) =>
      new Promise<void>((resolve) => {
        let last = el.scrollLeft
        let since = performance.now()
        const tick = () => {
          if (el.scrollLeft !== last) {
            last = el.scrollLeft
            since = performance.now()
          } else if (performance.now() - since >= 500) {
            resolve()
            return
          }
          requestAnimationFrame(tick)
        }
        requestAnimationFrame(tick)
      }),
  )

  const { scrollLeft, max } = await strip.evaluate((el) => ({
    scrollLeft: el.scrollLeft,
    max: el.scrollWidth - el.clientWidth,
  }))
  expect(max).toBeGreaterThan(40)
  expect(scrollLeft).toBeGreaterThanOrEqual(max - 2)

  await cleanup(label)
})

test('a 200-character single-word document title wraps inside its tile', async ({ page }) => {
  const label = `${LABEL}-longtitle`
  const { owner, workspace } = await seedWorkspace(label)
  const document = await prisma.document.create({
    data: { workspaceId: workspace.id, type: 'doc', title: 'W'.repeat(200) },
  })
  await signIn(page, owner.id)

  await page.setViewportSize({ width: 1280, height: 800 })
  await page.goto(`/workspaces/${workspace.id}`)

  const tile = page.getByTestId(`document-${document.id}`)
  await expect(tile).toBeVisible()

  // An unbreakable word has a huge min-content width. Without overflow-wrap on the
  // text column it stretches the tile (and the grid column with it), so the text
  // runs past the tile's right edge and the page scrolls sideways.
  const { textRight, tileRight, tileScroll, tileClient, pageOverflow } = await tile.evaluate(
    (el) => {
      const text = el.querySelector('span:last-child > span:first-child')!.getBoundingClientRect()
      return {
        textRight: text.right,
        tileRight: el.getBoundingClientRect().right,
        tileScroll: el.scrollWidth,
        tileClient: el.clientWidth,
        pageOverflow:
          window.document.documentElement.scrollWidth -
          window.document.documentElement.clientWidth,
      }
    },
  )
  expect(textRight).toBeLessThanOrEqual(tileRight)
  expect(tileScroll).toBeLessThanOrEqual(tileClient)
  expect(pageOverflow).toBeLessThanOrEqual(0)

  await cleanup(label)
})
