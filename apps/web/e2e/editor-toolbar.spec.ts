import { test, expect, type Page } from '@playwright/test'
import {
  addMember,
  cleanup,
  createDocument,
  seedWorkspace,
  sessionCookieFor,
  signIn,
} from './fixtures.js'

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

  // Reachable from the page by keyboard, as one Tab stop that lands on the open tab. Walk
  // back from the editor until a tab holds focus. Bounded, and no count asserted: how
  // many controls sit in between is not what this is about.
  await prose(page).click()
  const tabFocused = () =>
    page.evaluate(() => document.activeElement?.getAttribute('role') === 'tab')
  for (let presses = 0; presses < 40 && !(await tabFocused()); presses += 1) {
    await page.keyboard.press('Shift+Tab')
  }
  await expect(page.getByTestId('tb-tab-home')).toBeFocused()
  // The roving tabindex is what makes the strip one stop: only the open tab is in the
  // Tab order, the other two are reached by arrow.
  await expect(page.getByTestId('tb-tab-insert')).toHaveAttribute('tabindex', '-1')
  await expect(page.getByTestId('tb-tab-view')).toHaveAttribute('tabindex', '-1')
  await expect(page.getByTestId('tb-tab-home')).toHaveAttribute('tabindex', '0')

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

// ---------------------------------------------------------------------------
// Home tab: the direct controls (handoff 12.2)
// ---------------------------------------------------------------------------

const tb = (page: Page, id: string) => page.getByTestId(`tb-${id}`)

/** Types a line into the editor and selects all of it, as a person would. */
async function typeAndSelect(page: Page, text: string) {
  await prose(page).click()
  await page.keyboard.type(text)
  await page.keyboard.press('ControlOrMeta+a')
}

const MARKS = [
  { id: 'bold', tag: 'strong' },
  { id: 'italic', tag: 'em' },
  { id: 'underline', tag: 'u' },
  { id: 'strike', tag: 's' },
] as const

for (const { id, tag } of MARKS) {
  test(`${id}: wraps the selection in <${tag}>, and a second click unwraps it`, async ({
    page,
  }) => {
    await openDocument(page, `${LABEL}-mark-${id}`)
    await typeAndSelect(page, 'some words')

    await tb(page, id).click()
    await expect(prose(page).locator(tag)).toHaveText('some words')

    await tb(page, id).click()
    await expect(prose(page).locator(tag)).toHaveCount(0)
    await expect(prose(page)).toContainText('some words')
  })

  test(`${id}: the button follows the caret, pressed inside it and not outside`, async ({
    page,
  }) => {
    await openDocument(page, `${LABEL}-pressed-${id}`)
    await prose(page).click()
    await page.keyboard.type('plain marked')
    // Select just "marked" and apply the mark to it.
    for (let i = 0; i < 'marked'.length; i += 1) await page.keyboard.press('Shift+ArrowLeft')
    await tb(page, id).click()
    await expect(prose(page).locator(tag)).toHaveText('marked')

    // Caret at the end, inside the marked run.
    await page.keyboard.press('End')
    await expect(tb(page, id)).toHaveAttribute('aria-pressed', 'true')

    // Caret inside "plain". Arrow keys, not Home: on macOS Home scrolls the page and
    // leaves the caret where it is. The other three marks stay unpressed throughout, so
    // a button that lit for the wrong mark would show up here.
    for (let i = 0; i < 9; i += 1) await page.keyboard.press('ArrowLeft')
    await expect(tb(page, id)).toHaveAttribute('aria-pressed', 'false')
    for (const other of MARKS.filter((entry) => entry.id !== id)) {
      await expect(tb(page, other.id)).toHaveAttribute('aria-pressed', 'false')
    }
  })
}

