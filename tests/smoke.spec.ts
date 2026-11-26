import { test, expect } from '@playwright/test'
import { captureConsoleErrors } from './helpers/errors'

/**
 * Smoke tests for both page kinds mood ships:
 *   - '/about' → the static page (top level of src/pages/): no providers, so
 *                no auth fetch and no records WebSocket on load.
 *   - '/'      → the live public room (under src/pages/(app)/).
 */

async function waitForApp(page: import('@playwright/test').Page) {
  await page.waitForSelector('[data-testid="app-root"]', { timeout: 15000 })
}

test.describe('Smoke tests', () => {
  test('static /about loads without JS errors', async ({ page }) => {
    const errors = captureConsoleErrors(page)
    await page.goto('/about')
    await waitForApp(page)
    await expect(page.getByTestId('static-landing')).toBeVisible()
    expect(errors).toEqual([])
  })

  test('/about carries one title, one description, one canonical', async ({ page }) => {
    await page.goto('/about')
    await expect(page.getByTestId('static-landing')).toBeVisible()
    await expect(page).toHaveTitle(/\S/)
    expect(await page.locator('head meta[name="description"]').count()).toBe(1)
    expect(await page.locator('head link[rel="canonical"]').count()).toBe(1)
  })

  test('static contract: /about fires no auth request, opens no websocket', async ({ page }) => {
    const offenders: string[] = []
    page.on('request', (req) => {
      if (req.url().includes('/api/auth/')) offenders.push(req.url())
    })
    page.on('websocket', (ws) => {
      if (new URL(ws.url()).pathname.startsWith('/ws/')) offenders.push(`ws: ${ws.url()}`)
    })
    await page.goto('/about')
    await expect(page.getByTestId('static-landing')).toBeVisible()
    await page.waitForTimeout(1500)
    expect(offenders).toEqual([])
  })

  test('signed-out visitor sees the public room and Log In, but no composer', async ({ page }) => {
    const errors = captureConsoleErrors(page)
    await page.goto('/')
    await expect(page.getByTestId('app-navigation')).toBeVisible({ timeout: 15000 })
    await expect(page.getByTestId('public-feed')).toBeVisible()
    await expect(page.getByTestId('nav-sign-in-button')).toHaveText('Log In')
    await expect(page.getByTestId('nav-user-name')).toHaveCount(0)
    await expect(page.getByTestId('composer')).toHaveCount(0)
    expect(errors).toEqual([])
  })

  for (const path of ['/account', '/chat/some-room']) {
    test(`${path} asks a signed-out visitor to sign in`, async ({ page }) => {
      await page.goto(path)
      await expect(page.getByText('Sign in to continue')).toBeVisible({ timeout: 15000 })
    })
  }

  test('unknown route shows 404', async ({ page }) => {
    await page.goto('/nonexistent-page-xyz')
    await waitForApp(page)
    await expect(page.locator('text=404')).toBeVisible()
  })
})
