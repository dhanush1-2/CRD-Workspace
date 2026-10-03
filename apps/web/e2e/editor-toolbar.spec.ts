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

// ---------------------------------------------------------------------------
// The dropdowns: Style, text colour and highlight (handoff 12.5)
// ---------------------------------------------------------------------------

/** A colour as the browser computes it, so a test compares like with like (hex or var()). */
const resolved = (page: Page, value: string) =>
  page.evaluate((input) => {
    const probe = document.createElement('div')
    probe.style.color = input
    document.body.append(probe)
    const out = getComputedStyle(probe).color
    probe.remove()
    return out
  }, value)

const STYLES = ['title', 'heading', 'subheading', 'normal', 'quote', 'code'] as const

/** Opens a menu with the mouse, the way a person does: focus stays in the editor. */
async function openMenu(page: Page, id: 'style' | 'color' | 'highlight') {
  await tb(page, id).click()
  await expect(tb(page, `${id}-menu`)).toBeVisible()
}

/** The one thing a toolbar press must not change: where focus and the selection are. */
const editorState = (page: Page) =>
  page.evaluate(() => ({
    selected: (window.getSelection()?.toString() ?? '').trim(),
    inEditor: document.activeElement?.closest('.ProseMirror') !== null,
  }))

test('the Style trigger names the current block and follows the caret', async ({ page }) => {
  await openDocument(page, `${LABEL}-style-name`)
  await prose(page).click()
  const current = tb(page, 'style-current')

  await expect(current).toHaveText('Normal text')
  // "# " is the editor's own input rule for a heading.
  await page.keyboard.type('# one')
  await expect(current).toHaveText('Title')
  await page.keyboard.press('Enter')
  await page.keyboard.type('two')
  await expect(current).toHaveText('Normal text')
  await page.keyboard.press('ArrowUp')
  await expect(current).toHaveText('Title')

  // A level the menu has no row for is named honestly, and no row claims to be selected.
  await page.keyboard.press('End')
  await page.keyboard.press('Enter')
  await page.keyboard.type('#### deep')
  await expect(current).toHaveText('Heading 4')
  await openMenu(page, 'style')
  for (const id of STYLES) await expect(tb(page, `style-${id}`)).toHaveAttribute('aria-selected', 'false')
})

test('each Style option sets that block type, and moves cleanly between them', async ({ page }) => {
  await openDocument(page, `${LABEL}-style-set`)
  await prose(page).click()
  await page.keyboard.type('line')

  const choose = async (id: (typeof STYLES)[number]) => {
    await openMenu(page, 'style')
    await tb(page, `style-${id}`).click()
    await expect(tb(page, 'style-menu')).toHaveCount(0)
  }

  await choose('title')
  await expect(prose(page).locator('h1')).toHaveText('line')
  await choose('heading')
  await expect(prose(page).locator('h2')).toHaveText('line')
  await expect(prose(page).locator('h1')).toHaveCount(0)
  await choose('subheading')
  await expect(prose(page).locator('h3')).toHaveText('line')
  await choose('normal')
  await expect(prose(page).locator('h1, h2, h3')).toHaveCount(0)
  await expect(prose(page).locator('p', { hasText: 'line' })).toHaveCount(1)

  await choose('quote')
  await expect(prose(page).locator('blockquote p')).toHaveText('line')
  // Quote again must not nest a second quote inside the first.
  await choose('quote')
  await expect(prose(page).locator('blockquote')).toHaveCount(1)
  await expect(prose(page).locator('blockquote blockquote')).toHaveCount(0)

  // Moving off a quote leaves it, rather than putting a heading or code inside it.
  await choose('code')
  await expect(prose(page).locator('pre code')).toHaveText('line')
  await expect(prose(page).locator('blockquote')).toHaveCount(0)
  await choose('quote')
  await expect(prose(page).locator('blockquote p')).toHaveText('line')
  await expect(prose(page).locator('pre')).toHaveCount(0)
  await choose('title')
  await expect(prose(page).locator('h1')).toHaveText('line')
  await expect(prose(page).locator('blockquote')).toHaveCount(0)

  // And the trigger agrees with what the document now holds.
  await expect(tb(page, 'style-current')).toHaveText('Title')
  await openMenu(page, 'style')
  await expect(tb(page, 'style-title')).toHaveAttribute('aria-selected', 'true')
  await expect(tb(page, 'style-normal')).toHaveAttribute('aria-selected', 'false')
})

test('each Style row previews in its own style and shows its shortcut', async ({ page }) => {
  await openDocument(page, `${LABEL}-style-look`)
  await prose(page).click()
  await openMenu(page, 'style')

  const look = (id: string) =>
    tb(page, `style-${id}-preview`).evaluate((el) => {
      const style = getComputedStyle(el)
      return {
        size: style.fontSize,
        weight: style.fontWeight,
        family: style.fontFamily,
        rule: style.borderLeftWidth,
      }
    })
  expect(await look('title')).toMatchObject({ size: '22px', weight: '600' })
  expect(await look('heading')).toMatchObject({ size: '17px', weight: '600' })
  expect(await look('subheading')).toMatchObject({ size: '15px', weight: '600' })
  expect(await look('normal')).toMatchObject({ size: '14.5px', weight: '400' })
  expect(await look('quote')).toMatchObject({ size: '14.5px', rule: '2px' })
  const code = await look('code')
  expect(code.size).toBe('13px')
  expect(code.family).toMatch(/monospace|Menlo|Mono/)
  // Only Quote carries the violet rule.
  expect((await look('normal')).rule).toBe('0px')

  const shortcuts = { title: '⌘⌥1', heading: '⌘⌥2', subheading: '⌘⌥3', normal: '⌘⌥0', quote: '', code: '' }
  for (const [id, shortcut] of Object.entries(shortcuts)) {
    await expect(tb(page, `style-${id}-shortcut`)).toHaveText(shortcut)
  }

  // The shell's measurements: a 240px panel, rows at least 38px (the 22px Title grows past
  // it, the rest sit on it), 40px below the trigger, and a 150x32 trigger.
  const menu = (await tb(page, 'style-menu').boundingBox())!
  const trigger = (await tb(page, 'style').boundingBox())!
  expect(menu.width).toBeCloseTo(240, 0)
  expect(menu.y - trigger.y).toBeCloseTo(40, 0)
  expect(trigger.width).toBeCloseTo(150, 0)
  expect(trigger.height).toBeCloseTo(32, 0)
  for (const id of STYLES) {
    const height = (await tb(page, `style-${id}`).boundingBox())!.height
    expect(height).toBeGreaterThanOrEqual(37.5)
    if (id !== 'title') expect(height).toBeCloseTo(38, 0)
  }
})