test('a toolbar click does not take focus or the selection from the editor', async ({ page }) => {
  await openDocument(page, `${LABEL}-keep`)
  await typeAndSelect(page, 'keep me')
  const state = () =>
    page.evaluate(() => ({
      selected: window.getSelection()?.toString() ?? '',
      inEditor: document.activeElement?.closest('.ProseMirror') !== null,
    }))

  // Press and hold. Focus moves on mousedown, so this is where the bug lives: by the time
  // click fires it has already happened, and a check made after the click cannot tell a
  // button that kept focus from one that took it and handed it back.
  const box = (await tb(page, 'bold').boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  expect(await state()).toEqual({ selected: 'keep me', inEditor: true })
  await page.mouse.up()

  await expect(prose(page).locator('strong')).toHaveText('keep me')
  expect(await state()).toEqual({ selected: 'keep me', inEditor: true })
})

test('hovering an active toggle keeps its accent fill', async ({ page }) => {
  await openDocument(page, `${LABEL}-hover`)
  await typeAndSelect(page, 'hover')
  await tb(page, 'bold').click()
  await expect(tb(page, 'bold')).toHaveAttribute('aria-pressed', 'true')

  // The pointer is on the button now, having just pressed it. An unpressed button turns
  // white on hover; a pressed one must keep --accent-soft, or the press would be invisible.
  const fill = (id: string) =>
    tb(page, id).evaluate((el) => getComputedStyle(el).backgroundColor)
  // The token as the browser resolves it, so the test does not copy its value.
  const accentSoft = await page.evaluate(() => {
    const probe = document.createElement('div')
    probe.style.background = 'var(--accent-soft)'
    document.body.append(probe)
    const resolved = getComputedStyle(probe).backgroundColor
    probe.remove()
    return resolved
  })
  expect(accentSoft).not.toBe('rgba(0, 0, 0, 0)')
  // Polled: the fill transitions in over a quarter of a second.
  await expect.poll(() => fill('bold')).toBe(accentSoft)
  await page.waitForTimeout(400)
  expect(await fill('bold')).toBe(accentSoft)

  await tb(page, 'italic').hover()
  await expect.poll(() => fill('italic')).toBe('rgba(255, 255, 255, 0.9)')
})

test('bulleted and numbered lists wrap the line, and toggle off again', async ({ page }) => {
  await openDocument(page, `${LABEL}-lists`)
  await prose(page).click()
  await page.keyboard.type('one')

  await tb(page, 'bullet').click()
  await expect(prose(page).locator('ul > li')).toHaveText('one')
  await expect(tb(page, 'bullet')).toHaveAttribute('aria-pressed', 'true')
  await expect(tb(page, 'ordered')).toHaveAttribute('aria-pressed', 'false')

  await tb(page, 'bullet').click()
  await expect(prose(page).locator('ul')).toHaveCount(0)
  await expect(tb(page, 'bullet')).toHaveAttribute('aria-pressed', 'false')

  await tb(page, 'ordered').click()
  await expect(prose(page).locator('ol > li')).toHaveText('one')
  await expect(tb(page, 'ordered')).toHaveAttribute('aria-pressed', 'true')
  await expect(tb(page, 'bullet')).toHaveAttribute('aria-pressed', 'false')
})

test('each alignment sets the paragraph and marks itself, and only itself, active', async ({
  page,
}) => {
  await openDocument(page, `${LABEL}-align`)
  await prose(page).click()
  await page.keyboard.type('aligned')
  const ids = ['left', 'center', 'right', 'justify'] as const

  // An untouched paragraph is left-aligned, and the bar says so.
  await expect(tb(page, 'align-left')).toHaveAttribute('aria-pressed', 'true')

  for (const id of [...ids].reverse()) {
    await tb(page, `align-${id}`).click()
    await expect(prose(page).locator('p').first()).toHaveCSS('text-align', id)
    for (const other of ids) {
      await expect(tb(page, `align-${other}`)).toHaveAttribute(
        'aria-pressed',
        other === id ? 'true' : 'false',
      )
    }
  }
})

test('clear formatting removes the marks and returns the block to a paragraph', async ({
  page,
}) => {
  await openDocument(page, `${LABEL}-clear`)
  await prose(page).click()
  // "# " is the editor's own input rule for a heading.
  await page.keyboard.type('# Loud title')
  await expect(prose(page).locator('h1')).toHaveText('Loud title')
  await page.keyboard.press('ControlOrMeta+a')
  await tb(page, 'bold').click()
  await tb(page, 'italic').click()
  await tb(page, 'align-center').click()
  await expect(prose(page).locator('h1 strong em')).toHaveText('Loud title')

  await tb(page, 'clear').click()

  await expect(prose(page).locator('h1')).toHaveCount(0)
  await expect(prose(page).locator('strong, em')).toHaveCount(0)
  // A trailing empty paragraph follows a heading or list, so match the one with the text.
  const paragraph = prose(page).locator('p', { hasText: 'Loud title' })
  await expect(paragraph).toHaveCount(1)
  await expect(paragraph).not.toHaveCSS('text-align', 'center')
})

test('clear formatting also lifts a line out of a list', async ({ page }) => {
  await openDocument(page, `${LABEL}-clear-list`)
  await prose(page).click()
  await page.keyboard.type('item')
  await tb(page, 'bullet').click()
  await expect(prose(page).locator('ul')).toHaveCount(1)

  await tb(page, 'clear').click()

  await expect(prose(page).locator('ul')).toHaveCount(0)
  await expect(prose(page).locator('p', { hasText: 'item' })).toHaveCount(1)
})

test('undo and redo walk the collaborative history', async ({ page }) => {
  await openDocument(page, `${LABEL}-history`)
  await prose(page).click()
  await page.keyboard.type('history')
  // The undo manager merges changes made within 500ms into one step. Wait, so typing and
  // formatting are two steps and the test can tell them apart.
  await page.waitForTimeout(700)
  await page.keyboard.press('ControlOrMeta+a')
  await tb(page, 'bold').click()
  await expect(prose(page).locator('strong')).toHaveText('history')

  await tb(page, 'undo').click()
  await expect(prose(page).locator('strong')).toHaveCount(0)
  await expect(prose(page)).toContainText('history')

  await tb(page, 'redo').click()
  await expect(prose(page).locator('strong')).toHaveText('history')

  // Undo again, and once more: the second step is the typing itself.
  await tb(page, 'undo').click()
  await tb(page, 'undo').click()
  await expect(prose(page)).not.toContainText('history')

  await tb(page, 'redo').click()
  await expect(prose(page)).toContainText('history')
  await expect(prose(page).locator('strong')).toHaveCount(0)
})

test('formatting made in one browser appears in the other', async ({ browser }) => {
  const label = `${LABEL}-sync`
  const { owner, workspace } = await seedWorkspace(label)
  const editor = await addMember(workspace.id, label, 'editor')
  const document = await createDocument(workspace.id, 'doc')

  async function openAs(userId: string): Promise<{ page: Page; close: () => Promise<void> }> {
    const context = await browser.newContext()
    await context.addCookies([await sessionCookieFor(userId)])
    const page = await context.newPage()
    // ?nobc=1 forces this tab to sync through the server rather than BroadcastChannel,
    // so what B sees has been through the CRDT and the wire, not a local shortcut.
    await page.goto(`/documents/${document.id}?nobc=1`)
    await expect(page.getByTestId('status')).toHaveAttribute('data-status', 'connected')
    await expect(prose(page)).toHaveAttribute('contenteditable', 'true')
    return { page, close: () => context.close() }
  }

  const a = await openAs(owner.id)
  const b = await openAs(editor.id)

  await typeAndSelect(a.page, 'shared styling')
  await tb(a.page, 'bold').click()
  await tb(a.page, 'italic').click()
  await tb(a.page, 'underline').click()
  await tb(a.page, 'strike').click()
  await tb(a.page, 'align-center').click()

  const text = prose(b.page)
  await expect(text.locator('strong')).toHaveText('shared styling')
  await expect(text.locator('em')).toHaveText('shared styling')
  await expect(text.locator('u')).toHaveText('shared styling')
  await expect(text.locator('s')).toHaveText('shared styling')
  await expect(text.locator('p').first()).toHaveCSS('text-align', 'center')

  // And a block change travels as well as a mark: a list made in B arrives in A.
  await b.page.locator('.editor .ProseMirror p').first().click()
  await tb(b.page, 'bullet').click()
  await expect(prose(a.page).locator('ul > li')).toContainText('shared styling')

  // B's own bar reflects what arrived, not only what B did: the caret sits in A's bold.
  await expect(tb(b.page, 'bold')).toHaveAttribute('aria-pressed', 'true')

  await a.close()
  await b.close()
})

test('a viewer gets none of the Home controls', async ({ page }) => {
  const label = `${LABEL}-viewer-home`
  const { workspace } = await seedWorkspace(label)
  const viewer = await addMember(workspace.id, label, 'viewer')
  const document = await createDocument(workspace.id, 'doc')
  await signIn(page, viewer.id)
  await page.goto(`/documents/${document.id}`)
  await expect(page.getByTestId('status')).toHaveAttribute('data-status', 'connected')

  await expect(page.getByTestId('tb-row-view')).toBeVisible()
  await expect(page.locator('[data-testid^="tb-bold"], [data-testid^="tb-undo"]')).toHaveCount(0)
})

test('the tool row is one Tab stop, and the arrow keys move within it', async ({ page }) => {
  await openDocument(page, `${LABEL}-roving`)
  await prose(page).click()

  const inRow = () =>
    page.evaluate(
      () => document.activeElement?.closest('[data-testid="tb-row-home"]') !== null,
    )
  const tabFocused = () =>
    page.evaluate(() => document.activeElement?.getAttribute('role') === 'tab')

  // Walk back from the editor to the tab strip and count the presses that land in the row.
  let stopsInRow = 0
  for (let presses = 0; presses < 40 && !(await tabFocused()); presses += 1) {
    await page.keyboard.press('Shift+Tab')
    if (await inRow()) stopsInRow += 1
  }
  await expect(page.getByTestId('tb-tab-home')).toBeFocused()
  expect(stopsInRow).toBe(1)

  // Back into the row with Tab: it lands on the one stop, the first tool.
  await page.keyboard.press('Tab')
  await expect(tb(page, 'undo')).toBeFocused()
  // Every other tool is out of the Tab order, and exactly one is in it.
  await expect(page.locator('[data-testid="tb-row-home"] [data-roving][tabindex="0"]')).toHaveCount(1)
  await expect(tb(page, 'redo')).toHaveAttribute('tabindex', '-1')
  await expect(tb(page, 'clear')).toHaveAttribute('tabindex', '-1')

  await page.keyboard.press('ArrowRight')
  await expect(tb(page, 'redo')).toBeFocused()
  await page.keyboard.press('ArrowLeft')
  await expect(tb(page, 'undo')).toBeFocused()
  // Wraps, as the tab strip does.
  await page.keyboard.press('ArrowLeft')
  await expect(tb(page, 'clear')).toBeFocused()
  await page.keyboard.press('ArrowRight')
  await expect(tb(page, 'undo')).toBeFocused()
  await page.keyboard.press('End')
  await expect(tb(page, 'clear')).toBeFocused()
  await page.keyboard.press('Home')
  await expect(tb(page, 'undo')).toBeFocused()

  // The stop follows focus: leave from Clear and come back to Clear.
  await page.keyboard.press('End')
  await page.keyboard.press('Tab')
  await expect(prose(page)).toBeFocused()
  await page.keyboard.press('Shift+Tab')
  await expect(tb(page, 'clear')).toBeFocused()
  await expect(tb(page, 'undo')).toHaveAttribute('tabindex', '-1')

  // And Enter on a focused tool presses it: the keyboard path works, not only the mouse.
  await page.keyboard.press('ArrowLeft')
  await expect(tb(page, 'align-justify')).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(tb(page, 'align-justify')).toHaveAttribute('aria-pressed', 'true')
})
