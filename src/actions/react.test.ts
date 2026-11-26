import { describe, expect, it } from 'vitest'
import type { Env } from '../../worker'
import { fakeTools } from './fake-tools'
import { applyReaction, react } from './react'

const env = {} as Env

async function seedImage(owner: string, status = 'live') {
  const f = fakeTools(owner)
  await f.tools.create(
    'public_images',
    { ownerId: owner, r2Key: 'k', imageUrl: '/x.png', promptTranscript: 'calm', likeCount: 0, dislikeCount: 0, status },
    'img1',
  )
  return f
}

function call(f: ReturnType<typeof fakeTools>, userId: string, params: Record<string, unknown>) {
  return react({ userId, params, tools: f.as(userId).tools, env, callerJwt: 't' })
}

describe('applyReaction', () => {
  it('adds, toggles off, and switches', () => {
    expect(applyReaction({ likeCount: 0, dislikeCount: 0 }, null, 'like')).toEqual({ likeCount: 1, dislikeCount: 0, next: 'like' })
    expect(applyReaction({ likeCount: 1, dislikeCount: 0 }, 'like', 'like')).toEqual({ likeCount: 0, dislikeCount: 0, next: null })
    expect(applyReaction({ likeCount: 1, dislikeCount: 0 }, 'like', 'dislike')).toEqual({ likeCount: 0, dislikeCount: 1, next: 'dislike' })
  })
  it('never goes negative', () => {
    expect(applyReaction({ likeCount: 0, dislikeCount: 0 }, 'like', 'like').likeCount).toBe(0)
  })
})

describe('react action', () => {
  it('refuses a reaction to your own image', async () => {
    const f = await seedImage('alice')
    const r = await call(f, 'alice', { imageId: 'img1', type: 'like' })
    expect(r).toMatchObject({ success: false, code: 'self_reaction' })
    expect(f.store.get('image_reactions')?.size ?? 0).toBe(0)
  })

  it('refuses taken-down and unknown images', async () => {
    const f = await seedImage('alice', 'removed')
    expect(await call(f, 'bob', { imageId: 'img1', type: 'like' })).toMatchObject({ success: false, code: 'not_found' })
    expect(await call(f, 'bob', { imageId: 'nope', type: 'like' })).toMatchObject({ success: false, code: 'not_found' })
  })

  it('rejects malformed params', async () => {
    const f = await seedImage('alice')
    expect((await call(f, 'bob', { imageId: 'img1', type: 'love' })).success).toBe(false)
  })

  it('keeps one reaction per user and the counts in step', async () => {
    const f = await seedImage('alice')
    const counts = () => f.store.get('public_images')!.get('img1')!.data

    expect(await call(f, 'bob', { imageId: 'img1', type: 'like' })).toMatchObject({ success: true, data: { reaction: 'like' } })
    await call(f, 'carol', { imageId: 'img1', type: 'like' })
    expect(counts()).toMatchObject({ likeCount: 2, dislikeCount: 0 })

    await call(f, 'bob', { imageId: 'img1', type: 'dislike' })
    expect(counts()).toMatchObject({ likeCount: 1, dislikeCount: 1 })
    expect(f.store.get('image_reactions')!.size).toBe(2)

    await call(f, 'bob', { imageId: 'img1', type: 'dislike' })
    expect(counts()).toMatchObject({ likeCount: 1, dislikeCount: 0 })
    expect(f.store.get('image_reactions')!.has('img1:bob')).toBe(false)
  })
})
