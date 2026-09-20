import { test, expect, type BrowserContext, type Page } from '@playwright/test'
import { addMember, cleanup, createDocument, seedWorkspace, sessionCookieFor } from './fixtures.js'

const LABEL = 'e2e-collab'

test.afterAll(async () => {
  await cleanup(LABEL)
})

async function openAs(
  context: BrowserContext,
  userId: string,
  documentId: string,
): Promise<Page> {
  await context.addCookies([await sessionCookieFor(userId)])
  const page = await context.newPage()
  // ?nobc=1 forces this tab to sync through the server rather than BroadcastChannel.
  await page.goto(`/documents/${documentId}?nobc=1`)
  await expect(page.getByTestId('status')).toHaveText('connected')
  return page
}

test('a card added in one browser appears in the other', async ({ browser }) => {
  const { owner, workspace } = await seedWorkspace(LABEL)
  const editor = await addMember(workspace.id, LABEL, 'editor')
  const document = await createDocument(workspace.id, 'board')

  const contextA = await browser.newContext()
  const contextB = await browser.newContext()
  const pageA = await openAs(contextA, owner.id, document.id)
  const pageB = await openAs(contextB, editor.id, document.id)

  await pageA.getByTestId('add-column').click()
  await expect(pageB.locator('[data-testid^="column-"]')).toHaveCount(1)

  const columnId = await pageB
    .locator('[data-testid^="column-"]')
    .first()
    .getAttribute('data-testid')
  await pageA.getByTestId(`add-card-${columnId!.replace('column-', '')}`).click()

  await expect(pageB.locator('[data-testid^="card-"]')).toHaveCount(1)
  await expect(pageB.locator('[data-testid^="card-"]').first()).toContainText('New card')

  await contextA.close()
  await contextB.close()
})

test('a viewer sees edits but cannot make them', async ({ browser }) => {
  const label = `${LABEL}-viewer`
  const { owner, workspace } = await seedWorkspace(label)
  const viewer = await addMember(workspace.id, label, 'viewer')
  const document = await createDocument(workspace.id, 'board')

  const contextA = await browser.newContext()
  const contextB = await browser.newContext()
  const editorPage = await openAs(contextA, owner.id, document.id)
  const viewerPage = await openAs(contextB, viewer.id, document.id)

  await expect(viewerPage.getByTestId('read-only')).toBeVisible()
  await expect(viewerPage.getByTestId('add-column')).toHaveCount(0)

  await editorPage.getByTestId('add-column').click()
  await expect(viewerPage.locator('[data-testid^="column-"]')).toHaveCount(1)

  await contextA.close()
  await contextB.close()
  await cleanup(label)
})

test('both users see each other in the presence bar', async ({ browser }) => {
  const label = `${LABEL}-presence`
  const { owner, workspace } = await seedWorkspace(label)
  const editor = await addMember(workspace.id, label, 'editor')
  const document = await createDocument(workspace.id, 'board')

  const contextA = await browser.newContext()
  const contextB = await browser.newContext()
  const pageA = await openAs(contextA, owner.id, document.id)
  await openAs(contextB, editor.id, document.id)

  await expect(pageA.getByTestId('presence-Eddie')).toBeVisible()

  await contextA.close()
  await contextB.close()
  await cleanup(label)
})

test('text typed while offline merges on reconnect', async ({ browser }) => {
  // y-websocket only notices a stalled connection via its own dead-peer check, which
  // fires on a 30s timer (messageReconnectTimeout in y-websocket's source) — Playwright's
  // setOffline does not proactively close the socket or emit a close event. The default
  // 30s test / 10s expect timeouts are too short to observe that transition, so both are
  // extended here rather than for the whole suite.
  test.setTimeout(60_000)
  const label = `${LABEL}-offline`
  const { owner, workspace } = await seedWorkspace(label)
  const editor = await addMember(workspace.id, label, 'editor')
  const document = await createDocument(workspace.id, 'doc')

  const contextA = await browser.newContext()
  const contextB = await browser.newContext()
  const pageA = await openAs(contextA, owner.id, document.id)
  const pageB = await openAs(contextB, editor.id, document.id)

  await pageA.locator('.ProseMirror').click()
  await pageA.keyboard.type('online-a ')
  await expect(pageB.locator('.ProseMirror')).toContainText('online-a')

  await contextB.setOffline(true)
  await expect(pageB.getByTestId('status')).toHaveText('disconnected', { timeout: 40_000 })
  await pageB.locator('.ProseMirror').click()
  await pageB.keyboard.type('offline-b ')
  await pageA.locator('.ProseMirror').click()
  await pageA.keyboard.type('while-b-was-away ')

  await contextB.setOffline(false)

  await expect(pageA.locator('.ProseMirror')).toContainText('offline-b')
  await expect(pageB.locator('.ProseMirror')).toContainText('while-b-was-away')

  await contextA.close()
  await contextB.close()
  await cleanup(label)
})
