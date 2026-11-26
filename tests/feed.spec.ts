/**
 * Milestone 2 — generation and the public feed.
 *
 * Local runs use the mock provider only (src/ai/image-router.ts), so these
 * specs spend no credits.
 */
import { test, expect, loadAllTestAccounts } from 'deepspace/testing'
import { test as anonTest } from '@playwright/test'

const usable = loadAllTestAccounts().length
test.skip(usable < 2, `Needs 2 usable test accounts, found ${usable}.`)

test('typed mood becomes a live image for the author and for another viewer', async ({ users, browser }) => {
  const [a, b] = await users(2)
  const mood = `quiet rain on a tin roof ${Date.now()}`

  await Promise.all([a.page.goto('/'), b.page.goto('/')])
  await expect(a.page.getByTestId('composer')).toBeVisible({ timeout: 15_000 })

  // Typed fallback (speech recognition is not driven in tests).
  const toggle = a.page.getByTestId('composer-type-toggle')
  if (await toggle.isVisible()) await toggle.click()
  await a.page.getByTestId('composer-input').fill(mood)
  await a.page.getByTestId('composer-send').click()

  for (const page of [a.page, b.page]) {
    const card = page.getByTestId('image-card').filter({ hasText: mood })
    await expect(card).toBeVisible({ timeout: 30_000 })
    const img = card.locator('img')
    await expect(img).toHaveAttribute('src', /\/api\/files\//)
    // The stored file actually serves.
    await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth), {
      timeout: 15_000,
    }).toBeGreaterThan(0)
  }

  // B (signed in) sees a real author name, not the mask.
  const bCard = b.page.getByTestId('image-card').filter({ hasText: mood })
  await expect(bCard.getByTestId('masked-author')).toHaveCount(0)

  // A signed-out visitor sees the image with a masked author.
  const anon = await browser.newContext()
  const anonPage = await anon.newPage()
  await anonPage.goto('/')
  const anonCard = anonPage.getByTestId('image-card').filter({ hasText: mood })
  await expect(anonCard).toBeVisible({ timeout: 15_000 })
  await expect(anonCard.getByTestId('masked-author')).toBeVisible()
  await expect(anonCard.getByTestId('image-author')).toHaveText('Someone in the room')
  await anon.close()
})

anonTest('generateMood refuses a signed-out caller', async ({ request }) => {
  const res = await request.post('/api/actions/generateMood', { data: { transcript: 'hello', inputMode: 'typed' } })
  expect(res.status()).toBe(401)
})
