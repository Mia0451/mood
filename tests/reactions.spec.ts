/**
 * Milestone 3 — reactions. Two users: A posts, B reacts, both see live counts.
 */
import type { Page } from '@playwright/test'
import { test, expect, loadAllTestAccounts } from 'deepspace/testing'

const usable = loadAllTestAccounts().length
test.skip(usable < 2, `Needs 2 usable test accounts, found ${usable}.`)

async function postMood(page: Page, mood: string) {
  await expect(page.getByTestId('composer')).toBeVisible({ timeout: 15_000 })
  const toggle = page.getByTestId('composer-type-toggle')
  if (await toggle.isVisible()) await toggle.click()
  await page.getByTestId('composer-input').fill(mood)
  await page.getByTestId('composer-send').click()
}

test('others can like/dislike live; authors get no menu on their own image', async ({ users }) => {
  const [a, b] = await users(2)
  const mood = `golden hour calm ${Date.now()}`
  await Promise.all([a.page.goto('/'), b.page.goto('/')])
  await postMood(a.page, mood)

  const aCard = a.page.getByTestId('image-card').filter({ hasText: mood })
  const bCard = b.page.getByTestId('image-card').filter({ hasText: mood })
  await expect(aCard).toBeVisible({ timeout: 30_000 })
  await expect(bCard).toBeVisible({ timeout: 30_000 })

  // The author has no reaction menu on their own image.
  await expect(aCard.getByTestId('image-menu')).toHaveCount(0)

  // B likes: both pages see the count, B's button shows pressed.
  await bCard.hover()
  await bCard.getByTestId('react-like').click()
  await expect(bCard.getByTestId('react-like')).toHaveAttribute('aria-pressed', 'true', { timeout: 15_000 })
  await expect(aCard.getByTestId('like-count')).toHaveText('1', { timeout: 15_000 })
  await expect(bCard.getByTestId('like-count')).toHaveText('1')

  // Switch to dislike.
  await bCard.hover()
  await bCard.getByTestId('react-dislike').click()
  await expect(aCard.getByTestId('dislike-count')).toHaveText('1', { timeout: 15_000 })
  await expect(aCard.getByTestId('like-count')).toHaveText('0')

  // Same again clears it.
  await bCard.hover()
  await bCard.getByTestId('react-dislike').click()
  await expect(aCard.getByTestId('dislike-count')).toHaveText('0', { timeout: 15_000 })
  await expect(bCard.getByTestId('react-dislike')).toHaveAttribute('aria-pressed', 'false')
})

test('signed-out visitors see counts but no reaction controls', async ({ browser }) => {
  const ctx = await browser.newContext()
  const page = await ctx.newPage()
  await page.goto('/')
  await expect(page.getByTestId('public-feed')).toBeVisible({ timeout: 15_000 })
  await expect(page.getByTestId('image-menu')).toHaveCount(0)
  await ctx.close()
})