const TEXT_SWATCHES = [
  ['default', '#1c1d1b'],
  ['grey', '#6c6f6a'],
  ['violet', 'var(--accent)'],
  ['red', '#c4372b'],
  ['orange', '#c9661a'],
  ['green', '#2f8a4f'],
  ['blue', '#2f6fd0'],
  ['pink', '#c2417f'],
] as const

const HIGHLIGHT_SWATCHES = [
  ['none', null],
  ['yellow', '#fde68a'],
  ['green', '#c9f0d3'],
  ['blue', '#d3e4ff'],
  ['pink', '#ffd6e8'],
  ['violet', '#e4d8fb'],
  ['orange', '#ffe0c2'],
  ['grey', '#e6e6ea'],
] as const

test('the colour menus lay out as the design says, with every swatch its own colour', async ({
  page,
}) => {
  await openDocument(page, `${LABEL}-swatches`)
  await prose(page).click()

  for (const [menu, swatches, title] of [
    ['color', TEXT_SWATCHES, 'Text color'],
    ['highlight', HIGHLIGHT_SWATCHES, 'Highlight'],
  ] as const) {
    await openMenu(page, menu)
    await expect(tb(page, `${menu}-menu`)).toContainText(title)
    expect((await tb(page, `${menu}-menu`).boundingBox())!.width).toBeCloseTo(170, 0)

    const boxes = []
    for (const [id, value] of swatches) {
      const swatch = tb(page, `${menu}-${id}`)
      boxes.push((await swatch.boundingBox())!)
      if (value) {
        await expect(swatch).toHaveCSS('background-color', await resolved(page, value))
      } else {
        // "None": white with a red diagonal, drawn as a gradient.
        await expect(swatch).toHaveCSS('background-image', /linear-gradient/)
      }
    }
    // 28px circles, four to a row with 8px between, then a second row 36px down.
    for (const box of boxes) expect([box.width, box.height]).toEqual([28, 28])
    expect(boxes[1]!.x - boxes[0]!.x).toBeCloseTo(36, 0)
    expect(boxes[3]!.y).toBeCloseTo(boxes[0]!.y, 0)
    expect(boxes[4]!.y - boxes[0]!.y).toBeCloseTo(36, 0)
    expect(boxes[4]!.x).toBeCloseTo(boxes[0]!.x, 0)
    await page.keyboard.press('Escape')
  }
})

test('the colour menu colours the selection and marks the swatch that matches it', async ({
  page,
}) => {
  await openDocument(page, `${LABEL}-colour`)
  await typeAndSelect(page, 'paint me')

  // Nothing coloured yet: Default is the one selected.
  await openMenu(page, 'color')
  await expect(tb(page, 'color-default')).toHaveAttribute('aria-selected', 'true')
  await tb(page, 'color-red').click()
  await expect(prose(page).locator('span[style^="color"]')).toHaveText('paint me')
  await expect(prose(page).locator('span[style^="color"]')).toHaveCSS(
    'color',
    await resolved(page, '#c4372b'),
  )

  // The swatch that matches is marked, and only that one, with a ring in its own colour.
  await openMenu(page, 'color')
  await expect(tb(page, 'color-red')).toHaveAttribute('aria-selected', 'true')
  await expect(tb(page, 'color-default')).toHaveAttribute('aria-selected', 'false')
  await expect(tb(page, 'color-blue')).toHaveAttribute('aria-selected', 'false')
  await expect(tb(page, 'color-red')).toHaveCSS('box-shadow', /0px 0px 0px 4px/)
  await expect(tb(page, 'color-blue')).not.toHaveCSS('box-shadow', /0px 0px 0px 4px/)

  // Violet follows the accent token rather than a copy of it.
  await tb(page, 'color-violet').click()
  await expect(prose(page).locator('span[style^="color"]')).toHaveCSS(
    'color',
    await resolved(page, 'var(--accent)'),
  )

  // Default takes the colour off; it does not paint the run a second "default".
  await openMenu(page, 'color')
  await tb(page, 'color-default').click()
  await expect(prose(page).locator('span[style^="color"]')).toHaveCount(0)
  await expect(prose(page)).toContainText('paint me')

  // The caret reads the colour back: inside coloured text the swatch is marked, outside not.
  await tb(page, 'color').click()
  await tb(page, 'color-green').click()
  await page.keyboard.press('ArrowRight')
  await page.keyboard.type(' plain')
  await openMenu(page, 'color')
  await expect(tb(page, 'color-default')).toHaveAttribute('aria-selected', 'true')
})

test('the highlight menu highlights the selection, and None removes it', async ({ page }) => {
  await openDocument(page, `${LABEL}-highlight`)
  await typeAndSelect(page, 'mark me')

  await openMenu(page, 'highlight')
  await expect(tb(page, 'highlight-none')).toHaveAttribute('aria-selected', 'true')
  await tb(page, 'highlight-blue').click()
  await expect(prose(page).locator('mark')).toHaveText('mark me')
  await expect(prose(page).locator('mark')).toHaveCSS('background-color', await resolved(page, '#d3e4ff'))

  await openMenu(page, 'highlight')
  await expect(tb(page, 'highlight-blue')).toHaveAttribute('aria-selected', 'true')
  await expect(tb(page, 'highlight-none')).toHaveAttribute('aria-selected', 'false')
  await expect(tb(page, 'highlight-yellow')).toHaveAttribute('aria-selected', 'false')

  // A second colour replaces the first rather than stacking marks.
  await tb(page, 'highlight-pink').click()
  await expect(prose(page).locator('mark')).toHaveCount(1)
  await expect(prose(page).locator('mark')).toHaveCSS('background-color', await resolved(page, '#ffd6e8'))

  await openMenu(page, 'highlight')
  await tb(page, 'highlight-none').click()
  await expect(prose(page).locator('mark')).toHaveCount(0)
  await expect(prose(page)).toContainText('mark me')
})

