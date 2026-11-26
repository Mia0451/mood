import { describe, expect, it } from 'vitest'
import type { Env } from '../../worker'
import { fakeTools } from './fake-tools'
import { takedownImage } from './takedown'

// No platform in unit tests: resolveAppRole fails (treated as "not admin") and
// the file delete fails (logged, non-fatal). The owner id is the admin path.
const env = { OWNER_USER_ID: 'owner' } as unknown as Env

async function seed() {
  const f = fakeTools('alice')
  await f.tools.create('public_images', { ownerId: 'alice', r2Key: 'apps/x/moods/1.png', status: 'live' }, 'img1')
  return f
}

describe('takedownImage', () => {
  it('refuses non-admins and leaves the image live', async () => {
    const f = await seed()
    const r = await takedownImage({ userId: 'bob', params: { imageId: 'img1' }, tools: f.as('bob').tools, env, callerJwt: 't' })
    expect(r).toMatchObject({ success: false, code: 'forbidden' })
    expect(f.store.get('public_images')!.get('img1')!.data.status).toBe('live')
  })

  it('lets the app owner take an image down', async () => {
    const f = await seed()
    const r = await takedownImage({ userId: 'owner', params: { imageId: 'img1' }, tools: f.as('owner').tools, env, callerJwt: 't' })
    expect(r.success).toBe(true)
    expect(f.store.get('public_images')!.get('img1')!.data.status).toBe('removed')
  })
})
