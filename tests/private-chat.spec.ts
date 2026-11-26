/**
 * Milestone 4 — private chat and the account page.
 * Three users: A posts a mood, B opens a chat from it, C must see nothing.
 */
import type { Page } from '@playwright/test'
import { test, expect, loadAllTestAccounts } from 'deepspace/testing'

const usable = loadAllTestAccounts().length
test.skip(usable < 3, `Needs 3 usable test accounts, found ${usable}.`)

async function postMood(page: Page, mood: string) {
  await page.goto('/')
  await expect(page.getByTestId('composer')).toBeVisible({ timeout: 15_000 })
  const toggle = page.getByTestId('composer-type-toggle')
  if (await toggle.isVisible()) await toggle.click()
  await page.getByTestId('composer-input').fill(mood)
  await page.getByTestId('composer-send').click()
  await expect(page.getByTestId('image-card').filter({ hasText: mood })).toBeVisible({ timeout: 30_000 })
}

async function imageLoaded(page: Page, selector: ReturnType<Page['locator']>) {
  await expect
    .poll(() => selector.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth), { timeout: 20_000 })
    .toBeGreaterThan(0)
}

test('chat from an image: private to the pair, unread badges, private painting', async ({ users }) => {
  test.setTimeout(120_000)
  const [a, b, c] = await users(3)
  const mood = `lavender dusk ${Date.now()}`
  await postMood(a.page, mood)

  // B opens a chat from A's image.
  await b.page.goto('/')
  const card = b.page.getByTestId('image-card').filter({ hasText: mood })
  await expect(card).toBeVisible({ timeout: 15_000 })
  await card.hover()
  await card.getByTestId('image-chat').click()
  await expect(b.page).toHaveURL(/\/chat\/dm_/, { timeout: 15_000 })
  const chatUrl = b.page.url()
  // The pair's room is reused across runs, so match this run's context card.
  await expect(
    b.page.locator('[data-testid="chat-message"][data-type="system"]').filter({ hasText: mood }),
  ).toBeVisible({ timeout: 15_000 })

  // B sends text; A gets an unread badge, opens the chat from the account page.
  const hello = `hey, love this ${Date.now()}`
  await b.page.getByTestId('chat-input').fill(hello)
  await b.page.getByTestId('chat-send').click()
  await expect(b.page.getByTestId('chat-message').filter({ hasText: hello })).toBeVisible({ timeout: 15_000 })

  await a.page.goto('/account?tab=chats')
  await expect(a.page.getByTestId('nav-unread')).toBeVisible({ timeout: 15_000 })
  const row = a.page.getByTestId('chat-row').first()
  await expect(row).toContainText(hello)
  await expect(row.getByTestId('chat-unread')).toBeVisible()
  await row.click()
  await expect(a.page.getByTestId('chat-message').filter({ hasText: hello })).toBeVisible({ timeout: 15_000 })
  await expect(a.page.getByTestId('nav-unread')).toHaveCount(0, { timeout: 15_000 })

  // A replies; B sees it live.
  const reply = `thanks! ${Date.now()}`
  await a.page.getByTestId('chat-input').fill(reply)
  await a.page.getByTestId('chat-send').click()
  await expect(b.page.getByTestId('chat-message').filter({ hasText: reply })).toBeVisible({ timeout: 15_000 })

  // B paints a private mood in the chat; both see it, and it is NOT in the public room.
  const secret = `secret tide ${Date.now()}`
  await b.page.getByTestId('chat-paint').click()
  const toggle = b.page.getByTestId('composer-type-toggle')
  if (await toggle.isVisible()) await toggle.click()
  await b.page.getByTestId('composer-input').fill(secret)
  await b.page.getByTestId('composer-send').click()
  const bImg = b.page.locator('[data-testid="chat-message"][data-type="image"]').filter({ hasText: secret }).locator('img')
  await expect(bImg).toBeVisible({ timeout: 30_000 })
  await imageLoaded(b.page, bImg)
  const aImg = a.page.locator('[data-testid="chat-message"][data-type="image"]').filter({ hasText: secret }).locator('img')
  await expect(aImg).toBeVisible({ timeout: 15_000 })
  await imageLoaded(a.page, aImg) // the peer can load the sender's private file via the gated route
  const mediaPath = new URL((await aImg.getAttribute('src'))!, chatUrl).pathname

  await c.page.goto('/')
  await expect(c.page.getByTestId('public-feed')).toBeVisible({ timeout: 15_000 })
  await expect(c.page.getByTestId('image-card').filter({ hasText: secret })).toHaveCount(0)

  // C, an outsider: no room, no messages, no media.
  await c.page.goto(chatUrl)
  await expect(c.page.getByTestId('chat-not-found')).toBeVisible({ timeout: 15_000 })
  await expect(c.page.getByTestId('chat-message')).toHaveCount(0)
  await c.page.goto('/account?tab=chats')
  await expect(c.page.getByTestId('account-page')).toBeVisible({ timeout: 15_000 })
  await expect(c.page.getByTestId('chat-row').filter({ hasText: hello })).toHaveCount(0)
  const status = await c.page.evaluate(async (p) => (await fetch(p)).status, mediaPath)
  expect(status).toBe(404)
  // Signed-out: 401.
  const anon = await c.page.context().browser()!.newContext()
  const anonRes = await anon.request.get(new URL(mediaPath, chatUrl).toString())
  expect(anonRes.status()).toBe(401)
  await anon.close()
})

test('account generations: date rail, grid, and zoomable lightbox', async ({ users }) => {
  const [a] = await users(1)
  const mood = `amber morning ${Date.now()}`
  await postMood(a.page, mood)

  await a.page.goto('/account')
  await expect(a.page.getByTestId('generation-feed')).toBeVisible({ timeout: 15_000 })
  const today = await a.page.evaluate(() => {
    const d = new Date()
    const p = (n: number) => String(n).padStart(2, '0')
    return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`
  })
  await expect(a.page.getByTestId('date-rail-item').first()).toHaveText(today)

  const tile = a.page.getByTestId('generation-tile').filter({ hasText: mood })
  await expect(tile).toBeVisible()
  await tile.click()
  await expect(a.page.getByTestId('lightbox')).toBeVisible()
  await expect(a.page.getByTestId('lightbox-zoom')).toHaveText('100%')
  await a.page.getByTestId('lightbox-zoom-in').click()
  await expect(a.page.getByTestId('lightbox-zoom')).toHaveText('150%')
  await a.page.getByTestId('lightbox-zoom-out').click()
  await expect(a.page.getByTestId('lightbox-zoom')).toHaveText('100%')
  await a.page.keyboard.press('Escape')
  await expect(a.page.getByTestId('lightbox')).toHaveCount(0)
})