test('the A and the marker show a bar in the last colour used, and keep it across tabs', async ({
  page,
}) => {
  await openDocument(page, `${LABEL}-bars`)
  await typeAndSelect(page, 'bars')
  const bar = (id: 'color' | 'highlight') =>
    tb(page, `${id}-bar`).evaluate((el) => {
      const style = getComputedStyle(el)
      return el instanceof SVGElement ? style.stroke : style.backgroundColor
    })

  // The design's starting colours: the text colour and yellow.
  expect(await bar('color')).toBe(await resolved(page, '#1c1d1b'))
  expect(await bar('highlight')).toBe(await resolved(page, '#fde68a'))

  await openMenu(page, 'color')
  await tb(page, 'color-blue').click()
  await openMenu(page, 'highlight')
  await tb(page, 'highlight-green').click()
  expect(await bar('color')).toBe(await resolved(page, '#2f6fd0'))
  expect(await bar('highlight')).toBe(await resolved(page, '#c9f0d3'))

  // None removes a highlight; it is not a colour, so the bar keeps the last real one.
  await openMenu(page, 'highlight')
  await tb(page, 'highlight-none').click()
  expect(await bar('highlight')).toBe(await resolved(page, '#c9f0d3'))

  // The Home row remounts when the tab changes; the bars must not reset with it.
  await tb(page, 'tab-insert').click()
  await tb(page, 'tab-home').click()
  expect(await bar('color')).toBe(await resolved(page, '#2f6fd0'))
  expect(await bar('highlight')).toBe(await resolved(page, '#c9f0d3'))
})

test('a menu closes on Esc, on a click outside the toolbar, and on choosing an item', async ({
  page,
}) => {
  await openDocument(page, `${LABEL}-close`)
  await typeAndSelect(page, 'close')

  for (const id of ['style', 'color', 'highlight'] as const) {
    const menu = tb(page, `${id}-menu`)

    // Esc, with focus still in the editor after a mouse open.
    await openMenu(page, id)
    await page.keyboard.press('Escape')
    await expect(menu).toHaveCount(0)

    // A click outside the toolbar.
    await openMenu(page, id)
    await prose(page).click()
    await expect(menu).toHaveCount(0)

    // Choosing an item.
    await page.keyboard.press('ControlOrMeta+a')
    await openMenu(page, id)
    await tb(page, id === 'style' ? 'style-normal' : `${id}-${id === 'color' ? 'red' : 'yellow'}`).click()
    await expect(menu).toHaveCount(0)

    // The trigger toggles it too.
    await openMenu(page, id)
    await tb(page, id).click()
    await expect(menu).toHaveCount(0)
  }

  // The design says "outside the toolbar": a press elsewhere on the toolbar is not a close.
  await openMenu(page, 'style')
  await page.getByTestId('tb-wordcount').click()
  await expect(tb(page, 'style-menu')).toBeVisible()
})

test('opening one menu closes any other', async ({ page }) => {
  await openDocument(page, `${LABEL}-exclusive`)
  await prose(page).click()

  await openMenu(page, 'style')
  await openMenu(page, 'color')
  await expect(tb(page, 'style-menu')).toHaveCount(0)
  await expect(tb(page, 'color-menu')).toBeVisible()

  await openMenu(page, 'highlight')
  await expect(tb(page, 'color-menu')).toHaveCount(0)
  await expect(tb(page, 'highlight-menu')).toBeVisible()

  await openMenu(page, 'style')
  await expect(tb(page, 'highlight-menu')).toHaveCount(0)
  await expect(page.locator('[data-testid$="-menu"]')).toHaveCount(1)
  await expect(tb(page, 'style')).toHaveAttribute('aria-expanded', 'true')
  await expect(tb(page, 'color')).toHaveAttribute('aria-expanded', 'false')
})

test('the Style menu works from the keyboard, and Esc returns focus to the trigger', async ({
  page,
}) => {
  await openDocument(page, `${LABEL}-style-keys`)
  await prose(page).click()
  await page.keyboard.type('abc')

  await tb(page, 'style').focus()
  await page.keyboard.press('Enter')
  await expect(tb(page, 'style-menu')).toBeVisible()
  // Opens on the current value, with focus inside it.
  await expect(tb(page, 'style-normal')).toBeFocused()
  await page.keyboard.press('ArrowDown')
  await expect(tb(page, 'style-quote')).toBeFocused()
  await page.keyboard.press('ArrowUp')
  await page.keyboard.press('ArrowUp')
  await expect(tb(page, 'style-subheading')).toBeFocused()

  await page.keyboard.press('Escape')
  await expect(tb(page, 'style-menu')).toHaveCount(0)
  await expect(tb(page, 'style')).toBeFocused()

  // Down on the trigger opens it; Home and Enter choose the first row.
  await page.keyboard.press('ArrowDown')
  await expect(tb(page, 'style-normal')).toBeFocused()
  await page.keyboard.press('Home')
  await expect(tb(page, 'style-title')).toBeFocused()
  await page.keyboard.press('Enter')
  await expect(prose(page).locator('h1')).toHaveText('abc')
  await expect(tb(page, 'style-menu')).toHaveCount(0)
  // The keyboard user stays on the trigger, which now names the new style.
  await expect(tb(page, 'style')).toBeFocused()
  await expect(tb(page, 'style-current')).toHaveText('Title')

  // Tab out of an open menu closes it.
  await page.keyboard.press('Enter')
  await expect(tb(page, 'style-menu')).toBeVisible()
  await page.keyboard.press('Tab')
  await expect(tb(page, 'style-menu')).toHaveCount(0)
})

test('the swatch grid moves by arrow keys and chooses with Enter', async ({ page }) => {
  await openDocument(page, `${LABEL}-grid-keys`)
  await typeAndSelect(page, 'grid')

  await tb(page, 'color').focus()
  await page.keyboard.press('Enter')
  await expect(tb(page, 'color-default')).toBeFocused()
  // The row's own arrow handling must not take these: Right moves within the grid, not on
  // to the highlight button beside the trigger.
  await page.keyboard.press('ArrowRight')
  await expect(tb(page, 'color-grey')).toBeFocused()
  await page.keyboard.press('ArrowDown')
  await expect(tb(page, 'color-green')).toBeFocused()
  await page.keyboard.press('ArrowLeft')
  await expect(tb(page, 'color-orange')).toBeFocused()
  await page.keyboard.press('ArrowUp')
  await expect(tb(page, 'color-default')).toBeFocused()
  await page.keyboard.press('End')
  await expect(tb(page, 'color-pink')).toBeFocused()
  await page.keyboard.press('Home')
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('ArrowRight')
  await expect(tb(page, 'color-red')).toBeFocused()

  await page.keyboard.press('Enter')
  await expect(prose(page).locator('span[style^="color"]')).toHaveCSS(
    'color',
    await resolved(page, '#c4372b'),
  )
  await expect(tb(page, 'color-menu')).toHaveCount(0)
  await expect(tb(page, 'color')).toBeFocused()

  // Reopened, it starts on the swatch that is current.
  await page.keyboard.press('Enter')
  await expect(tb(page, 'color-red')).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(tb(page, 'color')).toBeFocused()
})

test('the selection and focus survive opening and using each menu', async ({ page }) => {
  await openDocument(page, `${LABEL}-menu-selection`)
  await typeAndSelect(page, 'keep me')
  expect(await editorState(page)).toEqual({ selected: 'keep me', inEditor: true })

  /**
   * Press, check, release. Focus moves on mousedown, so a check made after the click
   * cannot tell a control that kept focus from one that took it and handed it back.
   */
  async function hold(id: string) {
    const box = (await tb(page, id).boundingBox())!
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down()
    expect(await editorState(page), `${id} on mousedown`).toEqual({
      selected: 'keep me',
      inEditor: true,
    })
    await page.mouse.up()
  }

  // The trigger, then the item: both are presses that must leave the editor alone, and
  // the second is the one that goes wrong silently, applying its colour to nothing.
  await hold('color')
  await expect(tb(page, 'color-menu')).toBeVisible()
  await hold('color-red')
  await expect(tb(page, 'color-menu')).toHaveCount(0)
  await expect(prose(page).locator('span[style^="color"]')).toHaveText('keep me')
  expect(await editorState(page)).toEqual({ selected: 'keep me', inEditor: true })

  await hold('highlight')
  await hold('highlight-yellow')
  await expect(prose(page).locator('mark')).toHaveText('keep me')
  expect(await editorState(page)).toEqual({ selected: 'keep me', inEditor: true })

  await hold('style')
  await hold('style-title')
  await expect(prose(page).locator('h1')).toHaveText('keep me')
  // Still the same selection, still coloured and highlighted: three commands, one range.
  await expect(prose(page).locator('h1 span[style^="color"] mark, h1 mark span[style^="color"]')).toHaveText('keep me')
  expect(await editorState(page)).toEqual({ selected: 'keep me', inEditor: true })
})

test('a menu’s items are not stops of the tool row', async ({ page }) => {
  await openDocument(page, `${LABEL}-menu-roving`)
  await prose(page).click()
  const stops = page.locator('[data-testid="tb-row-home"] [data-roving]')
  const before = await stops.count()
  // The three triggers joined the row; their items must not.
  expect(before).toBeGreaterThan(14)

  for (const id of ['style', 'color', 'highlight'] as const) {
    await openMenu(page, id)
    await expect(stops).toHaveCount(before)
    await expect(page.locator('[data-testid="tb-row-home"] [data-roving][tabindex="0"]')).toHaveCount(1)
    await expect(page.locator(`[data-testid="tb-${id}-menu"] [data-roving]`)).toHaveCount(0)
    await expect(page.locator(`[data-testid="tb-${id}-menu"] [data-menu-item]`).first()).toHaveAttribute(
      'tabindex',
      '-1',
    )
    await page.keyboard.press('Escape')
  }

  // And the triggers are stops, in the design's order, between the neighbours they sit by.
  await tb(page, 'redo').focus()
  await page.keyboard.press('ArrowRight')
  await expect(tb(page, 'style')).toBeFocused()
  await page.keyboard.press('ArrowRight')
  await expect(tb(page, 'bold')).toBeFocused()
  await tb(page, 'strike').focus()
  await page.keyboard.press('ArrowRight')
  await expect(tb(page, 'color')).toBeFocused()
  await page.keyboard.press('ArrowRight')
  await expect(tb(page, 'highlight')).toBeFocused()
  await page.keyboard.press('ArrowRight')
  await expect(tb(page, 'bullet')).toBeFocused()
})

test('modified arrows are left to the browser, in the tool row and on the tab strip', async ({
  page,
}) => {
  await openDocument(page, `${LABEL}-modified-keys`)

  // Dispatched rather than pressed: Alt+Left is the browser's Back, which a real press
  // would act on. What matters is whether the page called preventDefault on it.
  const prevented = (init: KeyboardEventInit) =>
    page.evaluate((keyInit) => {
      const event = new KeyboardEvent('keydown', { ...keyInit, bubbles: true, cancelable: true })
      document.activeElement?.dispatchEvent(event)
      return event.defaultPrevented
    }, init)

  await tb(page, 'bold').focus()
  expect(await prevented({ key: 'ArrowLeft', altKey: true })).toBe(false)
  expect(await prevented({ key: 'Home', ctrlKey: true })).toBe(false)
  expect(await prevented({ key: 'ArrowRight', metaKey: true })).toBe(false)
  expect(await prevented({ key: 'ArrowRight', shiftKey: true })).toBe(false)
  await expect(tb(page, 'bold')).toBeFocused()
  // The control: the same keys unmodified are handled, so the probe reaches the handler.
  expect(await prevented({ key: 'ArrowRight' })).toBe(true)
  await expect(tb(page, 'italic')).toBeFocused()

  await page.getByTestId('tb-tab-home').focus()
  expect(await prevented({ key: 'ArrowLeft', altKey: true })).toBe(false)
  expect(await prevented({ key: 'ArrowRight', ctrlKey: true })).toBe(false)
  await expect(page.getByTestId('tb-tab-home')).toBeFocused()
  await expect(page.getByTestId('tb-tab-home')).toHaveAttribute('aria-selected', 'true')
  expect(await prevented({ key: 'ArrowRight' })).toBe(true)
  await expect(page.getByTestId('tb-tab-insert')).toBeFocused()
})

test('colour and highlight made in one browser appear in the other', async ({ browser }) => {
  const label = `${LABEL}-colour-sync`
  const { owner, workspace } = await seedWorkspace(label)
  const editor = await addMember(workspace.id, label, 'editor')
  const document = await createDocument(workspace.id, 'doc')

  async function openAs(userId: string) {
    const context = await browser.newContext()
    await context.addCookies([await sessionCookieFor(userId)])
    const page = await context.newPage()
    // ?nobc=1: sync through the server, so B sees what went through the CRDT and the wire.
    await page.goto(`/documents/${document.id}?nobc=1`)
    await expect(page.getByTestId('status')).toHaveAttribute('data-status', 'connected')
    await expect(prose(page)).toHaveAttribute('contenteditable', 'true')
    return { page, close: () => context.close() }
  }

  const a = await openAs(owner.id)
  const b = await openAs(editor.id)

  await typeAndSelect(a.page, 'shared paint')
  await openMenu(a.page, 'color')
  await tb(a.page, 'color-red').click()
  await openMenu(a.page, 'highlight')
  await tb(a.page, 'highlight-yellow').click()
  await openMenu(a.page, 'style')
  await tb(a.page, 'style-heading').click()

  const text = prose(b.page)
  await expect(text.locator('h2')).toHaveText('shared paint')
  await expect(text.locator('span[style^="color"]')).toHaveCSS('color', await resolved(b.page, '#c4372b'))
  await expect(text.locator('mark')).toHaveCSS('background-color', await resolved(b.page, '#fde68a'))

  // B's own menus read what arrived: with the caret in A's red, Red is the marked swatch.
  await text.locator('h2').click()
  await expect(tb(b.page, 'style-current')).toHaveText('Heading')
  await openMenu(b.page, 'color')
  await expect(tb(b.page, 'color-red')).toHaveAttribute('aria-selected', 'true')

  await a.close()
  await b.close()
})

test('a menu blurs the page behind it: no ancestor of its panel is a backdrop root', async ({
  page,
}) => {
  await openDocument(page, `${LABEL}-backdrop`)
  await prose(page).click()

  for (const id of ['style', 'color', 'highlight'] as const) {
    await openMenu(page, id)
    const found = await tb(page, `${id}-menu`).evaluate((menu) => {
      const filter = (el: Element, pseudo?: string) => {
        const style = getComputedStyle(el, pseudo)
        return style.backdropFilter !== 'none' ? style.backdropFilter : 'none'
      }
      const ancestors: string[] = []
      for (let el = menu.parentElement; el; el = el.parentElement) {
        if (filter(el) !== 'none') ancestors.push(el.className || el.tagName)
      }
      const panel = menu.closest('[data-testid="tb-root"]')!.firstElementChild!
      return { own: filter(menu), ancestors, panelGlass: filter(panel, '::before') }
    })
    // A backdrop-filter on an ancestor makes it the root the menu's blur samples from, and
    // the menu hangs below that ancestor's edge, over the document: it would blur nothing.
    expect(found.ancestors, `${id} menu`).toEqual([])
    expect(found.own, `${id} menu`).not.toBe('none')
    // The toolbar's own glass is still there, on its own layer.
    expect(found.panelGlass).not.toBe('none')
    await page.keyboard.press('Escape')
  }
})

// ---------------------------------------------------------------------------
// Insert tab (handoff 12.3 and 12.6)
// ---------------------------------------------------------------------------

async function openInsert(page: Page) {
  await page.getByTestId('tb-tab-insert').click()
  await expect(page.getByTestId('tb-row-insert')).toBeVisible()
}

/** Opens the Link popover with the mouse, the way a person does: focus moves to its field. */
async function openLink(page: Page) {
  await tb(page, 'insert-link').click()
  await expect(tb(page, 'insert-link-menu')).toBeVisible()
  await expect(tb(page, 'insert-link-input')).toBeFocused()
}

/** What the editor believes is selected, whether or not it has focus. */
const pmSelection = (page: Page) =>
  prose(page).evaluate((el) => {
    const editor = (el as unknown as { editor: import('@tiptap/core').Editor }).editor
    const { from, to } = editor.state.selection
    return { from, to, text: editor.state.doc.textBetween(from, to, ' ') }
  })

/** Moves the editor's selection without giving it focus: a change made behind the popover. */
const disturbSelection = (page: Page, position: number) =>
  prose(page).evaluate((el, pos) => {
    const editor = (el as unknown as { editor: import('@tiptap/core').Editor }).editor
    editor.commands.setTextSelection(pos)
  }, position)

test('the Insert tab has its six tools, each a labelled button', async ({ page }) => {
  await openDocument(page, `${LABEL}-insert-tools`)
  await openInsert(page)

  const row = page.getByTestId('tb-row-insert')
  await expect(row.locator('button')).toHaveText(['Link', 'Table', 'Divider', 'Code block', 'Quote', 'Date'])
  for (const id of ['link', 'table', 'divider', 'code', 'quote', 'date']) {
    await expect(tb(page, `insert-${id}`)).toBeVisible()
  }
  // The labelled variant: padding 0 11 0 9, with the icon beside the text.
  const link = tb(page, 'insert-link')
  await expect(link).toHaveCSS('padding-left', '9px')
  await expect(link).toHaveCSS('padding-right', '11px')
  await expect(link.locator('svg')).toBeVisible()
})

test('Link opens its popover with the field focused, and Enter links the selection', async ({
  page,
}) => {
  await openDocument(page, `${LABEL}-link-apply`)
  await typeAndSelect(page, 'link me')
  await openInsert(page)

  await openLink(page)
  await expect(tb(page, 'insert-link-input')).toHaveAttribute('placeholder', 'Paste a link')
  await expect(tb(page, 'insert-link')).toHaveAttribute('aria-expanded', 'true')
  // 330px wide, padding 6, 34px controls.
  const box = (await tb(page, 'insert-link-menu').boundingBox())!
  expect(box.width).toBeCloseTo(330, 0)
  expect((await tb(page, 'insert-link-input').boundingBox())!.height).toBeCloseTo(34, 0)

  await page.keyboard.type('https://example.com/docs')
  await page.keyboard.press('Enter')

  await expect(prose(page).locator('a')).toHaveAttribute('href', 'https://example.com/docs')
  await expect(prose(page).locator('a')).toHaveText('link me')
  await expect(tb(page, 'insert-link-menu')).toHaveCount(0)
  // Focus and the selection are the editor's again (Tiptap hands focus back on the next
  // frame, so this is polled).
  await expect.poll(() => editorState(page)).toEqual({ selected: 'link me', inEditor: true })
  await expect(tb(page, 'insert-link')).toHaveAttribute('aria-pressed', 'true')
})

test('Add links the selection too, and an address with no scheme gets https://', async ({ page }) => {
  await openDocument(page, `${LABEL}-link-scheme`)
  await typeAndSelect(page, 'bare address')
  await openInsert(page)
  await openLink(page)
  await page.keyboard.type('example.com/path')
  await tb(page, 'insert-link-apply').click()
  await expect(prose(page).locator('a')).toHaveAttribute('href', 'https://example.com/path')
  await expect(prose(page).locator('a')).toHaveText('bare address')

  // A scheme that is already there is left alone.
  await page.keyboard.press('ControlOrMeta+a')
  await openLink(page)
  await page.keyboard.type('http://plain.example')
  await page.keyboard.press('Enter')
  await expect(prose(page).locator('a')).toHaveAttribute('href', 'http://plain.example')
})

test('the selection is restored before the link is applied, not read from the page', async ({
  page,
}) => {
  await openDocument(page, `${LABEL}-link-restore`)
  await typeAndSelect(page, 'link me')
  await openInsert(page)
  await openLink(page)

  // Focus is in the field, so the editor has lost the page selection. Something moves the
  // editor's selection to a bare caret while the popover is open. A link applied to the
  // selection as it is then would land on a collapsed cursor, and nothing would happen.
  await disturbSelection(page, 2)
  expect((await pmSelection(page)).text).toBe('')

  await page.keyboard.type('example.com')
  await page.keyboard.press('Enter')
  // The words that were selected when the popover opened, whole.
  await expect(prose(page).locator('a')).toHaveText('link me')
  await expect(prose(page).locator('a')).toHaveAttribute('href', 'https://example.com')
})

test('the selection is mapped through a peer’s edit made while the popover is open', async ({
  browser,
}) => {
  const label = `${LABEL}-link-peer`
  const { owner, workspace } = await seedWorkspace(label)
  const peer = await addMember(workspace.id, label, 'editor')
  const document = await createDocument(workspace.id, 'doc')

  async function openAs(userId: string) {
    const context = await browser.newContext()
    await context.addCookies([await sessionCookieFor(userId)])
    const page = await context.newPage()
    await page.goto(`/documents/${document.id}?nobc=1`)
    await expect(page.getByTestId('status')).toHaveAttribute('data-status', 'connected')
    await expect(prose(page)).toHaveAttribute('contenteditable', 'true')
    return { page, close: () => context.close() }
  }

  const a = await openAs(owner.id)
  const b = await openAs(peer.id)

  // The words are selected with the keyboard from the middle of the line, so the peer's
  // text lands before the selection, not at its edge or inside it.
  await prose(a.page).click()
  await a.page.keyboard.type('intro target words')
  for (let i = 0; i < 'target words'.length; i += 1) await a.page.keyboard.press('Shift+ArrowLeft')
  // The editor reads the page's selection on the browser's selectionchange, so it is polled.
  await expect.poll(async () => (await pmSelection(a.page)).text).toBe('target words')
  // (B's view draws A's caret label inside the text, hence the pattern.)
  await expect(prose(b.page)).toContainText(/intro .*target words/)
  await openInsert(a.page)
  await openLink(a.page)

  // B writes in front of A's selection while A's popover is open.
  await prose(b.page).click()
  // Start of the line: Cmd+Left on macOS, Home elsewhere.
  await b.page.keyboard.press(process.platform === 'darwin' ? 'Meta+ArrowLeft' : 'Home')
  await b.page.keyboard.type('PREFIX ')
  // (A's view draws B's caret label between them, so the two are asserted apart.)
  await expect(prose(a.page)).toContainText(/^PREFIX /)

  await a.page.keyboard.type('example.com')
  await a.page.keyboard.press('Enter')
  // Still the words A selected, not the span that now sits at the old offsets.
  await expect(prose(a.page).locator('a')).toHaveText('target words')
  await expect(prose(b.page).locator('a')).toHaveText('target words')

  await a.close()
  await b.close()
})

test('Esc closes the popover and gives the editor its selection back', async ({ page }) => {
  await openDocument(page, `${LABEL}-link-esc`)
  await typeAndSelect(page, 'keep this selected')
  await openInsert(page)
  await openLink(page)
  await page.keyboard.type('half typed')

  await page.keyboard.press('Escape')
  await expect(tb(page, 'insert-link-menu')).toHaveCount(0)
  // Nothing was applied, and the selection and focus are the editor's. Tiptap gives focus
  // back on the next frame, so this is polled rather than read once.
  await expect(prose(page).locator('a')).toHaveCount(0)
  await expect
    .poll(() => editorState(page))
    .toEqual({ selected: 'keep this selected', inEditor: true })

  // Even if the selection moved while the popover was open.
  await openLink(page)
  await disturbSelection(page, 1)
  await page.keyboard.press('Escape')
  await expect.poll(() => pmSelection(page)).toMatchObject({ text: 'keep this selected' })
  await expect
    .poll(() => editorState(page))
    .toEqual({ selected: 'keep this selected', inEditor: true })
})

test('Remove strips the link, whole, and the field shows the link being edited', async ({
  page,
}) => {
  await openDocument(page, `${LABEL}-link-remove`)
  await typeAndSelect(page, 'remove me')
  await openInsert(page)
  await openLink(page)
  await page.keyboard.type('example.com')
  await page.keyboard.press('Enter')
  await expect(prose(page).locator('a')).toHaveCount(1)

  // A caret in the middle of the link, not a selection of it.
  await page.keyboard.press('End')
  await page.keyboard.press('ArrowLeft')
  await page.keyboard.press('ArrowLeft')
  await openLink(page)
  await expect(tb(page, 'insert-link-input')).toHaveValue('https://example.com')
  await tb(page, 'insert-link-remove').click()

  await expect(tb(page, 'insert-link-menu')).toHaveCount(0)
  await expect(prose(page).locator('a')).toHaveCount(0)
  await expect(prose(page)).toContainText('remove me')
})

test('Remove has nothing to do outside a link, and says so', async ({ page }) => {
  await openDocument(page, `${LABEL}-link-remove-none`)
  await typeAndSelect(page, 'plain text')
  await openInsert(page)
  await openLink(page)

  await expect(tb(page, 'insert-link-remove')).toHaveAttribute('aria-disabled', 'true')
  // aria-disabled, not disabled: still a control in the popover's Tab order.
  await expect(tb(page, 'insert-link-remove')).not.toHaveAttribute('disabled', /.*/)
  // force: Playwright treats aria-disabled as not actionable, and a person can click it.
  await tb(page, 'insert-link-remove').click({ force: true })
  await expect(tb(page, 'insert-link-menu')).toBeVisible()
  await expect(prose(page)).toHaveText('plain text')
})

test('an address the link validation refuses keeps the popover open and flags the field', async ({
  page,
}) => {
  await openDocument(page, `${LABEL}-link-refused`)
  await typeAndSelect(page, 'not linked')
  await openInsert(page)
  await openLink(page)
  await page.keyboard.type('foo://bar')
  await page.keyboard.press('Enter')

  await expect(tb(page, 'insert-link-input')).toHaveAttribute('aria-invalid', 'true')
  await expect(tb(page, 'insert-link-menu')).toBeVisible()
  await expect(tb(page, 'insert-link-input')).toBeFocused()
  await expect(prose(page).locator('a')).toHaveCount(0)

  // Correcting it clears the flag, and the same selection is still the one linked.
  await tb(page, 'insert-link-input').fill('example.com')
  await expect(tb(page, 'insert-link-input')).not.toHaveAttribute('aria-invalid', 'true')
  await page.keyboard.press('Enter')
  await expect(prose(page).locator('a')).toHaveText('not linked')
})

test('pressing Link again closes the popover, and the editor has its selection', async ({
  page,
}) => {
  await openDocument(page, `${LABEL}-link-toggle`)
  await typeAndSelect(page, 'toggle me')
  await openInsert(page)
  await openLink(page)
  await disturbSelection(page, 1)

  await tb(page, 'insert-link').click()
  await expect(tb(page, 'insert-link-menu')).toHaveCount(0)
  await expect
    .poll(() => editorState(page))
    .toEqual({ selected: 'toggle me', inEditor: true })
})

test('clicking a link places the caret in it instead of opening it', async ({ page }) => {
  await openDocument(page, `${LABEL}-link-click`)
  await typeAndSelect(page, 'click me')
  await openInsert(page)
  await openLink(page)
  await page.keyboard.type('example.com')
  await page.keyboard.press('Enter')
  await expect(prose(page).locator('a')).toHaveCount(1)

  // By default a click on a link in an editable document opens it in a new tab, which would
  // make an existing link impossible to reach with the mouse, and so to edit or remove.
  const opened: string[] = []
  page.context().on('page', (popup) => opened.push(popup.url()))
  await prose(page).locator('a').click()
  await page.waitForTimeout(500)
  expect(opened).toEqual([])
  await expect(tb(page, 'insert-link')).toHaveAttribute('aria-pressed', 'true')
})

test('a caret on no text takes the address as the link’s text', async ({ page }) => {
  await openDocument(page, `${LABEL}-link-caret`)
  await prose(page).click()
  await openInsert(page)
  await openLink(page)
  await page.keyboard.type('example.com')
  await page.keyboard.press('Enter')
  await expect(prose(page).locator('a')).toHaveText('https://example.com')
  await expect(prose(page).locator('a')).toHaveAttribute('href', 'https://example.com')
})

test('the Link popover works from the keyboard and closes on Tab out', async ({ page }) => {
  await openDocument(page, `${LABEL}-link-keys`)
  await typeAndSelect(page, 'by keyboard')
  await openInsert(page)

  await tb(page, 'insert-link').focus()
  await page.keyboard.press('Enter')
  await expect(tb(page, 'insert-link-input')).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(tb(page, 'insert-link-apply')).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(tb(page, 'insert-link-remove')).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(tb(page, 'insert-link-menu')).toHaveCount(0)

  // The field's own keys stay the field's: Home and the arrows do not leave it.
  await tb(page, 'insert-link').focus()
  await page.keyboard.press('Enter')
  await page.keyboard.type('abc')
  await page.keyboard.press('Home')
  await page.keyboard.press('ArrowRight')
  await expect(tb(page, 'insert-link-input')).toBeFocused()
})

test('the Link popover’s controls are not stops of the tool row', async ({ page }) => {
  await openDocument(page, `${LABEL}-link-roving`)
  await prose(page).click()
  await openInsert(page)
  const stops = page.locator('[data-testid="tb-row-insert"] [data-roving]')
  await expect(stops).toHaveCount(6)

  await openLink(page)
  await expect(stops).toHaveCount(6)
  await expect(page.locator('[data-testid="tb-row-insert"] [data-roving][tabindex="0"]')).toHaveCount(1)
  await expect(tb(page, 'insert-link-menu').locator('[data-roving]')).toHaveCount(0)

  // Arrows in the field are the field's: the row does not take them.
  await page.keyboard.type('x')
  await page.keyboard.press('ArrowLeft')
  await expect(tb(page, 'insert-link-input')).toBeFocused()
})

test('the Link popover blurs the page behind it: no ancestor is a backdrop root', async ({
  page,
}) => {
  await openDocument(page, `${LABEL}-link-backdrop`)
  await prose(page).click()
  await openInsert(page)
  await openLink(page)
  const found = await tb(page, 'insert-link-menu').evaluate((menu) => {
    const filter = (el: Element) => getComputedStyle(el).backdropFilter
    const ancestors: string[] = []
    for (let el = menu.parentElement; el; el = el.parentElement) {
      if (filter(el) !== 'none') ancestors.push(el.className || el.tagName)
    }
    return { own: filter(menu), ancestors }
  })
  expect(found.ancestors).toEqual([])
  expect(found.own).not.toBe('none')
})

test('Divider, Code block and Quote insert or toggle', async ({ page }) => {
  await openDocument(page, `${LABEL}-blocks`)
  await prose(page).click()
  await page.keyboard.type('first line')
  await openInsert(page)

  // Divider: a horizontal rule.
  await tb(page, 'insert-divider').click()
  await expect(prose(page).locator('hr')).toHaveCount(1)

  // Code block: toggles, and the button follows the caret.
  await page.keyboard.type('const x = 1')
  await tb(page, 'insert-code').click()
  await expect(prose(page).locator('pre code')).toHaveText('const x = 1')
  await expect(tb(page, 'insert-code')).toHaveAttribute('aria-pressed', 'true')
  await tb(page, 'insert-code').click()
  await expect(prose(page).locator('pre')).toHaveCount(0)
  await expect(tb(page, 'insert-code')).toHaveAttribute('aria-pressed', 'false')
  await expect(prose(page)).toContainText('const x = 1')

  // Quote: toggles the same way.
  await tb(page, 'insert-quote').click()
  await expect(prose(page).locator('blockquote')).toContainText('const x = 1')
  await expect(tb(page, 'insert-quote')).toHaveAttribute('aria-pressed', 'true')
  await tb(page, 'insert-quote').click()
  await expect(prose(page).locator('blockquote')).toHaveCount(0)
  await expect(tb(page, 'insert-quote')).toHaveAttribute('aria-pressed', 'false')
  // The editor never lost focus across any of it.
  expect((await editorState(page)).inEditor).toBe(true)
})

test('Date inserts today’s date as text, in the design’s format', async ({ page }) => {
  // The clock is fixed before the page loads, so the expectation does not restate the code.
  await page.clock.setFixedTime(new Date(2026, 9, 3, 12, 0, 0))
  await openDocument(page, `${LABEL}-date`)
  await prose(page).click()
  await page.keyboard.type('Due ')
  await openInsert(page)
  await tb(page, 'insert-date').click()
  await expect(prose(page).locator('p')).toHaveText('Due Oct 3, 2026')
  // Text, not a node or a mark: nothing wraps it.
  await expect(prose(page).locator('p > *')).toHaveCount(0)
})

test('Table inserts a 3x3 with an empty paragraph after it, caret in the first cell', async ({
  page,
}) => {
  await openDocument(page, `${LABEL}-table`)
  await prose(page).click()
  await openInsert(page)
  await tb(page, 'insert-table').click()

  const table = prose(page).locator('table')
  await expect(table).toHaveCount(1)
  await expect(table.locator('tr')).toHaveCount(3)
  await expect(table.locator('tr').first().locator('td')).toHaveCount(3)
  await expect(table.locator('td')).toHaveCount(9)
  await expect(table.locator('th')).toHaveCount(0)
  // An empty paragraph follows it: the document's last node is not the table.
  const after = await prose(page).evaluate((el) => {
    const last = el.lastElementChild
    const previous = last?.previousElementSibling
    // Tiptap wraps a table in a div, so the table is that div's child.
    return {
      tag: last?.tagName,
      text: last?.textContent,
      previousHoldsTable: previous?.querySelector(':scope > table') !== null,
    }
  })
  expect(after).toEqual({ tag: 'P', text: '', previousHoldsTable: true })

  // The caret is in the first cell, so typing fills it.
  await page.keyboard.type('A1')
  await expect(table.locator('td').first()).toHaveText('A1')
  // Undo takes the table and its paragraph away together.
  await page.keyboard.press('ControlOrMeta+z')
  await page.keyboard.press('ControlOrMeta+z')
  await expect(prose(page).locator('table')).toHaveCount(0)
})

test('a table made in one browser, and what is typed in it, appears in the other', async ({
  browser,
}) => {
  const label = `${LABEL}-table-sync`
  const { owner, workspace } = await seedWorkspace(label)
  const peer = await addMember(workspace.id, label, 'editor')
  const document = await createDocument(workspace.id, 'doc')

  async function openAs(userId: string) {
    const context = await browser.newContext()
    await context.addCookies([await sessionCookieFor(userId)])
    const page = await context.newPage()
    // ?nobc=1: through the server and the wire, not a BroadcastChannel shortcut.
    await page.goto(`/documents/${document.id}?nobc=1`)
    await expect(page.getByTestId('status')).toHaveAttribute('data-status', 'connected')
    await expect(prose(page)).toHaveAttribute('contenteditable', 'true')
    return { page, close: () => context.close() }
  }

  const a = await openAs(owner.id)
  const b = await openAs(peer.id)

  await prose(a.page).click()
  await openInsert(a.page)
  await tb(a.page, 'insert-table').click()
  await a.page.keyboard.type('from A')

  const remote = prose(b.page).locator('table')
  await expect(remote).toHaveCount(1)
  await expect(remote.locator('tr')).toHaveCount(3)
  await expect(remote.locator('td')).toHaveCount(9)
  // toContainText: B's view draws A's caret label (the user's name) inside the cell.
  await expect(remote.locator('td').first()).toContainText('from A')
  await expect(prose(b.page).locator('div:has(> table) + p')).toHaveCount(1)

  // And B's edit inside a cell travels back.
  await remote.locator('td').nth(4).click()
  await b.page.keyboard.type('from B')
  await expect(prose(a.page).locator('table td').nth(4)).toContainText('from B')

  // The node survives a reload from the server, not just the live stream.
  await a.page.waitForTimeout(500)
  await a.page.reload()
  await expect(prose(a.page).locator('table td')).toHaveCount(9)
  await expect(prose(a.page).locator('table td').nth(4)).toContainText('from B')

  await a.close()
  await b.close()
})

test('a viewer gets no Insert tab, so none of the Insert tools', async ({ page }) => {
  const label = `${LABEL}-viewer-insert`
  const { workspace } = await seedWorkspace(label)
  const viewer = await addMember(workspace.id, label, 'viewer')
  const document = await createDocument(workspace.id, 'doc')
  await signIn(page, viewer.id)
  await page.goto(`/documents/${document.id}`)
  await expect(page.getByTestId('tb-tab-view')).toBeVisible()
  await expect(page.getByTestId('tb-tab-insert')).toHaveCount(0)
  await expect(page.locator('[data-testid^="tb-insert-"]')).toHaveCount(0)
})
